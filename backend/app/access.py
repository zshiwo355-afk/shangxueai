from __future__ import annotations

from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .models import User, UserWhitelist


def role_name(user_or_role: User | str | None) -> str:
    if isinstance(user_or_role, User):
        return (user_or_role.role or "user").strip().lower()
    return str(user_or_role or "user").strip().lower()


def is_super_admin(user_or_role: User | str | None) -> bool:
    return role_name(user_or_role) == "super_admin"


def is_admin(user_or_role: User | str | None) -> bool:
    return role_name(user_or_role) == "admin"


def is_admin_like(user_or_role: User | str | None) -> bool:
    return is_admin(user_or_role) or is_super_admin(user_or_role)


def ensure_super_admin(user: User) -> User:
    if not is_super_admin(user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="仅超级管理员可访问该接口。",
        )
    return user


async def get_whitelist_entry(
    db: AsyncSession,
    user_id: int,
    *,
    enabled_only: bool = False,
) -> UserWhitelist | None:
    stmt = select(UserWhitelist).where(UserWhitelist.user_id == user_id)
    if enabled_only:
        stmt = stmt.where(UserWhitelist.enabled.is_(True))
    result = await db.execute(stmt)
    return result.scalar_one_or_none()


async def get_user_whitelist_permissions(
    db: AsyncSession,
    user_id: int,
) -> dict[str, Any]:
    row = await get_whitelist_entry(db, user_id)
    if not row:
        return {
            "enabled": False,
            "auto_checkin_enabled": False,
            "course_exempt_enabled": False,
            "allow_video_seek": False,
            "auto_answer_correct": False,
            "remark": "",
            "entry_id": None,
        }
    enabled = bool(row.enabled)
    return {
        "enabled": enabled,
        "auto_checkin_enabled": enabled and bool(row.auto_checkin_enabled),
        "course_exempt_enabled": enabled and bool(row.course_exempt_enabled),
        "allow_video_seek": enabled and bool(row.allow_video_seek),
        "auto_answer_correct": enabled and bool(row.auto_answer_correct),
        "remark": row.remark or "",
        "entry_id": row.id,
    }


async def is_whitelist_enabled(db: AsyncSession, user_id: int) -> bool:
    row = await get_whitelist_entry(db, user_id, enabled_only=True)
    return row is not None
