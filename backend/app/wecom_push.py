"""企业微信推送 stub。

当前只做占位，把推送状态置为 pending 并写日志，等接入企微应用消息后替换实现。
保持函数签名稳定，避免日后改路由。
"""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .models import Paper, PaperAssignment, User

logger = logging.getLogger(__name__)


@dataclass
class PushResult:
    ok: bool
    status: str  # pending / sent / failed
    message: str
    payload: dict[str, Any] | None = None


async def push_assignment(assignment_id: int, db: AsyncSession) -> PushResult:
    """把试卷派发任务推送到企微（暂未对接，仅置 pending）。"""
    res = await db.execute(select(PaperAssignment).where(PaperAssignment.id == assignment_id))
    assignment = res.scalar_one_or_none()
    if not assignment:
        return PushResult(ok=False, status="failed", message="派发任务不存在")

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

    assignment.wecom_push_status = "pending"
    assignment.wecom_push_payload_json = json.dumps(payload, ensure_ascii=False)
    assignment.wecom_push_error = None
    assignment.wecom_pushed_at = datetime.now()

    logger.info("[wecom_push:STUB] 已加入推送队列（实际接入待开发）payload=%s", payload)

    return PushResult(
        ok=True,
        status="pending",
        message="已加入推送队列（企微接入待开发）。",
        payload=payload,
    )
