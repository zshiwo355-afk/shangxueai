"""训练复盘记录 API（用户视角）。

只存训练完成后的复盘 + 分数；管理员若要看，可以扩展 admin 接口（V3）。
"""
from __future__ import annotations

import json
import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from .auth import get_current_user
from .db import get_db
from .models import TrainingRecord, User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/training/records", tags=["training-records"])


class TrainingRecordSummary(BaseModel):
    id: int
    training_type: str
    difficulty: str
    customer_type: str
    score: float | None = None
    is_pass: bool | None = None
    result: str | None = None
    created_at: str = ""


class TrainingRecordDetail(BaseModel):
    id: int
    training_type: str
    difficulty: str
    customer_type: str
    score: float | None = None
    is_pass: bool | None = None
    result: str | None = None
    review: dict | None = None
    chat_history: list[dict] = []
    created_at: str = ""


def _to_summary(rec: TrainingRecord) -> TrainingRecordSummary:
    return TrainingRecordSummary(
        id=rec.id,
        training_type=rec.training_type,
        difficulty=rec.difficulty,
        customer_type=rec.customer_type,
        score=rec.score,
        is_pass=bool(rec.is_pass) if rec.is_pass is not None else None,
        result=rec.result,
        created_at=rec.created_at.isoformat() if rec.created_at else "",
    )


def _to_detail(rec: TrainingRecord) -> TrainingRecordDetail:
    review = None
    if rec.review_json:
        try:
            review = json.loads(rec.review_json)
        except (TypeError, ValueError):
            review = None
    chat_history: list[dict] = []
    if rec.chat_history_json:
        try:
            parsed = json.loads(rec.chat_history_json)
            if isinstance(parsed, list):
                chat_history = [item for item in parsed if isinstance(item, dict)]
        except (TypeError, ValueError):
            chat_history = []
    return TrainingRecordDetail(
        id=rec.id,
        training_type=rec.training_type,
        difficulty=rec.difficulty,
        customer_type=rec.customer_type,
        score=rec.score,
        is_pass=bool(rec.is_pass) if rec.is_pass is not None else None,
        result=rec.result,
        review=review,
        chat_history=chat_history,
        created_at=rec.created_at.isoformat() if rec.created_at else "",
    )


@router.get("", response_model=list[TrainingRecordSummary])
async def list_my_records(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[TrainingRecordSummary]:
    result = await db.execute(
        select(TrainingRecord)
        .where(TrainingRecord.user_id == user.id)
        .order_by(desc(TrainingRecord.created_at))
        .limit(200)
    )
    return [_to_summary(r) for r in result.scalars().all()]


@router.get("/{record_id}", response_model=TrainingRecordDetail)
async def get_record(
    record_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> TrainingRecordDetail:
    rec = await db.get(TrainingRecord, record_id)
    if not rec or rec.user_id != user.id:
        raise HTTPException(status_code=404, detail="记录不存在或无权访问。")
    return _to_detail(rec)


@router.delete("/{record_id}")
async def delete_record(
    record_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    rec = await db.get(TrainingRecord, record_id)
    if not rec or rec.user_id != user.id:
        raise HTTPException(status_code=404, detail="记录不存在或无权访问。")
    await db.delete(rec)
    await db.flush()
    return {"success": True}
