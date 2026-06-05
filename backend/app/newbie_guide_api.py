"""新手地图 API：状态查询 + 标记完成。"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from .auth import get_current_user
from .db import get_db
from .models import ConfigOption, User

router = APIRouter(prefix="/api/newbie-guide", tags=["newbie-guide"])


@router.get("/status")
async def guide_status(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    if user.guide_completed_at is not None:
        return {"should_show": False}

    result = await db.execute(
        select(ConfigOption.value).where(
            ConfigOption.category == "newbie_guide_trigger",
            ConfigOption.enabled.is_(True),
        )
    )
    trigger_values = {r[0] for r in result.all()}

    should_show = (user.employment_status or "") in trigger_values
    return {"should_show": should_show}


@router.post("/complete")
async def guide_complete(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    if user.guide_completed_at is None:
        user.guide_completed_at = func.now()
        await db.flush()
    return {"success": True}
