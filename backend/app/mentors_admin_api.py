"""导师管理后台 API：导师档案 CRUD + 头像上传 / 素材库导入 + 推荐内容 CRUD。

只暴露管理员侧；用户端口子另行规划。
"""
from __future__ import annotations

import asyncio
import logging
import mimetypes
from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import delete as sql_delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from .auth import require_admin
from .db import get_db
from .magic_academy_api._oss import (
    _build_object_key_and_name,
    _build_oss_object_url,
    _ensure_oss_settings,
    _upload_binary_to_oss,
    _validate_reading_image_payload,
)
from .magic_academy_api._resource_cleanup import schedule_oss_object_cleanup
from .models import MaterialAsset, Mentor, MentorRecommendation, User

logger = logging.getLogger("app.mentors_admin_api")

router = APIRouter(prefix="/api/admin/mentors", tags=["admin-mentors"])


VALID_TARGET_TYPES = {"video", "reading", "paper", "link"}


# -------------------- 序列化 --------------------

def _mentor_to_dict(row: Mentor, *, user: User | None = None) -> dict[str, Any]:
    return {
        "id": int(row.id),
        "user_id": int(row.user_id),
        "user_label": (
            (user.display_name or user.real_name or user.username)
            if user else ""
        ),
        "user_department": (user.department if user else "") or "",
        "display_name": row.display_name,
        "title": row.title or "",
        "avatar_url": row.avatar_url or "",
        "avatar_object_key": row.avatar_object_key or "",
        "avatar_material_id": int(row.avatar_material_id) if row.avatar_material_id else None,
        "tagline": row.tagline or "",
        "bio": row.bio or "",
        "expertise_tags": row.expertise_tags or "",
        "years_experience": int(row.years_experience or 0),
        "contact_wecom": row.contact_wecom or "",
        "sort_order": int(row.sort_order or 0),
        "enabled": bool(row.enabled),
        "featured": bool(row.featured),
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


def _rec_to_dict(row: MentorRecommendation) -> dict[str, Any]:
    return {
        "id": int(row.id),
        "mentor_id": int(row.mentor_id),
        "target_type": row.target_type,
        "target_id": int(row.target_id) if row.target_id else None,
        "link_url": row.link_url or "",
        "title": row.title or "",
        "note": row.note or "",
        "sort_order": int(row.sort_order or 0),
        "enabled": bool(row.enabled),
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


# -------------------- 档案 CRUD --------------------

@router.get("")
async def list_mentors(
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> list[dict[str, Any]]:
    del admin
    result = await db.execute(
        select(Mentor).order_by(Mentor.sort_order.asc(), Mentor.id.asc())
    )
    rows = list(result.scalars().all())
    if not rows:
        return []
    user_ids = sorted({int(r.user_id) for r in rows})
    user_result = await db.execute(select(User).where(User.id.in_(user_ids)))
    user_map = {int(u.id): u for u in user_result.scalars().all()}
    return [_mentor_to_dict(r, user=user_map.get(int(r.user_id))) for r in rows]


@router.get("/{mentor_id}")
async def get_mentor(
    mentor_id: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    del admin
    row = await db.get(Mentor, mentor_id)
    if not row:
        raise HTTPException(status_code=404, detail="导师不存在。")
    user = await db.get(User, row.user_id)
    payload = _mentor_to_dict(row, user=user)
    rec_result = await db.execute(
        select(MentorRecommendation)
        .where(MentorRecommendation.mentor_id == mentor_id)
        .order_by(MentorRecommendation.sort_order.asc(), MentorRecommendation.id.asc())
    )
    payload["recommendations"] = [_rec_to_dict(r) for r in rec_result.scalars().all()]
    return payload


class MentorCreatePayload(BaseModel):
    user_id: int = Field(..., gt=0)
    display_name: str = Field(..., min_length=1, max_length=128)
    title: str = Field(default="", max_length=128)
    avatar_url: str = Field(default="", max_length=2048)
    avatar_object_key: str = Field(default="", max_length=1024)
    avatar_material_id: int | None = None
    tagline: str = Field(default="", max_length=255)
    bio: str = Field(default="")
    expertise_tags: str = Field(default="", max_length=500)
    years_experience: int = Field(default=0, ge=0, le=80)
    contact_wecom: str = Field(default="", max_length=128)
    sort_order: int = 0
    enabled: bool = True
    featured: bool = False


class MentorUpdatePayload(BaseModel):
    display_name: str | None = Field(default=None, max_length=128)
    title: str | None = Field(default=None, max_length=128)
    avatar_url: str | None = Field(default=None, max_length=2048)
    avatar_object_key: str | None = Field(default=None, max_length=1024)
    avatar_material_id: int | None = None
    tagline: str | None = Field(default=None, max_length=255)
    bio: str | None = None
    expertise_tags: str | None = Field(default=None, max_length=500)
    years_experience: int | None = Field(default=None, ge=0, le=80)
    contact_wecom: str | None = Field(default=None, max_length=128)
    sort_order: int | None = None
    enabled: bool | None = None
    featured: bool | None = None


@router.post("")
async def create_mentor(
    payload: MentorCreatePayload,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    target = await db.get(User, payload.user_id)
    if not target or target.disabled:
        raise HTTPException(status_code=404, detail="用户不存在或已停用。")
    row = Mentor(
        user_id=int(payload.user_id),
        display_name=payload.display_name.strip(),
        title=(payload.title or "").strip(),
        avatar_url=(payload.avatar_url or "").strip(),
        avatar_object_key=(payload.avatar_object_key or "").strip(),
        avatar_material_id=payload.avatar_material_id,
        tagline=(payload.tagline or "").strip(),
        bio=(payload.bio or "").strip() or None,
        expertise_tags=(payload.expertise_tags or "").strip(),
        years_experience=int(payload.years_experience or 0),
        contact_wecom=(payload.contact_wecom or "").strip(),
        sort_order=int(payload.sort_order or 0),
        enabled=bool(payload.enabled),
        featured=bool(payload.featured),
        created_by=admin.id,
    )
    db.add(row)
    try:
        await db.flush()
    except IntegrityError:
        raise HTTPException(status_code=400, detail="该用户已是导师，不可重复添加。")
    await db.refresh(row)
    return _mentor_to_dict(row, user=target)


@router.put("/{mentor_id}")
async def update_mentor(
    mentor_id: int,
    payload: MentorUpdatePayload,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    del admin
    row = await db.get(Mentor, mentor_id)
    if not row:
        raise HTTPException(status_code=404, detail="导师不存在。")

    old_object_key = row.avatar_object_key or ""
    old_came_from_material = bool(row.avatar_material_id)

    if payload.display_name is not None:
        row.display_name = payload.display_name.strip()
    if payload.title is not None:
        row.title = payload.title.strip()
    if payload.avatar_url is not None:
        row.avatar_url = payload.avatar_url.strip()
    if payload.avatar_object_key is not None:
        row.avatar_object_key = payload.avatar_object_key.strip()
    if payload.avatar_material_id is not None:
        row.avatar_material_id = payload.avatar_material_id or None
    if payload.tagline is not None:
        row.tagline = payload.tagline.strip()
    if payload.bio is not None:
        row.bio = (payload.bio or "").strip() or None
    if payload.expertise_tags is not None:
        row.expertise_tags = payload.expertise_tags.strip()
    if payload.years_experience is not None:
        row.years_experience = int(payload.years_experience)
    if payload.contact_wecom is not None:
        row.contact_wecom = payload.contact_wecom.strip()
    if payload.sort_order is not None:
        row.sort_order = int(payload.sort_order)
    if payload.enabled is not None:
        row.enabled = bool(payload.enabled)
    if payload.featured is not None:
        row.featured = bool(payload.featured)

    await db.flush()
    await db.refresh(row)

    new_object_key = row.avatar_object_key or ""
    if (
        old_object_key
        and old_object_key != new_object_key
        and not old_came_from_material
    ):
        schedule_oss_object_cleanup([old_object_key], logger=logger)

    user = await db.get(User, row.user_id)
    return _mentor_to_dict(row, user=user)


@router.delete("/{mentor_id}")
async def delete_mentor(
    mentor_id: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, bool]:
    del admin
    row = await db.get(Mentor, mentor_id)
    if not row:
        raise HTTPException(status_code=404, detail="导师不存在。")
    object_key = row.avatar_object_key or ""
    came_from_material = bool(row.avatar_material_id)
    # 级联删除推荐内容
    await db.execute(sql_delete(MentorRecommendation).where(MentorRecommendation.mentor_id == mentor_id))
    await db.execute(sql_delete(Mentor).where(Mentor.id == mentor_id))
    await db.flush()
    if object_key and not came_from_material:
        schedule_oss_object_cleanup([object_key], logger=logger)
    return {"success": True}


# -------------------- 头像上传 / 从素材库导入 --------------------

@router.post("/{mentor_id}/avatar/upload")
async def upload_mentor_avatar(
    mentor_id: int,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    del admin
    row = await db.get(Mentor, mentor_id) if mentor_id > 0 else None
    file_name = (file.filename or "avatar").strip() or "avatar"
    raw = await file.read()
    extension = _validate_reading_image_payload(file_name, len(raw), file.content_type or "")
    object_key, _stored = _build_object_key_and_name(file_name, extension)
    mime_type = (file.content_type or "").strip() or mimetypes.guess_type(file_name)[0] or "image/jpeg"
    await asyncio.to_thread(_upload_binary_to_oss, object_key, raw, mime_type)
    oss_settings = _ensure_oss_settings()
    url = _build_oss_object_url(oss_settings["public_base_url"], object_key)
    if row:
        # 替换头像：清理旧的 OSS 对象（仅当旧的是自己上传的）
        if row.avatar_object_key and not row.avatar_material_id and row.avatar_object_key != object_key:
            schedule_oss_object_cleanup([row.avatar_object_key], logger=logger)
        row.avatar_url = url
        row.avatar_object_key = object_key
        row.avatar_material_id = None
        await db.flush()
    return {
        "object_key": object_key,
        "url": url,
        "mime_type": mime_type,
        "file_name": file_name,
        "file_size": len(raw),
    }


class MentorAvatarFromMaterialPayload(BaseModel):
    material_asset_id: int = Field(..., gt=0)


@router.post("/{mentor_id}/avatar/import-from-material")
async def import_mentor_avatar_from_material(
    mentor_id: int,
    payload: MentorAvatarFromMaterialPayload,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    del admin
    asset = await db.get(MaterialAsset, payload.material_asset_id)
    if not asset or asset.is_deleted:
        raise HTTPException(status_code=404, detail="素材不存在或已删除。")
    if (asset.asset_type or "").lower() != "image":
        raise HTTPException(status_code=400, detail="仅支持选择图片类型素材。")
    oss_settings = _ensure_oss_settings()
    url = _build_oss_object_url(oss_settings["public_base_url"], asset.object_key)

    row = await db.get(Mentor, mentor_id) if mentor_id > 0 else None
    if row:
        if row.avatar_object_key and not row.avatar_material_id and row.avatar_object_key != asset.object_key:
            schedule_oss_object_cleanup([row.avatar_object_key], logger=logger)
        row.avatar_url = url
        row.avatar_object_key = asset.object_key
        row.avatar_material_id = int(asset.id)
        await db.flush()

    return {
        "object_key": asset.object_key,
        "url": url,
        "mime_type": asset.mime_type or "image/jpeg",
        "material_asset_id": int(asset.id),
        "file_name": asset.file_name or asset.name,
    }


# -------------------- 推荐内容 CRUD --------------------

class RecommendationPayload(BaseModel):
    target_type: str = Field(..., min_length=1)
    target_id: int | None = None
    link_url: str = Field(default="", max_length=2048)
    title: str = Field(default="", max_length=255)
    note: str = Field(default="", max_length=500)
    sort_order: int = 0
    enabled: bool = True


def _validate_recommendation_payload(payload: RecommendationPayload) -> None:
    target_type = (payload.target_type or "").lower().strip()
    if target_type not in VALID_TARGET_TYPES:
        raise HTTPException(status_code=400, detail=f"target_type 必须是 {sorted(VALID_TARGET_TYPES)} 之一。")
    if target_type == "link":
        if not (payload.link_url or "").strip():
            raise HTTPException(status_code=400, detail="link 类型必须提供 link_url。")
    else:
        if payload.target_id is None or payload.target_id <= 0:
            raise HTTPException(status_code=400, detail=f"{target_type} 类型必须提供 target_id。")


@router.get("/{mentor_id}/recommendations")
async def list_recommendations(
    mentor_id: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> list[dict[str, Any]]:
    del admin
    if not await db.get(Mentor, mentor_id):
        raise HTTPException(status_code=404, detail="导师不存在。")
    result = await db.execute(
        select(MentorRecommendation)
        .where(MentorRecommendation.mentor_id == mentor_id)
        .order_by(MentorRecommendation.sort_order.asc(), MentorRecommendation.id.asc())
    )
    return [_rec_to_dict(r) for r in result.scalars().all()]


@router.post("/{mentor_id}/recommendations")
async def create_recommendation(
    mentor_id: int,
    payload: RecommendationPayload,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    del admin
    if not await db.get(Mentor, mentor_id):
        raise HTTPException(status_code=404, detail="导师不存在。")
    _validate_recommendation_payload(payload)
    row = MentorRecommendation(
        mentor_id=int(mentor_id),
        target_type=payload.target_type.lower().strip(),
        target_id=int(payload.target_id) if payload.target_id else None,
        link_url=(payload.link_url or "").strip(),
        title=(payload.title or "").strip(),
        note=(payload.note or "").strip(),
        sort_order=int(payload.sort_order or 0),
        enabled=bool(payload.enabled),
    )
    db.add(row)
    await db.flush()
    await db.refresh(row)
    return _rec_to_dict(row)


@router.put("/{mentor_id}/recommendations/{rec_id}")
async def update_recommendation(
    mentor_id: int,
    rec_id: int,
    payload: RecommendationPayload,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    del admin
    row = await db.get(MentorRecommendation, rec_id)
    if not row or row.mentor_id != mentor_id:
        raise HTTPException(status_code=404, detail="推荐项不存在。")
    _validate_recommendation_payload(payload)
    row.target_type = payload.target_type.lower().strip()
    row.target_id = int(payload.target_id) if payload.target_id else None
    row.link_url = (payload.link_url or "").strip()
    row.title = (payload.title or "").strip()
    row.note = (payload.note or "").strip()
    row.sort_order = int(payload.sort_order or 0)
    row.enabled = bool(payload.enabled)
    await db.flush()
    await db.refresh(row)
    return _rec_to_dict(row)


@router.delete("/{mentor_id}/recommendations/{rec_id}")
async def delete_recommendation(
    mentor_id: int,
    rec_id: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, bool]:
    del admin
    row = await db.get(MentorRecommendation, rec_id)
    if not row or row.mentor_id != mentor_id:
        raise HTTPException(status_code=404, detail="推荐项不存在。")
    await db.execute(sql_delete(MentorRecommendation).where(MentorRecommendation.id == rec_id))
    await db.flush()
    return {"success": True}


# -------------------- 候选用户搜索（用于新建导师时挑用户） --------------------

@router.get("/_candidates/search")
async def search_user_candidates(
    keyword: str = "",
    limit: int = 20,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> list[dict[str, Any]]:
    """搜索可被设为导师的用户。已是导师的用户在结果里标记 already_mentor=true。"""
    del admin
    limit = max(1, min(int(limit or 20), 50))
    kw = (keyword or "").strip()
    stmt = select(User).where(User.disabled.is_(False))
    if kw:
        like = f"%{kw}%"
        stmt = stmt.where(
            (User.display_name.like(like))
            | (User.real_name.like(like))
            | (User.username.like(like))
            | (User.department.like(like))
        )
    stmt = stmt.order_by(User.id.desc()).limit(limit)
    result = await db.execute(stmt)
    users = list(result.scalars().all())
    if not users:
        return []
    mentor_result = await db.execute(
        select(Mentor.user_id).where(Mentor.user_id.in_([u.id for u in users]))
    )
    mentor_uids = {int(u) for (u,) in mentor_result.all()}
    return [
        {
            "id": int(u.id),
            "username": u.username,
            "display_name": u.display_name or u.real_name or u.username,
            "department": u.department or "",
            "position": u.position or "",
            "already_mentor": int(u.id) in mentor_uids,
        }
        for u in users
    ]
