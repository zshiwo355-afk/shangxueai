from __future__ import annotations

import asyncio
import random
from datetime import date, datetime, timedelta

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from .db import session_scope
from .models import (
    MagicAudioMakeupSetting,
    MagicAudioUpload,
    MagicAutoAction,
    MagicReadingContent,
    MagicReadingContentTarget,
    MagicVideo,
    MagicVideoProgress,
    MagicVideoTarget,
    User,
    UserWhitelist,
)

SOURCE_WHITELIST_AUTO = "whitelist_auto"
SOURCE_WHITELIST_EXEMPT = "whitelist_exempt"

AUTO_ACTION_PENDING = "pending"
AUTO_ACTION_DONE = "done"
AUTO_ACTION_FAILED = "failed"
AUTO_ACTION_AUDIO = "audio_checkin"
AUTO_ACTION_VIDEO = "video_complete"
AUTO_ACTION_POLL_SECONDS = 15


def _now() -> datetime:
    return datetime.now()


async def _get_auto_action_settings(db: AsyncSession) -> MagicAudioMakeupSetting | None:
    result = await db.execute(
        select(MagicAudioMakeupSetting).order_by(MagicAudioMakeupSetting.id.asc()).limit(1)
    )
    return result.scalar_one_or_none()


def _schedule_time(window_start_at: datetime, window_minutes: int) -> tuple[datetime, datetime]:
    clamped_minutes = max(int(window_minutes or 0), 0)
    if clamped_minutes <= 0:
        return window_start_at, window_start_at
    window_end_at = window_start_at + timedelta(minutes=clamped_minutes)
    random_offset_seconds = random.randint(0, clamped_minutes * 60)
    return window_start_at + timedelta(seconds=random_offset_seconds), window_end_at


async def _get_enabled_whitelist_users(
    db: AsyncSession,
    *,
    target_user_ids: list[int],
    flag_name: str,
) -> list[User]:
    if not target_user_ids:
        return []
    result = await db.execute(
        select(User)
        .join(UserWhitelist, UserWhitelist.user_id == User.id)
        .where(
            User.id.in_(target_user_ids),
            User.role == "user",
            User.disabled.is_(False),
            UserWhitelist.enabled.is_(True),
            getattr(UserWhitelist, flag_name).is_(True),
        )
        .order_by(User.id.asc())
    )
    return result.scalars().all()


async def _collect_reading_target_users(
    db: AsyncSession,
    targets: list[MagicReadingContentTarget],
) -> list[User]:
    if not targets:
        return []
    result = await db.execute(
        select(User).where(User.role == "user", User.disabled.is_(False)).order_by(User.id.asc())
    )
    users = result.scalars().all()

    def matches(user: User, target: MagicReadingContentTarget) -> bool:
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

    visible: dict[int, User] = {}
    for user in users:
        if any(matches(user, target) for target in targets):
            visible[user.id] = user
    return list(visible.values())


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


async def _collect_video_target_users(
    db: AsyncSession,
    video: MagicVideo,
    targets: list[MagicVideoTarget],
) -> list[User]:
    result = await db.execute(
        select(User).where(User.role == "user", User.disabled.is_(False)).order_by(User.id.asc())
    )
    users = result.scalars().all()
    if not targets and not video.is_newcomer_required:
        return users
    visible_users: list[User] = []
    for user in users:
        if video.is_newcomer_required and user.is_newcomer:
            visible_users.append(user)
            continue
        if any(_video_target_matches_user(user, target) for target in targets):
            visible_users.append(user)
    unique: dict[int, User] = {}
    for item in visible_users:
        unique[item.id] = item
    return list(unique.values())


