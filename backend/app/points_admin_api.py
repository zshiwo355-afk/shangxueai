"""后台积分管理：规则 CRUD（不允许改 code）/ 流水查询 / 排行榜 / 手动调分。

前端只挂管理员侧；用户端口子先不开。
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .auth import require_admin
from .db import get_db
from .models import (
    PointRule,
    PointTransaction,
    User,
    UserPointSummary,
)
from .points_service import grant_points

logger = logging.getLogger("app.points_admin_api")

router = APIRouter(prefix="/api/admin/points", tags=["admin-points"])


# -------------------- 规则 --------------------

def _rule_to_dict(row: PointRule) -> dict[str, Any]:
    return {
        "id": int(row.id),
        "code": row.code,
        "name": row.name,
        "category": row.category or "",
        "points": int(row.points or 0),
        "daily_limit": int(row.daily_limit or 0),
        "enabled": bool(row.enabled),
        "description": row.description or "",
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


@router.get("/rules")
async def list_rules(
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> list[dict[str, Any]]:
    del admin
    result = await db.execute(
        select(PointRule).order_by(PointRule.category.asc(), PointRule.id.asc())
    )
    return [_rule_to_dict(row) for row in result.scalars().all()]


class RuleUpdatePayload(BaseModel):
    name: str | None = Field(default=None, max_length=128)
    points: int | None = None
    daily_limit: int | None = Field(default=None, ge=0)
    enabled: bool | None = None
    description: str | None = Field(default=None, max_length=500)


@router.put("/rules/{rule_id}")
async def update_rule(
    rule_id: int,
    payload: RuleUpdatePayload,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    del admin
    row = await db.get(PointRule, rule_id)
    if not row:
        raise HTTPException(status_code=404, detail="规则不存在。")
    if payload.name is not None:
        row.name = payload.name.strip()
    if payload.points is not None:
        row.points = int(payload.points)
    if payload.daily_limit is not None:
        row.daily_limit = int(payload.daily_limit)
    if payload.enabled is not None:
        row.enabled = bool(payload.enabled)
    if payload.description is not None:
        row.description = payload.description.strip()
    await db.flush()
    await db.refresh(row)
    return _rule_to_dict(row)


# -------------------- 流水 --------------------

def _tx_to_dict(row: PointTransaction, *, user_label: str = "") -> dict[str, Any]:
    return {
        "id": int(row.id),
        "user_id": int(row.user_id),
        "user_label": user_label,
        "rule_code": row.rule_code,
        "category": row.category or "",
        "points": int(row.points),
        "business_type": row.business_type or "",
        "business_id": int(row.business_id) if row.business_id else None,
        "remark": row.remark or "",
        "operator_id": int(row.operator_id) if row.operator_id else None,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


async def _attach_user_labels(
    db: AsyncSession, rows: list[PointTransaction],
) -> dict[int, str]:
    if not rows:
        return {}
    uids = sorted({int(r.user_id) for r in rows})
    if not uids:
        return {}
    result = await db.execute(select(User.id, User.display_name, User.real_name, User.username).where(User.id.in_(uids)))
    label_map: dict[int, str] = {}
    for uid, display_name, real_name, username in result.all():
        label_map[int(uid)] = (display_name or real_name or username or f"#{uid}")
    return label_map


@router.get("/transactions")
async def list_transactions(
    user_id: int | None = Query(default=None),
    rule_code: str | None = Query(default=None),
    category: str | None = Query(default=None),
    keyword: str | None = Query(default=None, description="模糊匹配 user.display_name / username"),
    days: int = Query(default=30, ge=1, le=365),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    del admin
    conds = [PointTransaction.created_at >= datetime.now() - timedelta(days=days)]
    if user_id:
        conds.append(PointTransaction.user_id == int(user_id))
    if rule_code:
        conds.append(PointTransaction.rule_code == rule_code.strip())
    if category:
        conds.append(PointTransaction.category == category.strip())
    if keyword:
        kw = f"%{keyword.strip()}%"
        sub = select(User.id).where(
            (User.display_name.like(kw))
            | (User.username.like(kw))
            | (User.real_name.like(kw))
        )
        conds.append(PointTransaction.user_id.in_(sub))

    base = select(PointTransaction).where(and_(*conds)).order_by(PointTransaction.id.desc())
    total_result = await db.execute(
        select(func.count()).select_from(base.subquery())
    )
    total = int(total_result.scalar() or 0)

    paged = await db.execute(base.offset((page - 1) * page_size).limit(page_size))
    rows = list(paged.scalars().all())
    label_map = await _attach_user_labels(db, rows)

    return {
        "items": [_tx_to_dict(r, user_label=label_map.get(int(r.user_id), "")) for r in rows],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


# -------------------- 手动调分 --------------------

class ManualAdjustPayload(BaseModel):
    user_id: int = Field(..., gt=0)
    points: int = Field(..., description="可正可负，0 拒绝")
    remark: str = Field(..., min_length=1, max_length=500)


@router.post("/manual-adjust")
async def manual_adjust(
    payload: ManualAdjustPayload,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    if payload.points == 0:
        raise HTTPException(status_code=400, detail="积分不能为 0。")
    target = await db.get(User, payload.user_id)
    if not target:
        raise HTTPException(status_code=404, detail="用户不存在。")
    # 手动调分用 ts+admin_id 保证不会与之前调分冲突
    extra = f"op{int(admin.id)}-ts{int(datetime.now().timestamp() * 1000)}"
    res = await grant_points(
        db,
        user_id=int(payload.user_id),
        rule_code="manual_adjust",
        business_type="manual",
        business_id=None,
        dedupe_extra=extra,
        remark=payload.remark.strip(),
        points_override=int(payload.points),
        operator_id=int(admin.id),
    )
    if not res.get("granted"):
        raise HTTPException(status_code=500, detail=f"调分失败：{res.get('reason')}")
    return res


# -------------------- 排行榜 --------------------

def _category_field(category: str) -> Any:
    return {
        "training": UserPointSummary.training_points,
        "course": UserPointSummary.course_points,
        "reading": UserPointSummary.reading_points,
        "paper": UserPointSummary.paper_points,
        "exam": UserPointSummary.exam_points,
    }.get(category, UserPointSummary.total_points)


@router.get("/leaderboard")
async def leaderboard(
    scope: str = Query(default="all", pattern="^(all|department)$"),
    department: str | None = Query(default=None),
    category: str = Query(default="all", pattern="^(all|training|course|reading|paper|exam)$"),
    limit: int = Query(default=50, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> list[dict[str, Any]]:
    del admin
    field = _category_field(category) if category != "all" else UserPointSummary.total_points

    stmt = (
        select(
            UserPointSummary.user_id,
            UserPointSummary.total_points,
            UserPointSummary.training_points,
            UserPointSummary.course_points,
            UserPointSummary.reading_points,
            UserPointSummary.paper_points,
            UserPointSummary.exam_points,
            UserPointSummary.streak_days,
            User.display_name,
            User.real_name,
            User.username,
            User.department,
        )
        .join(User, User.id == UserPointSummary.user_id)
        .where(User.disabled.is_(False))
    )
    if scope == "department":
        if not department:
            raise HTTPException(status_code=400, detail="按部门排行需指定 department。")
        stmt = stmt.where(User.department == department)
    stmt = stmt.order_by(field.desc(), UserPointSummary.user_id.asc()).limit(limit)

    result = await db.execute(stmt)
    items = []
    for idx, row in enumerate(result.all(), start=1):
        items.append({
            "rank": idx,
            "user_id": int(row.user_id),
            "name": row.display_name or row.real_name or row.username or f"#{row.user_id}",
            "department": row.department or "",
            "total_points": int(row.total_points or 0),
            "training_points": int(row.training_points or 0),
            "course_points": int(row.course_points or 0),
            "reading_points": int(row.reading_points or 0),
            "paper_points": int(row.paper_points or 0),
            "exam_points": int(row.exam_points or 0),
            "streak_days": int(row.streak_days or 0),
        })
    return items


@router.get("/departments")
async def list_departments(
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> list[str]:
    """返回当前所有非空部门名，前端排行榜按部门切换用。"""
    del admin
    result = await db.execute(
        select(User.department)
        .where(User.disabled.is_(False), User.department.isnot(None), User.department != "")
        .distinct()
        .order_by(User.department.asc())
    )
    return [row[0] for row in result.all() if row[0]]


# -------------------- 用户当前积分摘要（用于流水弹窗显示卡片） --------------------

@router.get("/users/{user_id}/summary")
async def user_summary(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    del admin
    target = await db.get(User, user_id)
    if not target:
        raise HTTPException(status_code=404, detail="用户不存在。")
    summary = await db.get(UserPointSummary, user_id)
    if not summary:
        return {
            "user_id": int(user_id),
            "name": target.display_name or target.real_name or target.username,
            "department": target.department or "",
            "total_points": 0,
            "training_points": 0,
            "course_points": 0,
            "reading_points": 0,
            "paper_points": 0,
            "exam_points": 0,
            "manual_points": 0,
            "streak_days": 0,
            "max_streak_days": 0,
            "last_checkin_date": None,
            "last_event_at": None,
        }
    return {
        "user_id": int(user_id),
        "name": target.display_name or target.real_name or target.username,
        "department": target.department or "",
        "total_points": int(summary.total_points or 0),
        "training_points": int(summary.training_points or 0),
        "course_points": int(summary.course_points or 0),
        "reading_points": int(summary.reading_points or 0),
        "paper_points": int(summary.paper_points or 0),
        "exam_points": int(summary.exam_points or 0),
        "manual_points": int(summary.manual_points or 0),
        "streak_days": int(summary.streak_days or 0),
        "max_streak_days": int(summary.max_streak_days or 0),
        "last_checkin_date": summary.last_checkin_date.isoformat() if summary.last_checkin_date else None,
        "last_event_at": summary.last_event_at.isoformat() if summary.last_event_at else None,
    }
