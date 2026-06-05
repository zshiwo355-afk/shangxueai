"""配置项 API：用户读启用项 + 管理员全 CRUD。"""
from __future__ import annotations

from fastapi import APIRouter, Body, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from .auth import get_current_user, require_admin
from .db import get_db
from .models import ConfigOption, User

VALID_CATEGORIES = ("training_type", "difficulty", "customer_type", "employment_status", "newbie_guide_trigger")


class OptionDTO(BaseModel):
    id: int
    category: str
    value: str
    sort_order: int
    enabled: bool


class OptionCreate(BaseModel):
    category: str = Field(..., max_length=32)
    value: str = Field(..., min_length=1, max_length=64)
    sort_order: int = 0
    enabled: bool = True

    @field_validator("category")
    @classmethod
    def _validate_category(cls, v: str) -> str:
        v = (v or "").strip()
        if v not in VALID_CATEGORIES:
            raise ValueError(f"category 必须是 {VALID_CATEGORIES} 之一")
        return v

    @field_validator("value")
    @classmethod
    def _strip(cls, v: str) -> str:
        v = (v or "").strip()
        if not v:
            raise ValueError("value 不能为空")
        return v


class OptionUpdate(BaseModel):
    value: str | None = Field(default=None, max_length=64)
    sort_order: int | None = None
    enabled: bool | None = None

    @field_validator("value")
    @classmethod
    def _strip(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = v.strip()
        if not v:
            raise ValueError("value 不能为空")
        return v


def _to_dto(item: ConfigOption) -> OptionDTO:
    return OptionDTO(
        id=item.id,
        category=item.category,
        value=item.value,
        sort_order=item.sort_order,
        enabled=bool(item.enabled),
    )


# ---------- 用户：读取启用选项 ----------

user_router = APIRouter(prefix="/api", tags=["options"])


@user_router.get("/options", response_model=dict[str, list[str]])
async def fetch_options(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, list[str]]:
    """返回每个 category 下启用的 value 列表（已按 sort_order 排序）。"""
    del user  # 仅鉴权，无需用 user_id
    result = await db.execute(
        select(ConfigOption)
        .where(ConfigOption.enabled.is_(True))
        .order_by(ConfigOption.category, ConfigOption.sort_order, ConfigOption.id)
    )
    rows = result.scalars().all()
    out: dict[str, list[str]] = {cat: [] for cat in VALID_CATEGORIES}
    for r in rows:
        if r.category in out:
            out[r.category].append(r.value)
    return out


# ---------- 管理员：全 CRUD ----------

admin_router = APIRouter(prefix="/api/admin/options", tags=["admin-options"])


@admin_router.get("", response_model=list[OptionDTO])
async def list_options(
    category: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> list[OptionDTO]:
    del admin
    stmt = select(ConfigOption).order_by(
        ConfigOption.category, ConfigOption.sort_order, ConfigOption.id
    )
    if category:
        if category not in VALID_CATEGORIES:
            raise HTTPException(status_code=400, detail=f"非法 category：{category}")
        stmt = stmt.where(ConfigOption.category == category)
    result = await db.execute(stmt)
    return [_to_dto(r) for r in result.scalars().all()]


@admin_router.post("", response_model=OptionDTO)
async def create_option(
    payload: OptionCreate,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> OptionDTO:
    del admin
    item = ConfigOption(
        category=payload.category,
        value=payload.value,
        sort_order=payload.sort_order,
        enabled=payload.enabled,
    )
    db.add(item)
    try:
        await db.flush()
    except IntegrityError as exc:
        raise HTTPException(status_code=409, detail="该 category 下已存在同名选项。") from exc
    await db.refresh(item)
    return _to_dto(item)


@admin_router.put("/{option_id}", response_model=OptionDTO)
async def update_option(
    option_id: int,
    payload: OptionUpdate,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> OptionDTO:
    del admin
    result = await db.execute(select(ConfigOption).where(ConfigOption.id == option_id))
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="选项不存在。")
    if payload.value is not None:
        item.value = payload.value
    if payload.sort_order is not None:
        item.sort_order = payload.sort_order
    if payload.enabled is not None:
        item.enabled = payload.enabled
    try:
        await db.flush()
    except IntegrityError as exc:
        raise HTTPException(status_code=409, detail="该 category 下已存在同名选项。") from exc
    await db.refresh(item)
    return _to_dto(item)


@admin_router.delete("/{option_id}")
async def delete_option(
    option_id: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict:
    del admin
    res = await db.execute(delete(ConfigOption).where(ConfigOption.id == option_id))
    if res.rowcount == 0:
        raise HTTPException(status_code=404, detail="选项不存在。")
    return {"success": True}
