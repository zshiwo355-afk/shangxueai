from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from fastapi import HTTPException
from sqlalchemy import desc, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from .config import get_settings
from .db import session_scope
from .models import (
    MagicPushBatch,
    MagicPushEntry,
    MagicReadingContent,
    MagicReadingContentTarget,
    MagicVideo,
    MagicVideoTarget,
    NotificationLog,
    User,
)
from .notification_service import send_wecom_message
from .wecom_client import WecomApiError, WecomPartialFailure

logger = logging.getLogger("app.magic_push_service")
_settings = get_settings()
READING_PUSH_POLL_SECONDS = 15

CONTENT_TYPE_COURSE = "course"
CONTENT_TYPE_READING = "reading_content"

TRIGGER_TYPE_INITIAL = "initial_publish"
TRIGGER_TYPE_SCHEDULED = "scheduled_push_at"
TRIGGER_TYPE_MANUAL = "manual_retry"

BATCH_STATUS_PENDING = "pending"
BATCH_STATUS_RUNNING = "running"
BATCH_STATUS_SENT = "sent"
BATCH_STATUS_PARTIAL = "partial"
BATCH_STATUS_FAILED = "failed"

ENTRY_STATUS_PENDING = "pending"
ENTRY_STATUS_SENT = "sent"
ENTRY_STATUS_FAILED = "failed"
ENTRY_STATUS_SKIPPED = "skipped"

SKIP_REASON_MISSING_WECOM = "missing_wecom_userid"
SKIP_REASON_ALREADY_SENT = "already_sent_in_previous_batch"

ACTIVE_BATCH_STATUSES = {BATCH_STATUS_PENDING, BATCH_STATUS_RUNNING}
FIRST_PUSH_TRIGGER_TYPES = {TRIGGER_TYPE_INITIAL, TRIGGER_TYPE_SCHEDULED}


@dataclass
class PushContext:
    content_type: str
    content_id: int
    title_snapshot: str
    target_snapshot: dict[str, Any]


def _now() -> datetime:
    return datetime.now()


def _frontend_url(path: str) -> str:
    base = _settings.resolved_wecom_frontend_base_url
    if not base:
        return ""
    clean_path = path if path.startswith("/") else f"/{path}"
    return f"{base}{clean_path}"


async def list_effective_users(db: AsyncSession) -> list[User]:
    result = await db.execute(
        select(User)
        .where(
            User.role == "user",
            User.disabled.is_(False),
            User.status == "active",
        )
        .order_by(User.id.asc())
    )
    return result.scalars().all()


async def _get_video_targets(db: AsyncSession, video_id: int) -> list[MagicVideoTarget]:
    result = await db.execute(
        select(MagicVideoTarget)
        .where(MagicVideoTarget.video_id == video_id)
        .order_by(MagicVideoTarget.id.asc())
    )
    return result.scalars().all()


async def _get_reading_targets(db: AsyncSession, content_id: int) -> list[MagicReadingContentTarget]:
    result = await db.execute(
        select(MagicReadingContentTarget)
        .where(MagicReadingContentTarget.content_id == content_id)
        .order_by(MagicReadingContentTarget.id.asc())
    )
    return result.scalars().all()


def _video_target_matches_user(user: User, target: MagicVideoTarget) -> bool:
    target_type = (target.target_type or "").strip().lower()
    target_value = (target.target_value or "").strip()
    if target_type == "all_users":
        return True
    if target_type == "all_newcomers":
        return bool(user.is_newcomer)
    if target_type == "department":
        return (user.department or "").strip() == target_value
    if target_type == "position":
        return (user.position or "").strip() == target_value
    if target_type == "employment_status":
        return (user.employment_status or "").strip() == target_value
    if target_type == "role":
        return (user.role or "").strip() == target_value
    if target_type == "user":
        return str(user.id) == target_value
    return False


def _reading_target_matches_user(user: User, target: MagicReadingContentTarget) -> bool:
    target_type = (target.target_type or "").strip().lower()
    target_id = (target.target_id or "").strip()
    if target_type == "all":
        return True
    if target_type == "all_newcomers":
        return bool(user.is_newcomer)
    if target_type == "department":
        return (user.department or "").strip() == target_id
    if target_type == "position":
        return (user.position or "").strip() == target_id
    if target_type == "employment_status":
        return (user.employment_status or "").strip() == target_id
    if target_type == "user":
        return str(user.id) == target_id
    return False


