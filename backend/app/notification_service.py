from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Awaitable, Callable

from sqlalchemy import distinct, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .config import get_settings
from .db import session_scope
from .models import (
    Exam,
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
    *,
    event_type: str,
    recipient_user_id: int | None,
    recipient_wecom_userid: str | None,
    business_type: str,
    business_id: int | None,
    payload: dict[str, Any],
) -> int:
    """在独立事务里写一条 pending 日志，返回它的 id。

    历史 bug：以前用业务 session 写日志，企微 API 一抛错，业务 session 被
    rollback，日志连带消失。改成独立 session_scope() 之后，日志写入和后续
    finalize 都不会被业务事务影响——失败行也能稳定落库供监控页排查。
    """
    async with session_scope() as session:
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
        session.add(row)
        await session.flush()
        return int(row.id)


async def _finalize_log(
    log_id: int,
    *,
    status: str,
    response: dict[str, Any] | None = None,
    error: str = "",
) -> None:
    """在独立事务里把日志行从 pending 改成 sent/failed。

    单条失败不会阻塞其它行——内部已 swallow 异常，调用方不需要 try。
    """
    try:
        async with session_scope() as session:
            row = await session.get(NotificationLog, log_id)
            if row is None:
                return
            row.status = status
            row.response_json = json.dumps(response, ensure_ascii=False) if response is not None else None
            row.error = error or None
            row.sent_at = datetime.now() if status == "sent" else None
    except Exception:  # noqa: BLE001
        logger.exception("finalize_log failed for log_id=%s status=%s", log_id, status)


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
    """企微推送统一入口。

    日志（notification_logs）走独立事务，不受调用方 session 状态影响。
    业务侧（paper_assignments.wecom_push_status / wecom_push_error）由 push_assignment
    自行更新，本函数只对日志负责。

    db 参数仅用于读业务数据（接收人 User 等），本函数不会在 db 上写任何东西。
    """
    del db  # 为了向后兼容签名保留参数；本函数不写业务 session
    if not _settings.wecom_push_ready:
        raise WecomApiError("企业微信推送未启用或配置不完整。")

    log_ids: list[tuple[int, str | None]] = []  # (log_id, wecom_userid 小写规范化)
    userids: list[str] = []
    seen_userids: set[str] = set()
    payload = {"title": title, "description": description, "url": url}

    for user in recipients:
        userid = (user.wecom_userid or "").strip()
        normalized = userid.lower()
        if not userid:
            log_id = await _create_log(
                event_type=event_type,
                recipient_user_id=int(user.id),
                recipient_wecom_userid=None,
                business_type=business_type,
                business_id=business_id,
                payload=payload,
            )
            await _finalize_log(log_id, status="failed", error="接收人尚未绑定企业微信 userid。")
            continue
        if normalized in seen_userids:
            continue
        log_id = await _create_log(
            event_type=event_type,
            recipient_user_id=int(user.id),
            recipient_wecom_userid=userid,
            business_type=business_type,
            business_id=business_id,
            payload=payload,
        )
        log_ids.append((log_id, normalized))
        userids.append(userid)
        seen_userids.add(normalized)

    for userid in extra_wecom_userids or []:
        clean_userid = userid.strip()
        normalized = clean_userid.lower()
        if not clean_userid or normalized in seen_userids:
            continue
        log_id = await _create_log(
            event_type=event_type,
            recipient_user_id=None,
            recipient_wecom_userid=clean_userid,
            business_type=business_type,
            business_id=business_id,
            payload=payload,
        )
        log_ids.append((log_id, normalized))
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
        for log_id, normalized in log_ids:
            if normalized in failed_set:
                await _finalize_log(log_id, status="failed", error=str(exc))
            else:
                await _finalize_log(log_id, status="sent", response=exc.detail)
        raise
    except Exception as exc:  # noqa: BLE001
        for log_id, _ in log_ids:
            await _finalize_log(log_id, status="failed", error=str(exc))
        raise

    for log_id, _ in log_ids:
        await _finalize_log(log_id, status="sent", response=response)
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


async def notify_paper_assignment(db: AsyncSession, assignment: PaperAssignment) -> dict[str, Any] | None:
    paper = await db.get(Paper, assignment.paper_id)
    user = await db.get(User, assignment.user_id)
    if not paper or not user:
        raise WecomApiError("试卷派发数据不完整，无法推送。")
    if bool(user.disabled):
        # 离职 / 禁用员工不参与任何业务，静默跳过。
        return None

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


async def notify_paper_deadline_reminder(db: AsyncSession, assignment: PaperAssignment) -> dict[str, Any] | None:
    paper = await db.get(Paper, assignment.paper_id)
    user = await db.get(User, assignment.user_id)
    if not paper or not user:
        raise WecomApiError("试卷派发数据不完整，无法提醒。")
    if bool(user.disabled):
        return None

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


