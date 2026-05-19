"""Session 存储（V2：MySQL 持久化）。

V1 用 .sessions/*.json 落盘 + 内存 dict；V2 全部入库到 training_sessions 表。
对外提供 async 模块级函数，由 FastAPI 路由通过 Depends(get_db) 注入 db。

关键差异 vs V1：
  - 同步 → 异步：所有调用方 await
  - 内存 dict 删除：每次 get 都从 DB 读取（pool_pre_ping 已开，热路径单次查询性能足够）
  - 增加 mode/user_id/exam_attempt_id 字段，支持训练 + 考试双模式
  - 删除 session 用 hard delete（V2 不保留对话历史，复盘已落到 training_records / exam_attempts）
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .models import TrainingSessionRow
from .schemas import (
    ChatTurn,
    CompletedActions,
    EmotionState,
    SessionState,
)

logger = logging.getLogger(__name__)


def _row_to_state(row: TrainingSessionRow) -> SessionState:
    return SessionState.model_validate_json(row.state_json)


def _state_to_json(state: SessionState) -> str:
    return state.model_dump_json()


async def create_session(
    db: AsyncSession,
    *,
    user_id: int,
    mode: str,
    training_type: str,
    difficulty: str,
    customer_type: str,
    exam_attempt_id: int | None = None,
) -> SessionState:
    """新建 session 行；state_json 此时为初始 SessionState。"""
    session = SessionState(
        session_id=uuid.uuid4().hex,
        created_at=datetime.now(tz=timezone.utc),
        training_type=training_type,
        difficulty=difficulty,
        customer_type=customer_type,
    )
    row = TrainingSessionRow(
        id=session.session_id,
        user_id=user_id,
        mode=mode,
        exam_attempt_id=exam_attempt_id,
        state_json=_state_to_json(session),
    )
    db.add(row)
    await db.flush()
    return session


async def _load_row(db: AsyncSession, session_id: str) -> TrainingSessionRow:
    if not (session_id or "").strip():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="session 不存在或已过期。"
        )
    result = await db.execute(
        select(TrainingSessionRow).where(TrainingSessionRow.id == session_id)
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="session 不存在或已过期。"
        )
    return row


async def get_session(db: AsyncSession, session_id: str) -> SessionState:
    row = await _load_row(db, session_id)
    return _row_to_state(row)


async def get_session_owner(db: AsyncSession, session_id: str) -> tuple[int, str, int | None]:
    """返回 (user_id, mode, exam_attempt_id)，用于权限校验和模式分发。"""
    row = await _load_row(db, session_id)
    return row.user_id, row.mode, row.exam_attempt_id


async def assert_owner(db: AsyncSession, session_id: str, user_id: int) -> TrainingSessionRow:
    row = await _load_row(db, session_id)
    if row.user_id != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="无权访问该 session。"
        )
    return row


async def save_session(db: AsyncSession, session: SessionState) -> None:
    row = await _load_row(db, session.session_id)
    row.state_json = _state_to_json(session)
    await db.flush()


async def delete_session(db: AsyncSession, session_id: str) -> None:
    row = await db.execute(
        select(TrainingSessionRow).where(TrainingSessionRow.id == session_id)
    )
    obj = row.scalar_one_or_none()
    if obj:
        await db.delete(obj)
        await db.flush()


async def reset_session(db: AsyncSession, session_id: str) -> SessionState:
    """清空对话记录、轮次、评分轨迹，保留 visible_brief / hidden_training_pack。"""
    row = await _load_row(db, session_id)
    state = _row_to_state(row)
    state.round_count = 0
    state.current_stage = "opening"
    state.chat_history = []
    state.score_trace = []
    state.emotion_state = EmotionState()
    state.completed_actions = CompletedActions()
    state.is_finished = False
    if state.first_customer_message:
        state.chat_history.append(
            ChatTurn(round=0, role="customer", content=state.first_customer_message, stage="opening")
        )
    row.state_json = _state_to_json(state)
    await db.flush()
    return state