def _serialize_video_targets(video: MagicVideo, targets: list[MagicVideoTarget]) -> dict[str, Any]:
    return {
        "is_newcomer_required": bool(video.is_newcomer_required),
        "targets": [
            {
                "target_type": item.target_type,
                "target_value": item.target_value,
            }
            for item in targets
        ],
    }


def _serialize_reading_targets(content: MagicReadingContent, targets: list[MagicReadingContentTarget]) -> dict[str, Any]:
    return {
        "push_at": content.push_at.isoformat() if content.push_at else None,
        "targets": [
            {
                "target_type": item.target_type,
                "target_id": item.target_id,
            }
            for item in targets
        ],
    }


async def get_course_push_context(db: AsyncSession, video_id: int) -> PushContext:
    video = await db.get(MagicVideo, video_id)
    if not video or video.deleted_at is not None:
        raise HTTPException(status_code=404, detail="视频不存在。")
    targets = await _get_video_targets(db, int(video.id))
    return PushContext(
        content_type=CONTENT_TYPE_COURSE,
        content_id=int(video.id),
        title_snapshot=video.title or "",
        target_snapshot=_serialize_video_targets(video, targets),
    )


async def get_reading_push_context(db: AsyncSession, content_id: int) -> PushContext:
    content = await db.get(MagicReadingContent, content_id)
    if not content or bool(content.is_deleted):
        raise HTTPException(status_code=404, detail="读书内容不存在。")
    targets = await _get_reading_targets(db, int(content.id))
    return PushContext(
        content_type=CONTENT_TYPE_READING,
        content_id=int(content.id),
        title_snapshot=content.title or "",
        target_snapshot=_serialize_reading_targets(content, targets),
    )


async def collect_course_recipients(db: AsyncSession, video_id: int) -> list[User]:
    video = await db.get(MagicVideo, video_id)
    if not video or video.deleted_at is not None:
        raise HTTPException(status_code=404, detail="视频不存在。")
    targets = await _get_video_targets(db, int(video.id))
    users = await list_effective_users(db)
    if not targets and not bool(video.is_newcomer_required):
        return users
    visible: dict[int, User] = {}
    for user in users:
        if bool(video.is_newcomer_required) and bool(user.is_newcomer):
            visible[int(user.id)] = user
            continue
        if any(_video_target_matches_user(user, target) for target in targets):
            visible[int(user.id)] = user
    return list(visible.values())


async def collect_reading_recipients(db: AsyncSession, content_id: int) -> list[User]:
    content = await db.get(MagicReadingContent, content_id)
    if not content or bool(content.is_deleted):
        raise HTTPException(status_code=404, detail="读书内容不存在。")
    targets = await _get_reading_targets(db, int(content.id))
    users = await list_effective_users(db)
    visible: dict[int, User] = {}
    for user in users:
        if any(_reading_target_matches_user(user, target) for target in targets):
            visible[int(user.id)] = user
    return list(visible.values())


async def get_latest_batch(
    db: AsyncSession,
    *,
    content_type: str,
    content_id: int,
) -> MagicPushBatch | None:
    result = await db.execute(
        select(MagicPushBatch)
        .where(MagicPushBatch.content_type == content_type, MagicPushBatch.content_id == content_id)
        .order_by(desc(MagicPushBatch.created_at), desc(MagicPushBatch.id))
        .limit(1)
    )
    return result.scalar_one_or_none()


async def get_push_entries(
    db: AsyncSession,
    *,
    content_type: str,
    content_id: int,
    batch_id: int | None = None,
) -> list[MagicPushEntry]:
    stmt = select(MagicPushEntry).where(
        MagicPushEntry.content_type == content_type,
        MagicPushEntry.content_id == content_id,
    )
    if batch_id is not None:
        stmt = stmt.where(MagicPushEntry.batch_id == batch_id)
    else:
        latest = await get_latest_batch(db, content_type=content_type, content_id=content_id)
        if latest is None:
            return []
        stmt = stmt.where(MagicPushEntry.batch_id == int(latest.id))
    result = await db.execute(stmt.order_by(MagicPushEntry.created_at.asc(), MagicPushEntry.id.asc()))
    return result.scalars().all()


