"""训练复盘记录 API（用户视角）。

只存训练完成后的复盘 + 分数；管理员若要看，可以扩展 admin 接口（V3）。
"""
from __future__ import annotations

import json
import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import desc, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from .auth import get_current_user, require_admin
from .db import get_db
from .models import TrainingRecord, User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/training/records", tags=["training-records"])
admin_router = APIRouter(prefix="/api/admin/training-records", tags=["admin-training-records"])


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


# ---------------- Admin ----------------


class AdminTrainingRecordSummary(BaseModel):
    id: int
    user_id: int
    user_username: str = ""
    user_display_name: str = ""
    department: str = ""
    training_type: str
    difficulty: str
    customer_type: str
    score: float | None = None
    is_pass: bool | None = None
    result: str | None = None
    created_at: str = ""


class AdminTrainingRecordsPage(BaseModel):
    items: list[AdminTrainingRecordSummary]
    total: int
    page: int
    page_size: int


def _parse_date(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError:
        return None


@admin_router.get("", response_model=AdminTrainingRecordsPage)
async def admin_list_training_records(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    user_id: int | None = Query(None),
    training_type: str | None = Query(None),
    difficulty: str | None = Query(None),
    customer_type: str | None = Query(None),
    result: str | None = Query(None, description="成交 / 意向客户 / 未成交"),
    is_pass: bool | None = Query(None),
    date_from: str | None = Query(None, description="ISO 起始时间"),
    date_to: str | None = Query(None, description="ISO 结束时间"),
    keyword: str | None = Query(None, description="按用户名 / 真实姓名模糊搜索"),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> AdminTrainingRecordsPage:
    """管理员视角的训练记录列表。支持按用户 / 训练类型 / 难度 / 客户类型 /
    结果 / 是否合格 / 时间范围 / 用户关键词 筛选。"""
    del admin

    stmt = select(TrainingRecord, User).join(User, User.id == TrainingRecord.user_id)
    count_stmt = select(func.count()).select_from(TrainingRecord).join(User, User.id == TrainingRecord.user_id)

    def _apply(s):
        if user_id:
            s = s.where(TrainingRecord.user_id == int(user_id))
        if training_type:
            s = s.where(TrainingRecord.training_type == training_type.strip())
        if difficulty:
            s = s.where(TrainingRecord.difficulty == difficulty.strip())
        if customer_type:
            s = s.where(TrainingRecord.customer_type == customer_type.strip())
        if result:
            s = s.where(TrainingRecord.result == result.strip())
        if is_pass is not None:
            s = s.where(TrainingRecord.is_pass.is_(bool(is_pass)))
        df = _parse_date(date_from)
        if df:
            s = s.where(TrainingRecord.created_at >= df)
        dt = _parse_date(date_to)
        if dt:
            s = s.where(TrainingRecord.created_at <= dt)
        if keyword:
            kw = f"%{keyword.strip()}%"
            s = s.where(or_(User.username.like(kw), User.real_name.like(kw), User.display_name.like(kw)))
        return s

    stmt = _apply(stmt).order_by(desc(TrainingRecord.created_at)).limit(page_size).offset((page - 1) * page_size)
    count_stmt = _apply(count_stmt)

    total = int((await db.execute(count_stmt)).scalar_one() or 0)
    rows = (await db.execute(stmt)).all()
    items = [
        AdminTrainingRecordSummary(
            id=rec.id,
            user_id=rec.user_id,
            user_username=user.username or "",
            user_display_name=(user.real_name or user.display_name or user.username) if user else "",
            department=user.department or "",
            training_type=rec.training_type,
            difficulty=rec.difficulty,
            customer_type=rec.customer_type,
            score=rec.score,
            is_pass=bool(rec.is_pass) if rec.is_pass is not None else None,
            result=rec.result,
            created_at=rec.created_at.isoformat() if rec.created_at else "",
        )
        for rec, user in rows
    ]
    return AdminTrainingRecordsPage(items=items, total=total, page=page, page_size=page_size)


@admin_router.get("/{record_id}", response_model=TrainingRecordDetail)
async def admin_get_training_record(
    record_id: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> TrainingRecordDetail:
    """管理员只读获取单条训练记录详情（含 chat_history + review）。"""
    del admin
    rec = await db.get(TrainingRecord, record_id)
    if not rec:
        raise HTTPException(status_code=404, detail="记录不存在。")
    return _to_detail(rec)