async def notify_exam_assigned(db: AsyncSession, exam: Exam) -> dict[str, Any] | None:
    user = await db.get(User, exam.user_id)
    if not user:
        raise WecomApiError("AI通关派发数据不完整，无法推送。")
    if bool(user.disabled):
        return None

    deadline = exam.deadline_at.strftime("%Y-%m-%d %H:%M") if exam.deadline_at else "不限"
    description = (
        '<div class="gray">AI通关任务通知</div>'
        f'<div class="normal">任务：{exam.title}</div>'
        f'<div class="normal">最多尝试：{exam.max_attempts} 次</div>'
        f'<div class="normal">截止：{deadline}</div>'
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


async def notify_exam_deadline_reminder(db: AsyncSession, exam: Exam) -> dict[str, Any] | None:
    user = await db.get(User, exam.user_id)
    if not user:
        raise WecomApiError("AI通关数据不完整，无法提醒。")
    if bool(user.disabled):
        return None

    deadline = exam.deadline_at.strftime("%Y-%m-%d %H:%M") if exam.deadline_at else "不限"
    description = (
        '<div class="gray">AI通关截止提醒</div>'
        f'<div class="normal">任务：{exam.title}</div>'
        f'<div class="normal">截止：{deadline}</div>'
    )
    return await send_wecom_message(
        db,
        event_type="exam_deadline_reminder",
        recipients=[user],
        business_type="exam",
        business_id=int(exam.id),
        title="AI通关任务即将截止",
        description=description,
        url=_frontend_url("/training/challenges?filter=pending"),
    )


# ---- 推送监控统一重推 ----
#
# 设计：失败的 notification_log 是历史只读快照，重推时不"修改"原行；而是按
# event_type / business_type / business_id 拉回原业务对象，重新走对应的
# notify_* 路径。每次重推会写一条 NEW 的 notification_log（pending → sent/failed），
# 这样监控页可以同时看到历史失败 + 最近一次重推结果。
#
# 调用方拿到的是逐条 ResendOutcome，可以聚合给前端展示"X 条已重推、Y 条跳过"。


_PAPER_EVENT_TYPES = {"paper_assigned", "paper_deadline_reminder", "paper_submission_received"}
_EXAM_EVENT_TYPES = {"exam_assigned", "exam_deadline_reminder"}
_MAGIC_EVENT_TYPES = {"magic_video_assigned", "magic_reading_published"}


@dataclass(slots=True)
class ResendOutcome:
    log_id: int
    status: str  # sent / failed / skipped
    message: str = ""


async def _resend_paper_assignment(db: AsyncSession, log: NotificationLog) -> ResendOutcome:
    if not log.business_id:
        return ResendOutcome(int(log.id), "skipped", "原日志缺少派发 ID。")
    assignment = await db.get(PaperAssignment, int(log.business_id))
    if assignment is None:
        return ResendOutcome(int(log.id), "skipped", "派发任务已不存在。")
    try:
        if log.event_type == "paper_deadline_reminder":
            await notify_paper_deadline_reminder(db, assignment)
        else:
            await notify_paper_assignment(db, assignment)
        # 同步业务侧推送状态（与 wecom_push.push_assignment 保持一致）
        if log.event_type == "paper_assigned":
            assignment.wecom_push_status = "sent"
            assignment.wecom_push_error = None
            assignment.wecom_pushed_at = datetime.now()
        return ResendOutcome(int(log.id), "sent")
    except (WecomApiError, WecomPartialFailure) as exc:
        if log.event_type == "paper_assigned":
            assignment.wecom_push_status = "failed"
            assignment.wecom_push_error = str(exc)
            assignment.wecom_pushed_at = datetime.now()
        return ResendOutcome(int(log.id), "failed", str(exc))


async def _resend_paper_submission(db: AsyncSession, log: NotificationLog) -> ResendOutcome:
    if not log.business_id:
        return ResendOutcome(int(log.id), "skipped", "原日志缺少提交 ID。")
    submission = await db.get(PaperSubmission, int(log.business_id))
    if submission is None:
        return ResendOutcome(int(log.id), "skipped", "试卷提交已不存在。")
    try:
        await notify_submission_received(db, submission)
        return ResendOutcome(int(log.id), "sent")
    except (WecomApiError, WecomPartialFailure) as exc:
        return ResendOutcome(int(log.id), "failed", str(exc))


async def _resend_exam(db: AsyncSession, log: NotificationLog) -> ResendOutcome:
    if not log.business_id:
        return ResendOutcome(int(log.id), "skipped", "原日志缺少通关 ID。")
    exam = await db.get(Exam, int(log.business_id))
    if exam is None:
        return ResendOutcome(int(log.id), "skipped", "AI 通关任务已不存在。")
    try:
        if log.event_type == "exam_deadline_reminder":
            await notify_exam_deadline_reminder(db, exam)
        else:
            await notify_exam_assigned(db, exam)
        return ResendOutcome(int(log.id), "sent")
    except (WecomApiError, WecomPartialFailure) as exc:
        return ResendOutcome(int(log.id), "failed", str(exc))


async def _resend_magic(db: AsyncSession, log: NotificationLog) -> ResendOutcome:
    """魔学院课程/读物失败重推：仅针对原日志的接收人单条重发。

    这里不走 magic_push_service.run_*_manual_retry —— 那个是"按内容批量补推
    所有未送达对象"，会一次拉一大批人。监控页要的是"对就这一条失败重发一次"。
    """
    from .models import MagicReadingContent, MagicVideo  # 局部 import 避免循环依赖
    from .magic_push_service import (
        build_course_notification_message,
        build_reading_notification_message,
    )

    if log.recipient_user_id is None:
        return ResendOutcome(int(log.id), "skipped", "原日志缺少接收人。")
    user = await db.get(User, int(log.recipient_user_id))
    if user is None or bool(user.disabled):
        return ResendOutcome(int(log.id), "skipped", "接收人已被禁用或删除。")

    if log.event_type == "magic_video_assigned":
        if not log.business_id:
            return ResendOutcome(int(log.id), "skipped", "原日志缺少课程 ID。")
        video = await db.get(MagicVideo, int(log.business_id))
        if video is None or video.deleted_at is not None:
            return ResendOutcome(int(log.id), "skipped", "课程已不存在。")
        title, description, url = build_course_notification_message(video)
        business_type = "magic_video"
    else:  # magic_reading_published
        if not log.business_id:
            return ResendOutcome(int(log.id), "skipped", "原日志缺少读物 ID。")
        content = await db.get(MagicReadingContent, int(log.business_id))
        if content is None or bool(content.is_deleted):
            return ResendOutcome(int(log.id), "skipped", "读物已不存在。")
        title, description, url = build_reading_notification_message(content)
        business_type = "magic_reading"

    try:
        await send_wecom_message(
            db,
            event_type=log.event_type,
            recipients=[user],
            business_type=business_type,
            business_id=int(log.business_id) if log.business_id else None,
            title=title,
            description=description,
            url=url,
        )
        return ResendOutcome(int(log.id), "sent")
    except (WecomApiError, WecomPartialFailure) as exc:
        return ResendOutcome(int(log.id), "failed", str(exc))


async def resend_notification(db: AsyncSession, log_id: int) -> ResendOutcome:
    """重推一条历史失败的 notification_log。

    - 不修改原行：原行作为历史记录保留。
    - 重推过程会写一条新的 notification_log（由 send_wecom_message 走标准路径）。
    - 业务侧 push_status（paper_assignments / 等）按需回写。
    """
    if not _settings.wecom_push_ready:
        raise WecomApiError("企业微信推送未启用或配置不完整。")
    log = await db.get(NotificationLog, int(log_id))
    if log is None:
        raise WecomApiError("推送记录不存在。")
    if (log.status or "").strip().lower() == "sent":
        return ResendOutcome(int(log.id), "skipped", "该记录已成功，不需要重推。")

    event_type = (log.event_type or "").strip()
    if event_type == "paper_submission_received":
        return await _resend_paper_submission(db, log)
    if event_type in _PAPER_EVENT_TYPES:
        return await _resend_paper_assignment(db, log)
    if event_type in _EXAM_EVENT_TYPES:
        return await _resend_exam(db, log)
    if event_type in _MAGIC_EVENT_TYPES:
        return await _resend_magic(db, log)
    return ResendOutcome(int(log.id), "skipped", f"暂不支持重推该事件：{event_type}")


async def resend_notifications_bulk(
    db: AsyncSession,
    log_ids: list[int],
) -> dict[str, Any]:
    """按 ids 批量重推。逐条独立处理，单条失败不影响其它行。"""
    sent = 0
    failed = 0
    skipped = 0
    items: list[dict[str, Any]] = []
    for raw_id in log_ids:
        try:
            outcome = await resend_notification(db, int(raw_id))
        except WecomApiError as exc:
            outcome = ResendOutcome(int(raw_id), "failed", str(exc))
        except Exception as exc:  # noqa: BLE001
            logger.exception("resend_notification unexpected error log_id=%s", raw_id)
            outcome = ResendOutcome(int(raw_id), "failed", str(exc))
        if outcome.status == "sent":
            sent += 1
        elif outcome.status == "failed":
            failed += 1
        else:
            skipped += 1
        items.append({
            "log_id": outcome.log_id,
            "status": outcome.status,
            "message": outcome.message,
        })
    return {
        "sent": sent,
        "failed": failed,
        "skipped": skipped,
        "items": items,
    }