async def assert_no_active_batch(
    db: AsyncSession,
    *,
    content_type: str,
    content_id: int,
) -> None:
    result = await db.execute(
        select(MagicPushBatch.id)
        .where(
            MagicPushBatch.content_type == content_type,
            MagicPushBatch.content_id == content_id,
            MagicPushBatch.status.in_(ACTIVE_BATCH_STATUSES),
        )
        .limit(1)
    )
    if result.scalar_one_or_none() is not None:
        raise HTTPException(status_code=409, detail="当前内容已有进行中的推送批次，请稍后再试。")


async def get_historical_sent_user_ids(
    db: AsyncSession,
    *,
    content_type: str,
    content_id: int,
) -> set[int]:
    rows = (
        await db.execute(
            select(MagicPushEntry.recipient_user_id)
            .where(
                MagicPushEntry.content_type == content_type,
                MagicPushEntry.content_id == content_id,
                MagicPushEntry.status == ENTRY_STATUS_SENT,
            )
        )
    ).scalars().all()
    return {int(item) for item in rows}


async def calculate_retry_recipients(
    db: AsyncSession,
    *,
    content_type: str,
    content_id: int,
    current_recipients: list[User],
) -> list[User]:
    await assert_no_active_batch(db, content_type=content_type, content_id=content_id)
    historical_sent_user_ids = await get_historical_sent_user_ids(
        db,
        content_type=content_type,
        content_id=content_id,
    )
    return [item for item in current_recipients if int(item.id) not in historical_sent_user_ids]


def build_first_push_dedupe_key(*, content_type: str, content_id: int, trigger_type: str) -> str:
    return f"magic_push:{content_type}:{content_id}:{trigger_type}"


def build_manual_retry_dedupe_key(*, content_type: str, content_id: int) -> str:
    return f"magic_push:{content_type}:{content_id}:{TRIGGER_TYPE_MANUAL}:{_now().isoformat()}"


async def create_batch(
    db: AsyncSession,
    *,
    context: PushContext,
    trigger_type: str,
    created_by: int | None,
    dedupe_key: str | None = None,
    scheduled_at: datetime | None = None,
) -> MagicPushBatch:
    async with db.begin_nested():
        batch = MagicPushBatch(
            content_type=context.content_type,
            content_id=context.content_id,
            trigger_type=trigger_type,
            status=BATCH_STATUS_PENDING,
            dedupe_key=dedupe_key or f"magic_push:{context.content_type}:{context.content_id}:{trigger_type}:{_now().isoformat()}",
            target_snapshot_json=json.dumps(context.target_snapshot, ensure_ascii=False),
            title_snapshot=context.title_snapshot,
            scheduled_at=scheduled_at,
            created_by=created_by,
        )
        db.add(batch)
        try:
            await db.flush()
        except IntegrityError as exc:
            raise HTTPException(status_code=409, detail="首次推送批次已存在，请勿重复创建。") from exc
    return batch


async def get_first_push_batch(
    db: AsyncSession,
    *,
    content_type: str,
    content_id: int,
    trigger_type: str,
) -> MagicPushBatch | None:
    result = await db.execute(
        select(MagicPushBatch)
        .where(
            MagicPushBatch.content_type == content_type,
            MagicPushBatch.content_id == content_id,
            MagicPushBatch.trigger_type == trigger_type,
        )
        .order_by(desc(MagicPushBatch.created_at), desc(MagicPushBatch.id))
        .limit(1)
    )
    return result.scalar_one_or_none()


async def get_scheduled_push_batch(
    db: AsyncSession,
    *,
    content_id: int,
) -> MagicPushBatch | None:
    return await get_first_push_batch(
        db,
        content_type=CONTENT_TYPE_READING,
        content_id=content_id,
        trigger_type=TRIGGER_TYPE_SCHEDULED,
    )