async def _create_auto_action(
    db: AsyncSession,
    *,
    action_type: str,
    target_user_id: int,
    target_date: date | None,
    video_id: int | None,
    reading_content_id: int | None,
    trigger_source: str,
    trigger_ref_id: int | None,
    dedupe_key: str,
    window_minutes: int,
    created_by: int | None,
) -> None:
    existing = await db.execute(
        select(MagicAutoAction.id).where(MagicAutoAction.dedupe_key == dedupe_key).limit(1)
    )
    if existing.scalar_one_or_none() is not None:
        return
    window_start_at = _now()
    scheduled_at, window_end_at = _schedule_time(window_start_at, window_minutes)
    row = MagicAutoAction(
        action_type=action_type,
        status=AUTO_ACTION_PENDING,
        target_user_id=target_user_id,
        target_date=target_date,
        video_id=video_id,
        reading_content_id=reading_content_id,
        trigger_source=trigger_source,
        trigger_ref_id=trigger_ref_id,
        dedupe_key=dedupe_key,
        window_start_at=window_start_at,
        window_end_at=window_end_at,
        scheduled_at=scheduled_at,
        created_by=created_by,
    )
    db.add(row)
    await db.flush()


async def enqueue_audio_actions_for_reading_content(
    db: AsyncSession,
    content: MagicReadingContent,
    targets: list[MagicReadingContentTarget],
    *,
    created_by: int | None,
    auto_checkin_whitelist_user_ids: set[int] | None = None,
) -> None:
    settings = await _get_auto_action_settings(db)
    window_minutes = int(settings.audio_random_window_minutes or 0) if settings else 0
    target_users = await _collect_reading_target_users(db, targets)
    if auto_checkin_whitelist_user_ids is None:
        whitelist_users = await _get_enabled_whitelist_users(
            db,
            target_user_ids=[item.id for item in target_users],
            flag_name="auto_checkin_enabled",
        )
    else:
        whitelist_users = [item for item in target_users if int(item.id) in auto_checkin_whitelist_user_ids]
    for user in whitelist_users:
        dedupe_key = f"audio:{content.id}:{user.id}:{content.reading_date.isoformat()}"
        await _create_auto_action(
            db,
            action_type=AUTO_ACTION_AUDIO,
            target_user_id=user.id,
            target_date=content.reading_date,
            video_id=None,
            reading_content_id=int(content.id),
            trigger_source="reading_content_created",
            trigger_ref_id=int(content.id),
            dedupe_key=dedupe_key,
            window_minutes=window_minutes,
            created_by=created_by,
        )


async def enqueue_video_actions_for_video(
    db: AsyncSession,
    video: MagicVideo,
    targets: list[MagicVideoTarget],
    *,
    created_by: int | None,
) -> None:
    settings = await _get_auto_action_settings(db)
    window_minutes = int(settings.video_random_window_minutes or 0) if settings else 0
    target_users = await _collect_video_target_users(db, video, targets)
    whitelist_users = await _get_enabled_whitelist_users(
        db,
        target_user_ids=[item.id for item in target_users],
        flag_name="course_exempt_enabled",
    )
    for user in whitelist_users:
        dedupe_key = f"video:{video.id}:{user.id}"
        await _create_auto_action(
            db,
            action_type=AUTO_ACTION_VIDEO,
            target_user_id=user.id,
            target_date=None,
            video_id=int(video.id),
            reading_content_id=None,
            trigger_source="video_published",
            trigger_ref_id=int(video.id),
            dedupe_key=dedupe_key,
            window_minutes=window_minutes,
            created_by=created_by,
        )


async def _resolve_video_duration(db: AsyncSession, video: MagicVideo) -> float:
    direct = float(video.duration_seconds or video.duration or 0)
    if direct > 0:
        return direct
    result = await db.execute(
        select(
            func.max(
                func.greatest(
                    func.coalesce(MagicVideoProgress.total_duration, 0),
                    func.coalesce(MagicVideoProgress.max_watched_position, 0),
                    func.coalesce(MagicVideoProgress.current_position, 0),
                )
            )
        ).where(MagicVideoProgress.video_id == video.id)
    )
    return float(result.scalar() or 0)


