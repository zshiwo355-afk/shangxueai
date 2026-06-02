from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Any, Awaitable, Callable

from sqlalchemy import distinct, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .config import get_settings
from .db import session_scope
from .models import (
    Exam,
    ExamAttempt,
    NotificationLog,
    Paper,
    PaperAssignment,
    PaperSubmission,
    User,
)
from .wecom_client import WecomApiError, WecomClient, WecomPartialFailure


_settings = get_settings()
_wecom_client = WecomClient()
logger = logging.getLogger(__name__)


def _frontend_url(path: str) -> str:
    base = _settings.resolved_wecom_frontend_base_url
    if not base:
        return ""
    clean_path = path if path.startswith("/") else f"/{path}"
    return f"{base}{clean_path}"


def _display_name(user: User | None) -> str:
    if not user:
        return ""
    return user.real_name or user.display_name or user.username


def _score_text(value: float | int | None) -> str:
    if value is None:
        return "待确认"
    return str(round(float(value), 2))


def _configured_admin_wecom_userids() -> list[str]:
    values = _settings.wecom_admin_userids or ""
    return [item.strip() for item in values.split(",") if item.strip()]


async def _admin_recipients(db: AsyncSession) -> list[User]:
    rows = await db.execute(
        select(User).where(
            User.role.in_(["admin", "super_admin"]),
            User.disabled == False,  # noqa: E712
        )
    )
    return [user for user in rows.scalars().all() if (user.wecom_userid or "").strip()]


async def _create_log(
    db: AsyncSession,
    *,
    event_type: str,
    recipient_user_id: int | None,
    recipient_wecom_userid: str | None,
    business_type: str,
    business_id: int | None,
    payload: dict[str, Any],
) -> NotificationLog:
    row = NotificationLog(
        channel="wecom",
        event_type=event_type,
        recipient_user_id=recipient_user_id,
        recipient_wecom_userid=recipient_wecom_userid,
        business_type=business_type,
        business_id=business_id,
        status="pending",
        payload_json=json.dumps(payload, ensure_ascii=False),
    )
    db.add(row)
    await db.flush()
    return row


async def _finalize_log(
    db: AsyncSession,
    row: NotificationLog,
    *,
    status: str,
    response: dict[str, Any] | None = None,
    error: str = "",
) -> None:
    row.status = status
    row.response_json = json.dumps(response, ensure_ascii=False) if response is not None else None
    row.error = error or None
    row.sent_at = datetime.now() if status == "sent" else None
    await db.flush()


async def send_wecom_message(
    db: AsyncSession,
    *,
    event_type: str,
    recipients: list[User],
    business_type: str,
    business_id: int | None,
    title: str,
    description: str,
    url: str = "",
    extra_wecom_userids: list[str] | None = None,
) -> dict[str, Any]:
    if not _settings.wecom_push_ready:
        raise WecomApiError("企业微信推送未启用或配置不完整。")

    logs: list[NotificationLog] = []
    userids: list[str] = []
    seen_userids: set[str] = set()
    payload = {"title": title, "description": description, "url": url}

    for user in recipients:
        userid = (user.wecom_userid or "").strip()
        normalized = userid.lower()
        if not userid:
            row = await _create_log(
                db,
                event_type=event_type,
                recipient_user_id=int(user.id),
                recipient_wecom_userid=None,
                business_type=business_type,
                business_id=business_id,
                payload=payload,
            )
            await _finalize_log(db, row, status="failed", error="接收人尚未绑定企业微信 userid。")
            logs.append(row)
            continue
        if normalized in seen_userids:
            continue
        logs.append(
            await _create_log(
                db,
                event_type=event_type,
                recipient_user_id=int(user.id),
                recipient_wecom_userid=userid,
                business_type=business_type,
                business_id=business_id,
                payload=payload,
            )
        )
        userids.append(userid)
        seen_userids.add(normalized)

    for userid in extra_wecom_userids or []:
        clean_userid = userid.strip()
        normalized = clean_userid.lower()
        if not clean_userid or normalized in seen_userids:
            continue
        logs.append(
            await _create_log(
                db,
                event_type=event_type,
                recipient_user_id=None,
                recipient_wecom_userid=clean_userid,
                business_type=business_type,
                business_id=business_id,
                payload=payload,
            )
        )
        userids.append(clean_userid)
        seen_userids.add(normalized)

    if not userids:
        raise WecomApiError("没有可发送的企业微信接收人。")

    try:
        response = await _wecom_client.send_app_message(
            touser=userids,
            title=title,
            description=description,
            url=url,
        )
    except WecomPartialFailure as exc:
        failed_set = {item.lower() for item in exc.failed_userids}
        for row in logs:
            recipient = (row.recipient_wecom_userid or "").strip().lower()
            if recipient in failed_set:
                await _finalize_log(db, row, status="failed", error=str(exc))
            else:
                await _finalize_log(db, row, status="sent", response=exc.detail)
        raise
    except Exception as exc:  # noqa: BLE001
        for row in logs:
            await _finalize_log(db, row, status="failed", error=str(exc))
        raise

    for row in logs:
        await _finalize_log(db, row, status="sent", response=response)
    return response