async def create_entries(
    db: AsyncSession,
    *,
    batch: MagicPushBatch,
    recipients: list[User],
) -> list[MagicPushEntry]:
    entries: list[MagicPushEntry] = []
    seen_user_ids: set[int] = set()
    for user in recipients:
        user_id = int(user.id)
        if user_id in seen_user_ids:
            continue
        seen_user_ids.add(user_id)
        wecom_userid = (user.wecom_userid or "").strip() or None
        status = ENTRY_STATUS_PENDING if wecom_userid else ENTRY_STATUS_SKIPPED
        skip_reason = None if wecom_userid else SKIP_REASON_MISSING_WECOM
        row = MagicPushEntry(
            batch_id=int(batch.id),
            content_type=batch.content_type,
            content_id=int(batch.content_id),
            recipient_user_id=user_id,
            recipient_wecom_userid=wecom_userid,
            status=status,
            skip_reason=skip_reason,
        )
        db.add(row)
        entries.append(row)
    await db.flush()
    return entries


def summarize_batch_status(
    *,
    success_count: int,
    failed_count: int,
    skipped_count: int,
    execution_failed: bool = False,
) -> str:
    if execution_failed:
        return BATCH_STATUS_FAILED
    if success_count > 0 and failed_count == 0 and skipped_count == 0:
        return BATCH_STATUS_SENT
    if success_count > 0 and (failed_count > 0 or skipped_count > 0):
        return BATCH_STATUS_PARTIAL
    if success_count == 0 and skipped_count > 0:
        return BATCH_STATUS_PARTIAL
    if success_count == 0 and failed_count > 0:
        return BATCH_STATUS_FAILED
    return BATCH_STATUS_FAILED


async def refresh_batch_counters(
    db: AsyncSession,
    *,
    batch: MagicPushBatch,
    execution_failed: bool = False,
) -> MagicPushBatch:
    result = await db.execute(
        select(MagicPushEntry).where(MagicPushEntry.batch_id == int(batch.id))
    )
    entries = result.scalars().all()
    success_count = sum(1 for item in entries if item.status == ENTRY_STATUS_SENT)
    failed_count = sum(1 for item in entries if item.status == ENTRY_STATUS_FAILED)
    skipped_count = sum(1 for item in entries if item.status == ENTRY_STATUS_SKIPPED)
    batch.success_count = success_count
    batch.failed_count = failed_count
    batch.skipped_count = skipped_count
    batch.status = summarize_batch_status(
        success_count=success_count,
        failed_count=failed_count,
        skipped_count=skipped_count,
        execution_failed=execution_failed,
    )
    batch.finished_at = _now()
    batch.summary_json = json.dumps(
        {
            "success_count": success_count,
            "failed_count": failed_count,
            "skipped_count": skipped_count,
        },
        ensure_ascii=False,
    )
    await db.flush()
    return batch


async def _attach_notification_logs_to_entries(
    db: AsyncSession,
    *,
    batch: MagicPushBatch,
) -> None:
    logs = (
        await db.execute(
            select(NotificationLog)
            .where(
                NotificationLog.business_type == "magic_push_batch",
                NotificationLog.business_id == int(batch.id),
            )
            .order_by(NotificationLog.id.desc())
        )
    ).scalars().all()
    latest_by_user_id: dict[int, NotificationLog] = {}
    for row in logs:
        if row.recipient_user_id is None:
            continue
        user_id = int(row.recipient_user_id)
        if user_id not in latest_by_user_id:
            latest_by_user_id[user_id] = row
    entries = (
        await db.execute(select(MagicPushEntry).where(MagicPushEntry.batch_id == int(batch.id)))
    ).scalars().all()
    for entry in entries:
        if entry.status == ENTRY_STATUS_SKIPPED:
            continue
        log_row = latest_by_user_id.get(int(entry.recipient_user_id))
        if log_row is None:
            continue
        entry.notification_log_id = int(log_row.id)
        entry.status = (log_row.status or ENTRY_STATUS_FAILED).strip().lower()
        entry.error = log_row.error
        entry.sent_at = log_row.sent_at
    await db.flush()


