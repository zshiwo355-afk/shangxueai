from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .models import Paper, PaperAssignment, User
from .notification_service import notify_paper_assignment
from .wecom_client import WecomApiError

logger = logging.getLogger(__name__)


@dataclass
class PushResult:
    ok: bool
    status: str
    message: str
    payload: dict[str, Any] | None = None


async def push_assignment(assignment_id: int, db: AsyncSession) -> PushResult:
    res = await db.execute(select(PaperAssignment).where(PaperAssignment.id == assignment_id))
    assignment = res.scalar_one_or_none()
    if not assignment:
        return PushResult(ok=False, status="failed", message="派发任务不存在。")

    paper_res = await db.execute(select(Paper).where(Paper.id == assignment.paper_id))
    paper = paper_res.scalar_one_or_none()
    user_res = await db.execute(select(User).where(User.id == assignment.user_id))
    user = user_res.scalar_one_or_none()

    payload = {
        "type": "paper_assignment",
        "assignment_id": assignment.id,
        "paper_id": assignment.paper_id,
        "paper_title": paper.title if paper else "",
        "user_id": assignment.user_id,
        "user_name": (user.real_name or user.display_name or user.username) if user else "",
        "deadline_at": assignment.deadline_at.isoformat() if assignment.deadline_at else None,
        "max_attempts": assignment.max_attempts,
    }
    assignment.wecom_push_payload_json = json.dumps(payload, ensure_ascii=False)
    assignment.wecom_push_error = None

    try:
        response = await notify_paper_assignment(db, assignment)
    except WecomApiError as exc:
        assignment.wecom_push_status = "failed"
        assignment.wecom_push_error = str(exc)
        assignment.wecom_pushed_at = datetime.now()
        logger.warning("[wecom_push] send failed assignment_id=%s error=%s", assignment_id, exc)
        return PushResult(ok=False, status="failed", message=str(exc), payload=payload)
    except Exception as exc:  # noqa: BLE001
        assignment.wecom_push_status = "failed"
        assignment.wecom_push_error = str(exc)
        assignment.wecom_pushed_at = datetime.now()
        logger.exception("[wecom_push] unexpected error assignment_id=%s", assignment_id)
        return PushResult(ok=False, status="failed", message=str(exc), payload=payload)

    assignment.wecom_push_status = "sent"
    assignment.wecom_push_error = None
    assignment.wecom_pushed_at = datetime.now()
    logger.info("[wecom_push] sent assignment_id=%s payload=%s", assignment_id, payload)
    return PushResult(ok=True, status="sent", message="企业微信推送成功。", payload=response)