async def _execute_audio_action(db: AsyncSession, action: MagicAutoAction) -> None:
    if not action.target_date:
        action.status = AUTO_ACTION_FAILED
        action.last_error = "missing target_date"
        return
    existing_result = await db.execute(
        select(MagicAudioUpload)
        .where(
            MagicAudioUpload.user_id == action.target_user_id,
            MagicAudioUpload.is_deleted.is_(False),
            MagicAudioUpload.reading_content_id == action.reading_content_id,
        )
        .order_by(MagicAudioUpload.id.asc())
    )
    existing_rows = existing_result.scalars().all()
    if existing_rows:
        primary = existing_rows[0]
        for duplicate in existing_rows[1:]:
            duplicate.is_deleted = True
            duplicate.deleted_at = _now()
        if (primary.source or "") == SOURCE_WHITELIST_AUTO:
            primary.auto_checkin_by_whitelist = True
        action.status = AUTO_ACTION_DONE
        action.executed_at = _now()
        return
    row = MagicAudioUpload(
        user_id=action.target_user_id,
        reading_content_id=action.reading_content_id,
        file_name="whitelist_auto_checkin",
        file_path="",
        file_size=0,
        mime_type="",
        remark="白名单自动打卡",
        source=SOURCE_WHITELIST_AUTO,
        auto_checkin_by_whitelist=True,
        uploaded_on=_now(),
        uploaded_date=action.target_date,
        is_deleted=False,
    )
    db.add(row)
    await db.flush()
    action.status = AUTO_ACTION_DONE
    action.executed_at = _now()


async def _execute_video_action(db: AsyncSession, action: MagicAutoAction) -> None:
    if not action.video_id:
        action.status = AUTO_ACTION_FAILED
        action.last_error = "missing video_id"
        return
    video = await db.get(MagicVideo, action.video_id)
    if not video or video.deleted_at or (video.status or "").strip().lower() != "published":
        action.status = AUTO_ACTION_FAILED
        action.last_error = "video unavailable"
        return
    duration = await _resolve_video_duration(db, video)
    result = await db.execute(
        select(MagicVideoProgress).where(
            MagicVideoProgress.user_id == action.target_user_id,
            MagicVideoProgress.video_id == action.video_id,
        )
    )
    progress = result.scalar_one_or_none()
    if progress is None:
        progress = MagicVideoProgress(user_id=action.target_user_id, video_id=action.video_id)
        db.add(progress)
        await db.flush()
    progress.current_position = duration
    progress.max_watched_position = duration
    progress.total_duration = duration
    progress.progress_percent = 100.0
    progress.is_completed = True
    progress.quiz_passed = True
    progress.completed_by_whitelist = True
    progress.progress_source = SOURCE_WHITELIST_EXEMPT
    if not progress.completed_at:
        progress.completed_at = _now()
    progress.last_watched_at = _now()
    action.status = AUTO_ACTION_DONE
    action.executed_at = _now()


async def process_pending_auto_actions(limit: int = 100) -> int:
    processed = 0
    async with session_scope() as db:
        now = _now()
        result = await db.execute(
            select(MagicAutoAction)
            .where(
                MagicAutoAction.status == AUTO_ACTION_PENDING,
                or_(
                    MagicAutoAction.scheduled_at <= now,
                    MagicAutoAction.window_end_at <= now,
                ),
            )
            .order_by(MagicAutoAction.scheduled_at.asc(), MagicAutoAction.id.asc())
            .limit(limit)
        )
        actions = result.scalars().all()
        for action in actions:
            processed += 1
            action.attempt_count = int(action.attempt_count or 0) + 1
            action.last_error = ""
            try:
                if action.action_type == AUTO_ACTION_AUDIO:
                    await _execute_audio_action(db, action)
                elif action.action_type == AUTO_ACTION_VIDEO:
                    await _execute_video_action(db, action)
                else:
                    action.status = AUTO_ACTION_FAILED
                    action.last_error = f"unsupported action_type: {action.action_type}"
            except Exception as exc:  # noqa: BLE001
                action.last_error = str(exc)[:2000]
                if action.window_end_at <= now:
                    action.status = AUTO_ACTION_FAILED
    return processed


async def auto_action_worker(stop_event: asyncio.Event) -> None:
    while not stop_event.is_set():
        try:
            await process_pending_auto_actions()
        except Exception:  # noqa: BLE001
            pass
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=AUTO_ACTION_POLL_SECONDS)
        except TimeoutError:
            continue