async def dispatch_batch_via_wecom(
    db: AsyncSession,
    *,
    batch: MagicPushBatch,
    event_type: str,
    title: str,
    description: str,
    url: str = "",
) -> MagicPushBatch:
    batch.status = BATCH_STATUS_RUNNING
    batch.started_at = _now()
    await db.flush()

    entries = (
        await db.execute(
            select(MagicPushEntry)
            .where(MagicPushEntry.batch_id == int(batch.id))
            .order_by(MagicPushEntry.id.asc())
        )
    ).scalars().all()
    send_user_ids = [int(item.recipient_user_id) for item in entries if item.status == ENTRY_STATUS_PENDING]
    execution_failed = False

    if send_user_ids:
        recipients = (
            await db.execute(select(User).where(User.id.in_(send_user_ids)).order_by(User.id.asc()))
        ).scalars().all()
        try:
            await send_wecom_message(
                db,
                event_type=event_type,
                recipients=recipients,
                business_type="magic_push_batch",
                business_id=int(batch.id),
                title=title,
                description=description,
                url=url,
            )
        except WecomPartialFailure:
            pass
        except WecomApiError as exc:
            execution_failed = True
            for entry in entries:
                if entry.status != ENTRY_STATUS_PENDING:
                    continue
                entry.status = ENTRY_STATUS_FAILED
                entry.error = str(exc)
            await db.flush()
        except Exception as exc:  # noqa: BLE001
            execution_failed = True
            for entry in entries:
                if entry.status != ENTRY_STATUS_PENDING:
                    continue
                entry.status = ENTRY_STATUS_FAILED
                entry.error = str(exc)
            await db.flush()

    await _attach_notification_logs_to_entries(db, batch=batch)
    return await refresh_batch_counters(db, batch=batch, execution_failed=execution_failed)


def should_trigger_course_initial_push(*, old_status: str | None, new_status: str | None) -> bool:
    previous = (old_status or "draft").strip().lower()
    current = (new_status or "draft").strip().lower()
    return previous != "published" and current == "published"


def build_course_notification_message(video: MagicVideo) -> tuple[str, str, str]:
    deadline = video.deadline_at.strftime("%Y-%m-%d %H:%M") if video.deadline_at else "不限"
    description = (
        '<div class="gray">课程学习任务通知</div>'
        f'<div class="normal">课程：{video.title}</div>'
        f'<div class="normal">截止：{deadline}</div>'
    )
    return (
        "你有新的课程学习任务",
        description,
        _frontend_url("/magic-academy?tab=courses"),
    )


async def run_course_initial_push(
    db: AsyncSession,
    *,
    video_id: int,
    created_by: int | None,
) -> MagicPushBatch | None:
    video = await db.get(MagicVideo, video_id)
    if not video or video.deleted_at is not None:
        logger.warning("[magic_push] skip missing video id=%s", video_id)
        return None
    if (video.status or "").strip().lower() != "published":
        logger.info("[magic_push] skip non-published video id=%s status=%s", video_id, video.status)
        return None

    existing_first_batch = await get_first_push_batch(
        db,
        content_type=CONTENT_TYPE_COURSE,
        content_id=int(video.id),
        trigger_type=TRIGGER_TYPE_INITIAL,
    )
    if existing_first_batch is not None:
        logger.info(
            "[magic_push] first push batch already exists video_id=%s batch_id=%s status=%s",
            video_id,
            existing_first_batch.id,
            existing_first_batch.status,
        )
        return existing_first_batch

    context = await get_course_push_context(db, int(video.id))
    recipients = await collect_course_recipients(db, int(video.id))
    dedupe_key = build_first_push_dedupe_key(
        content_type=CONTENT_TYPE_COURSE,
        content_id=int(video.id),
        trigger_type=TRIGGER_TYPE_INITIAL,
    )
    try:
        batch = await create_batch(
            db,
            context=context,
            trigger_type=TRIGGER_TYPE_INITIAL,
            created_by=created_by,
            dedupe_key=dedupe_key,
        )
    except HTTPException as exc:
        if exc.status_code == 409:
            logger.info("[magic_push] duplicate first push ignored video_id=%s", video_id)
            return await get_first_push_batch(
                db,
                content_type=CONTENT_TYPE_COURSE,
                content_id=int(video.id),
                trigger_type=TRIGGER_TYPE_INITIAL,
            )
        raise

    await create_entries(db, batch=batch, recipients=recipients)
    title, description, url = build_course_notification_message(video)
    return await dispatch_batch_via_wecom(
        db,
        batch=batch,
        event_type="magic_video_assigned",
        title=title,
        description=description,
        url=url,
    )


def schedule_course_initial_push(*, video_id: int, created_by: int | None) -> None:
    async def _runner() -> None:
        try:
            async with session_scope() as push_session:
                await run_course_initial_push(
                    push_session,
                    video_id=video_id,
                    created_by=created_by,
                )
        except Exception:  # noqa: BLE001
            logger.exception("[magic_push] course initial push failed video_id=%s", video_id)

    asyncio.create_task(_runner())