async def safe_dispatch(
    notify_fn: Callable[[AsyncSession], Awaitable[Any]],
    *,
    event: str,
    business_id: int | None = None,
) -> None:
    if not _settings.wecom_enabled or not _settings.wecom_push_enabled:
        return
    try:
        async with session_scope() as session:
            await notify_fn(session)
    except WecomPartialFailure as exc:
        logger.warning("[notify:%s] partial failure id=%s detail=%s", event, business_id, exc.detail)
    except WecomApiError as exc:
        logger.warning("[notify:%s] wecom api error id=%s err=%s", event, business_id, exc)
    except Exception:  # noqa: BLE001
        logger.exception("[notify:%s] unexpected error id=%s", event, business_id)


async def notify_paper_assignment(db: AsyncSession, assignment: PaperAssignment) -> dict[str, Any]:
    paper = await db.get(Paper, assignment.paper_id)
    user = await db.get(User, assignment.user_id)
    if not paper or not user:
        raise WecomApiError("试卷派发数据不完整，无法推送。")

    deadline = assignment.deadline_at.strftime("%Y-%m-%d %H:%M") if assignment.deadline_at else "不限"
    description = (
        '<div class="gray">试卷任务通知</div>'
        f'<div class="normal">试卷：{paper.title}</div>'
        f'<div class="normal">截止：{deadline}</div>'
    )
    return await send_wecom_message(
        db,
        event_type="paper_assigned",
        recipients=[user],
        business_type="paper_assignment",
        business_id=int(assignment.id),
        title="你有新的试卷任务",
        description=description,
        url=_frontend_url("/papers?filter=todo"),
    )


async def notify_paper_deadline_reminder(db: AsyncSession, assignment: PaperAssignment) -> dict[str, Any]:
    paper = await db.get(Paper, assignment.paper_id)
    user = await db.get(User, assignment.user_id)
    if not paper or not user:
        raise WecomApiError("试卷派发数据不完整，无法提醒。")

    deadline = assignment.deadline_at.strftime("%Y-%m-%d %H:%M") if assignment.deadline_at else "不限"
    description = (
        '<div class="gray">试卷截止提醒</div>'
        f'<div class="normal">试卷：{paper.title}</div>'
        f'<div class="normal">截止：{deadline}</div>'
    )
    return await send_wecom_message(
        db,
        event_type="paper_deadline_reminder",
        recipients=[user],
        business_type="paper_assignment",
        business_id=int(assignment.id),
        title="试卷任务即将截止",
        description=description,
        url=_frontend_url("/papers?filter=todo"),
    )


async def notify_submission_received(db: AsyncSession, submission: PaperSubmission) -> dict[str, Any] | None:
    assignment = await db.get(PaperAssignment, submission.assignment_id)
    paper = await db.get(Paper, submission.paper_id)
    submitter = await db.get(User, submission.user_id)
    if not assignment or not paper:
        return None

    admins = await _admin_recipients(db)
    fixed_admin_userids = _configured_admin_wecom_userids()
    if not admins and not fixed_admin_userids:
        return None

    total_assigned = int(
        (
            await db.execute(
                select(func.count(PaperAssignment.id)).where(PaperAssignment.paper_id == submission.paper_id)
            )
        ).scalar_one()
        or 0
    )
    submitted_count = int(
        (
            await db.execute(
                select(func.count(distinct(PaperSubmission.assignment_id))).where(
                    PaperSubmission.paper_id == submission.paper_id,
                    PaperSubmission.status.in_(["submitted", "graded"]),
                )
            )
        ).scalar_one()
        or 0
    )
    pending_count = max(total_assigned - submitted_count, 0)
    submitter_name = _display_name(submitter) or "学员"

    description = (
        '<div class="gray">试卷提交进度更新</div>'
        f'<div class="normal">试卷：{paper.title}</div>'
        f'<div class="normal">最新提交：{submitter_name}</div>'
        f'<div class="normal">已派发：{total_assigned} 人</div>'
        f'<div class="normal">已提交：{submitted_count} 人</div>'
        f'<div class="normal">未提交：{pending_count} 人</div>'
    )
    return await send_wecom_message(
        db,
        event_type="paper_submission_received",
        recipients=admins,
        extra_wecom_userids=fixed_admin_userids,
        business_type="paper_submission",
        business_id=int(submission.id),
        title="有学员提交了试卷",
        description=description,
        url=_frontend_url("/admin/papers/assignments"),
    )


async def notify_submission_pending_review(db: AsyncSession, submission: PaperSubmission) -> dict[str, Any] | None:
    del db, submission
    return None


async def notify_submission_graded(db: AsyncSession, submission: PaperSubmission) -> dict[str, Any] | None:
    del db, submission
    return None


async def notify_exam_assigned(db: AsyncSession, exam: Exam) -> dict[str, Any] | None:
    user = await db.get(User, exam.user_id)
    if not user:
        raise WecomApiError("AI通关派发数据不完整，无法推送。")

    description = (
        '<div class="gray">AI通关任务通知</div>'
        f'<div class="normal">任务：{exam.title}</div>'
        f'<div class="normal">最多尝试：{exam.max_attempts} 次</div>'
    )
    return await send_wecom_message(
        db,
        event_type="exam_assigned",
        recipients=[user],
        business_type="exam",
        business_id=int(exam.id),
        title="你有新的AI通关任务",
        description=description,
        url=_frontend_url("/training/challenges?filter=pending"),
    )


async def notify_exam_pending_review(db: AsyncSession, attempt: ExamAttempt) -> dict[str, Any] | None:
    del db, attempt
    return None


async def notify_exam_reviewed(db: AsyncSession, attempt: ExamAttempt) -> dict[str, Any] | None:
    del db, attempt
    return None
