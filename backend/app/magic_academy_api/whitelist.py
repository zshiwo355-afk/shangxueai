from __future__ import annotations

from typing import Any

from fastapi import Depends, HTTPException
from sqlalchemy import desc, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import require_super_admin
from ..db import get_db
from ..magic_academy_schemas import VideoWhitelistCreatePayload
from ..models import MagicVideo, MagicVideoWhitelist, User
from . import router
from ._utils import _iso, _user_name
from ._video_helpers import _get_video_or_404


@router.get("/video-whitelist")
async def list_video_whitelist(
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_super_admin),
) -> list[dict[str, Any]]:
    del admin
    result = await db.execute(
        select(MagicVideoWhitelist, MagicVideo, User)
        .join(MagicVideo, MagicVideo.id == MagicVideoWhitelist.video_id)
        .join(User, User.id == MagicVideoWhitelist.user_id)
        .order_by(desc(MagicVideoWhitelist.created_at))
    )
    return [
        {
            "id": whitelist.id,
            "video_id": whitelist.video_id,
            "video_title": video.title,
            "user_id": target.id,
            "user_name": _user_name(target),
            "department": target.department or "",
            "note": whitelist.note or "",
            "created_at": _iso(whitelist.created_at),
        }
        for whitelist, video, target in result.all()
    ]


@router.post("/video-whitelist")
async def create_video_whitelist(
    payload: VideoWhitelistCreatePayload,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_super_admin),
) -> dict[str, Any]:
    await _get_video_or_404(db, payload.video_id)
    target = await db.get(User, payload.user_id)
    if not target:
        raise HTTPException(status_code=404, detail="用户不存在。")
    row = MagicVideoWhitelist(
        video_id=payload.video_id,
        user_id=payload.user_id,
        note=payload.note.strip(),
        created_by=admin.id,
    )
    db.add(row)
    try:
        await db.flush()
    except IntegrityError as exc:
        raise HTTPException(status_code=409, detail="该用户已在白名单中。") from exc
    video = await _get_video_or_404(db, payload.video_id)
    return {
        "id": row.id,
        "video_id": row.video_id,
        "video_title": video.title,
        "user_id": target.id,
        "user_name": _user_name(target),
        "department": target.department or "",
        "note": row.note or "",
        "created_at": _iso(row.created_at),
    }


@router.delete("/video-whitelist/{whitelist_id}")
async def delete_video_whitelist(
    whitelist_id: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_super_admin),
) -> dict[str, bool]:
    del admin
    row = await db.get(MagicVideoWhitelist, whitelist_id)
    if not row:
        raise HTTPException(status_code=404, detail="白名单记录不存在。")
    await db.delete(row)
    await db.flush()
    return {"success": True}