def build_reading_notification_message(content: MagicReadingContent) -> tuple[str, str, str]:
    push_at = content.push_at.strftime("%Y-%m-%d %H:%M") if content.push_at else "立即可见"
    description = (
        '<div class="gray">读书打卡提醒</div>'
        f'<div class="normal">内容：{content.title}</div>'
        f'<div class="normal">日期：{content.reading_date.isoformat()}</div>'
        f'<div class="normal">发布时间：{push_at}</div>'
    )
    return (
        "读书打卡提醒",
        description,
        _frontend_url("/magic-academy?tab=audio"),
    )


def manual_retry_response_dict(
    *,
    batch: MagicPushBatch | None,
    content_type: str,
    content_id: int,
    message: str,
) -> dict[str, Any]:
    if batch is None:
        return {
            "batch_id": None,
            "content_type": content_type,
            "content_id": content_id,
            "trigger_type": TRIGGER_TYPE_MANUAL,
            "status": "noop",
            "total_count": 0,
            "success_count": 0,
            "failed_count": 0,
            "skipped_count": 0,
            "message": message,
        }
    total_count = int(batch.success_count or 0) + int(batch.failed_count or 0) + int(batch.skipped_count or 0)
    return {
        "batch_id": int(batch.id),
        "content_type": batch.content_type,
        "content_id": int(batch.content_id),
        "trigger_type": batch.trigger_type,
        "status": batch.status,
        "total_count": total_count,
        "success_count": int(batch.success_count or 0),
        "failed_count": int(batch.failed_count or 0),
        "skipped_count": int(batch.skipped_count or 0),
        "message": message,
    }


async def run_course_manual_retry(
    db: AsyncSession,
    *,
    video_id: int,
    created_by: int | None,
) -> dict[str, Any]:
    video = await db.get(MagicVideo, video_id)
    if not video or video.deleted_at is not None:
        raise HTTPException(status_code=404, detail="视频不存在。")
    recipients = await calculate_retry_recipients(
        db,
        content_type=CONTENT_TYPE_COURSE,
        content_id=int(video.id),
        current_recipients=await collect_course_recipients(db, int(video.id)),
    )
    if not recipients:
        return manual_retry_response_dict(
            batch=None,
            content_type=CONTENT_TYPE_COURSE,
            content_id=int(video.id),
            message="没有可补推对象。",
        )
    context = await get_course_push_context(db, int(video.id))
    batch = await create_batch(
        db,
        context=context,
        trigger_type=TRIGGER_TYPE_MANUAL,
        created_by=created_by,
        dedupe_key=build_manual_retry_dedupe_key(
            content_type=CONTENT_TYPE_COURSE,
            content_id=int(video.id),
        ),
    )
    await create_entries(db, batch=batch, recipients=recipients)
    title, description, url = build_course_notification_message(video)
    batch = await dispatch_batch_via_wecom(
        db,
        batch=batch,
        event_type="magic_video_assigned",
        title=title,
        description=description,
        url=url,
    )
    return manual_retry_response_dict(
        batch=batch,
        content_type=CONTENT_TYPE_COURSE,
        content_id=int(video.id),
        message="课程补推已完成。",
    )


async def run_reading_manual_retry(
    db: AsyncSession,
    *,
    content_id: int,
    created_by: int | None,
) -> dict[str, Any]:
    content = await db.get(MagicReadingContent, content_id)
    if not content or bool(content.is_deleted):
        raise HTTPException(status_code=404, detail="读书内容不存在。")
    recipients = await calculate_retry_recipients(
        db,
        content_type=CONTENT_TYPE_READING,
        content_id=int(content.id),
        current_recipients=await collect_reading_recipients(db, int(content.id)),
    )
    if not recipients:
        return manual_retry_response_dict(
            batch=None,
            content_type=CONTENT_TYPE_READING,
            content_id=int(content.id),
            message="没有可补推对象。",
        )
    context = await get_reading_push_context(db, int(content.id))
    batch = await create_batch(
        db,
        context=context,
        trigger_type=TRIGGER_TYPE_MANUAL,
        created_by=created_by,
        dedupe_key=build_manual_retry_dedupe_key(
            content_type=CONTENT_TYPE_READING,
            content_id=int(content.id),
        ),
    )
    await create_entries(db, batch=batch, recipients=recipients)
    title, description, url = build_reading_notification_message(content)
    batch = await dispatch_batch_via_wecom(
        db,
        batch=batch,
        event_type="magic_reading_published",
        title=title,
        description=description,
        url=url,
    )
    return manual_retry_response_dict(
        batch=batch,
        content_type=CONTENT_TYPE_READING,
        content_id=int(content.id),
        message="读书内容补推已完成。",
    )


