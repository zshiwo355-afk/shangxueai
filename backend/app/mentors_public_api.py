"""公开导师列表接口 —— 仅返回已启用导师，不需要管理员权限。"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .auth import get_current_user
from .db import get_db
from .models import Mentor, User

router = APIRouter(prefix="/api/mentors", tags=["mentors"])


def _public_mentor_dict(row: Mentor) -> dict[str, Any]:
    return {
        "id": int(row.id),
        "display_name": row.display_name,
        "title": row.title or "",
        "avatar_url": row.avatar_url or "",
        "tagline": row.tagline or "",
        "bio": row.bio or "",
        "expertise_tags": row.expertise_tags or "",
        "years_experience": int(row.years_experience or 0),
        "featured": bool(row.featured),
        "sort_order": int(row.sort_order or 0),
    }


@router.get("")
async def list_enabled_mentors(
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
) -> list[dict[str, Any]]:
    result = await db.execute(
        select(Mentor)
        .where(Mentor.enabled == True)
        .order_by(Mentor.sort_order.asc(), Mentor.id.asc())
    )
    return [_public_mentor_dict(r) for r in result.scalars().all()]
