"""截止提醒后台 worker。

每隔 POLL_SECONDS 扫一次：
  - paper_assignments：deadline_at ∈ [now, now+24h]，且 status='pending'（一次都没开始）
  - exams：deadline_at ∈ [now, now+24h]，且 attempt_count == 0（一次都没考）

去重靠 notification_logs：每条 business_id 永久只发一次，failed 才会重试。
所以"每条任务只推一次"是由去重保证的，worker 周期扫表只是为了发现新建的任务。
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .config import get_settings
from .db import session_scope
from .models import (
    Exam,
    NotificationLog,
    PaperAssignment,
    User,
)
from .notification_service import (
    notify_exam_deadline_reminder,
    notify_paper_deadline_reminder,
)

logger = logging.getLogger("app.deadline_reminder_worker")

POLL_SECONDS = 3600  # 1 小时扫一次


async def _already_reminded(
    db: AsyncSession,
    *,
    event_type: str,
    business_type: str,
    business_id: int,
) -> bool:
    """这条 business_id 是否已经成功推送过同类型提醒。永久去重。"""
    row = (
        await db.execute(
            select(NotificationLog.id).where(
                NotificationLog.event_type == event_type,
                NotificationLog.business_type == business_type,
                NotificationLog.business_id == business_id,
                NotificationLog.status == "sent",
            ).limit(1)
        )
    ).first()
    return row is not None


async def _scan_paper_assignments(db: AsyncSession) -> list[int]:
    """deadline 在未来 24h、且学员一次都没点开始（status='pending'）。

    join User 过滤离职 / 禁用员工——这些人已不参与任何业务，不应再收到提醒。
    """
    now = datetime.now()
    upper = now + timedelta(hours=24)
    rows = (
        await db.execute(
            select(PaperAssignment.id)
            .join(User, User.id == PaperAssignment.user_id)
            .where(
                PaperAssignment.deadline_at.is_not(None),
                PaperAssignment.deadline_at >= now,
                PaperAssignment.deadline_at <= upper,
                PaperAssignment.status == "pending",
                User.disabled.is_(False),
            )
        )
    ).all()
    return [int(r[0]) for r in rows]


async def _scan_exams(db: AsyncSession) -> list[int]:
    """deadline 在未来 24h、且学员一次都没考（attempt_count == 0）。

    join User 过滤离职 / 禁用员工。
    """
    now = datetime.now()
    upper = now + timedelta(hours=24)
    rows = (
        await db.execute(
            select(Exam.id)
            .join(User, User.id == Exam.user_id)
            .where(
                Exam.deadline_at.is_not(None),
                Exam.deadline_at >= now,
                Exam.deadline_at <= upper,
                Exam.attempt_count == 0,
                User.disabled.is_(False),
            )
        )
    ).all()
    return [int(r[0]) for r in rows]


async def _remind_paper_assignment(assignment_id: int) -> None:
    async with session_scope() as session:
        if await _already_reminded(
            session,
            event_type="paper_deadline_reminder",
            business_type="paper_assignment",
            business_id=assignment_id,
        ):
            return
        assignment = await session.get(PaperAssignment, assignment_id)
        if assignment is None:
            return
        try:
            await notify_paper_deadline_reminder(session, assignment)
        except Exception:  # noqa: BLE001
            # 推送失败已经写进 notification_logs，记 warn 即可
            logger.warning("paper deadline reminder failed assignment_id=%s", assignment_id, exc_info=True)


async def _remind_exam(exam_id: int) -> None:
    async with session_scope() as session:
        if await _already_reminded(
            session,
            event_type="exam_deadline_reminder",
            business_type="exam",
            business_id=exam_id,
        ):
            return
        exam = await session.get(Exam, exam_id)
        if exam is None:
            return
        try:
            await notify_exam_deadline_reminder(session, exam)
        except Exception:  # noqa: BLE001
            logger.warning("exam deadline reminder failed exam_id=%s", exam_id, exc_info=True)


async def deadline_reminder_worker(stop_event: asyncio.Event) -> None:
    """后台 worker：固定间隔扫表 + 推送，进程内单实例。"""
    settings = get_settings()
    # 推送整体没启用就不转一次空圈
    if not settings.wecom_enabled or not settings.wecom_push_enabled:
        logger.info("deadline_reminder_worker disabled: wecom push not enabled.")
        return

    logger.info("deadline_reminder_worker started, poll every %ss", POLL_SECONDS)

    while not stop_event.is_set():
        try:
            async with session_scope() as session:
                paper_ids = await _scan_paper_assignments(session)
                exam_ids = await _scan_exams(session)
        except Exception:  # noqa: BLE001
            logger.exception("deadline_reminder_worker scan failed")
            paper_ids = []
            exam_ids = []

        for aid in paper_ids:
            if stop_event.is_set():
                break
            try:
                await _remind_paper_assignment(aid)
            except Exception:  # noqa: BLE001
                logger.exception("paper reminder dispatch failed id=%s", aid)

        for eid in exam_ids:
            if stop_event.is_set():
                break
            try:
                await _remind_exam(eid)
            except Exception:  # noqa: BLE001
                logger.exception("exam reminder dispatch failed id=%s", eid)

        try:
            await asyncio.wait_for(stop_event.wait(), timeout=POLL_SECONDS)
        except (TimeoutError, asyncio.TimeoutError):
            continue