async def run_reading_scheduled_push(
    db: AsyncSession,
    *,
    content_id: int,
    created_by: int | None = None,
) -> MagicPushBatch | None:
    content = await db.get(MagicReadingContent, content_id)
    if not content or bool(content.is_deleted):
        logger.info("[magic_push] skip missing reading_content id=%s", content_id)
        return None
    if (content.status or "").strip().lower() != "active":
        logger.info(
            "[magic_push] skip inactive reading_content id=%s status=%s",
            content_id,
            content.status,
        )
        return None
    if content.push_at is None or content.push_at > _now():
        logger.info("[magic_push] skip not-due reading_content id=%s push_at=%s", content_id, content.push_at)
        return None

    active_batch = await db.execute(
        select(MagicPushBatch.id)
        .where(
            MagicPushBatch.content_type == CONTENT_TYPE_READING,
            MagicPushBatch.content_id == int(content.id),
            MagicPushBatch.status.in_(ACTIVE_BATCH_STATUSES),
        )
        .limit(1)
    )
    if active_batch.scalar_one_or_none() is not None:
        logger.info("[magic_push] skip active batch reading_content id=%s", content_id)
        return None

    existing_first_batch = await get_scheduled_push_batch(db, content_id=int(content.id))
    if existing_first_batch is not None:
        logger.info(
            "[magic_push] scheduled push batch already exists reading_content id=%s batch_id=%s status=%s",
            content_id,
            existing_first_batch.id,
            existing_first_batch.status,
        )
        return existing_first_batch

    context = await get_reading_push_context(db, int(content.id))
    recipients = await collect_reading_recipients(db, int(content.id))
    dedupe_key = build_first_push_dedupe_key(
        content_type=CONTENT_TYPE_READING,
        content_id=int(content.id),
        trigger_type=TRIGGER_TYPE_SCHEDULED,
    )
    try:
        batch = await create_batch(
            db,
            context=context,
            trigger_type=TRIGGER_TYPE_SCHEDULED,
            created_by=created_by,
            dedupe_key=dedupe_key,
            scheduled_at=content.push_at,
        )
    except HTTPException as exc:
        if exc.status_code == 409:
            logger.info("[magic_push] duplicate scheduled push ignored reading_content id=%s", content_id)
            return await get_scheduled_push_batch(db, content_id=int(content.id))
        raise

    await create_entries(db, batch=batch, recipients=recipients)
    title, description, url = build_reading_notification_message(content)
    return await dispatch_batch_via_wecom(
        db,
        batch=batch,
        event_type="magic_reading_published",
        title=title,
        description=description,
        url=url,
    )


async def scan_due_reading_contents_for_push(db: AsyncSession) -> dict[str, int]:
    now = _now()
    rows = (
        await db.execute(
            select(MagicReadingContent.id)
            .where(
                MagicReadingContent.is_deleted.is_(False),
                MagicReadingContent.status == "active",
                MagicReadingContent.push_at.is_not(None),
                MagicReadingContent.push_at <= now,
            )
            .order_by(MagicReadingContent.push_at.asc(), MagicReadingContent.id.asc())
        )
    ).all()
    target_ids = [int(row[0]) for row in rows]
    summary = {
        "scanned": len(target_ids),
        "triggered": 0,
        "skipped": 0,
        "failed": 0,
    }
    for content_id in target_ids:
        try:
            batch = await run_reading_scheduled_push(db, content_id=content_id)
            if batch is None:
                summary["skipped"] += 1
            else:
                summary["triggered"] += 1
        except Exception:  # noqa: BLE001
            summary["failed"] += 1
            logger.exception("[magic_push] scheduled reading push failed content_id=%s", content_id)
    logger.info(
        "[magic_push] reading scheduled scan scanned=%s triggered=%s skipped=%s failed=%s",
        summary["scanned"],
        summary["triggered"],
        summary["skipped"],
        summary["failed"],
    )
    return summary


