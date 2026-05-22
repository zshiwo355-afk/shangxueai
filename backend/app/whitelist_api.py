from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from .auth import require_super_admin
from .db import get_db
from .models import User, UserWhitelist

router = APIRouter(prefix="/api/whitelist", tags=["whitelist"])


class WhitelistPayload(BaseModel):
    user_id: int = Field(..., ge=1)
    enabled: bool = True
    auto_checkin_enabled: bool = False
    course_exempt_enabled: bool = False
    allow_video_seek: bool = False
    auto_answer_correct: bool = False
    remark: str = Field(default="", max_length=255)

    @field_validator("remark", mode="before")
    @classmethod
    def _strip_remark(cls, value: str) -> str:
        return (value or "").strip()


def _user_name(user: User) -> str:
    return (user.real_name or user.display_name or user.username or "").strip()


def _to_dict(row: UserWhitelist, user: User) -> dict:
    return {
        "id": row.id,
        "user_id": row.user_id,
        "username": user.username,
        "user_name": _user_name(user),
        "department": user.department or "",
        "position": user.position or "",
        "enabled": bool(row.enabled),
        "auto_checkin_enabled": bool(row.auto_checkin_enabled),
        "course_exempt_enabled": bool(row.course_exempt_enabled),
        "allow_video_seek": bool(row.allow_video_seek),
        "auto_answer_correct": bool(row.auto_answer_correct),
        "remark": row.remark or "",
        "created_by": row.created_by,
        "created_at": row.created_at.isoformat() if row.created_at else "",
        "updated_at": row.updated_at.isoformat() if row.updated_at else "",
    }


async def _get_target_user(db: AsyncSession, user_id: int) -> User:
    user = await db.get(User, user_id)
    if not user or user.disabled:
        raise HTTPException(status_code=404, detail="用户不存在。")
    if (user.role or "").lower() != "user":
        raise HTTPException(status_code=400, detail="白名单仅支持普通员工账号。")
    return user


@router.get("")
async def list_whitelist(
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(require_super_admin),
) -> list[dict]:
    del actor
    result = await db.execute(
        select(UserWhitelist, User)
        .join(User, User.id == UserWhitelist.user_id)
        .order_by(UserWhitelist.updated_at.desc(), UserWhitelist.id.desc())
    )
    return [_to_dict(row, user) for row, user in result.all()]


@router.post("")
async def create_whitelist(
    payload: WhitelistPayload,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(require_super_admin),
) -> dict:
    user = await _get_target_user(db, payload.user_id)
    row = UserWhitelist(
        user_id=payload.user_id,
        enabled=payload.enabled,
        auto_checkin_enabled=payload.auto_checkin_enabled,
        course_exempt_enabled=payload.course_exempt_enabled,
        allow_video_seek=payload.allow_video_seek,
        auto_answer_correct=payload.auto_answer_correct,
        remark=payload.remark,
        created_by=actor.id,
    )
    db.add(row)
    try:
        await db.flush()
    except IntegrityError as exc:
        raise HTTPException(status_code=409, detail="该用户已在白名单中。") from exc
    await db.refresh(row)
    return _to_dict(row, user)


@router.put("/{whitelist_id}")
async def update_whitelist(
    whitelist_id: int,
    payload: WhitelistPayload,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(require_super_admin),
) -> dict:
    del actor
    row = await db.get(UserWhitelist, whitelist_id)
    if not row:
        raise HTTPException(status_code=404, detail="白名单记录不存在。")
    if row.user_id != payload.user_id:
        existing = await db.execute(select(UserWhitelist.id).where(UserWhitelist.user_id == payload.user_id))
        existed_id = existing.scalar_one_or_none()
        if existed_id and existed_id != whitelist_id:
            raise HTTPException(status_code=409, detail="该用户已在白名单中。")
        row.user_id = payload.user_id
    user = await _get_target_user(db, row.user_id)
    row.enabled = payload.enabled
    row.auto_checkin_enabled = payload.auto_checkin_enabled
    row.course_exempt_enabled = payload.course_exempt_enabled
    row.allow_video_seek = payload.allow_video_seek
    row.auto_answer_correct = payload.auto_answer_correct
    row.remark = payload.remark
    await db.flush()
    await db.refresh(row)
    return _to_dict(row, user)


@router.delete("/{whitelist_id}")
async def delete_whitelist(
    whitelist_id: int,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(require_super_admin),
) -> dict:
    del actor
    row = await db.get(UserWhitelist, whitelist_id)
    if not row:
        raise HTTPException(status_code=404, detail="白名单记录不存在。")
    await db.delete(row)
    await db.flush()
    return {"success": True}