async def reading_push_worker(stop_event: asyncio.Event) -> None:
    while not stop_event.is_set():
        try:
            async with session_scope() as scan_session:
                now = _now()
                rows = (
                    await scan_session.execute(
                        select(MagicReadingContent.id)
                        .where(
                            MagicReadingContent.is_deleted.is_(False),
                            MagicReadingContent.status == "active",
                            MagicReadingContent.push_at.is_not(None),
                            MagicReadingContent.push_at <= now,
                        )
                        .order_by(MagicReadingContent.push_at.asc(), MagicReadingContent.id.asc())
                    )
                ).all()
                target_ids = [int(row[0]) for row in rows]
            summary = {
                "scanned": len(target_ids),
                "triggered": 0,
                "skipped": 0,
                "failed": 0,
            }
            for content_id in target_ids:
                try:
                    async with session_scope() as push_session:
                        batch = await run_reading_scheduled_push(push_session, content_id=content_id)
                    if batch is None:
                        summary["skipped"] += 1
                    else:
                        summary["triggered"] += 1
                except Exception:  # noqa: BLE001
                    summary["failed"] += 1
                    logger.exception("[magic_push] scheduled reading push failed content_id=%s", content_id)
            logger.info(
                "[magic_push] reading scheduled scan scanned=%s triggered=%s skipped=%s failed=%s",
                summary["scanned"],
                summary["triggered"],
                summary["skipped"],
                summary["failed"],
            )
        except Exception:  # noqa: BLE001
            logger.exception("[magic_push] reading push worker loop failed")
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=READING_PUSH_POLL_SECONDS)
        except TimeoutError:
            continue


def batch_to_dict(batch: MagicPushBatch | None) -> dict[str, Any] | None:
    if batch is None:
        return None
    return {
        "id": int(batch.id),
        "content_type": batch.content_type,
        "content_id": int(batch.content_id),
        "trigger_type": batch.trigger_type,
        "status": batch.status,
        "title_snapshot": batch.title_snapshot or "",
        "scheduled_at": batch.scheduled_at.isoformat() if batch.scheduled_at else None,
        "started_at": batch.started_at.isoformat() if batch.started_at else None,
        "finished_at": batch.finished_at.isoformat() if batch.finished_at else None,
        "success_count": int(batch.success_count or 0),
        "failed_count": int(batch.failed_count or 0),
        "skipped_count": int(batch.skipped_count or 0),
        "created_by": int(batch.created_by) if batch.created_by else None,
        "target_snapshot": json.loads(batch.target_snapshot_json or "{}"),
        "summary": json.loads(batch.summary_json or "{}"),
        "created_at": batch.created_at.isoformat() if batch.created_at else None,
        "updated_at": batch.updated_at.isoformat() if batch.updated_at else None,
    }


async def entries_to_dicts(db: AsyncSession, entries: list[MagicPushEntry]) -> list[dict[str, Any]]:
    if not entries:
        return []
    user_ids = sorted({int(item.recipient_user_id) for item in entries})
    users = (
        await db.execute(select(User).where(User.id.in_(user_ids)))
    ).scalars().all()
    user_map = {int(item.id): item for item in users}
    rows: list[dict[str, Any]] = []
    for entry in entries:
        user = user_map.get(int(entry.recipient_user_id))
        rows.append(
            {
                "id": int(entry.id),
                "batch_id": int(entry.batch_id),
                "content_type": entry.content_type,
                "content_id": int(entry.content_id),
                "recipient_user_id": int(entry.recipient_user_id),
                "recipient_wecom_userid": entry.recipient_wecom_userid or "",
                "recipient_name": (
                    user.real_name or user.display_name or user.username
                    if user else ""
                ),
                "department": user.department if user else "",
                "position": user.position if user else "",
                "status": entry.status,
                "skip_reason": entry.skip_reason or "",
                "error": entry.error or "",
                "notification_log_id": int(entry.notification_log_id) if entry.notification_log_id else None,
                "sent_at": entry.sent_at.isoformat() if entry.sent_at else None,
                "created_at": entry.created_at.isoformat() if entry.created_at else None,
                "updated_at": entry.updated_at.isoformat() if entry.updated_at else None,
            }
        )
    return rows
