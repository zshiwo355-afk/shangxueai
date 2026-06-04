"""轮播图 API：管理员 CRUD + 上传 / 从素材库导入；用户端只读启用项。"""
from __future__ import annotations

import asyncio
import logging
import mimetypes
from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import delete as sql_delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from .auth import get_current_user, require_admin
from .db import get_db
from .magic_academy_api._oss import (
    _build_object_key_and_name,
    _build_oss_object_url,
    _ensure_oss_settings,
    _upload_binary_to_oss,
    _validate_reading_image_payload,
)
from .magic_academy_api._resource_cleanup import schedule_oss_object_cleanup
from .models import Banner, MaterialAsset, User

logger = logging.getLogger("app.banners_api")

# 用户端只读
user_router = APIRouter(prefix="/api", tags=["banners"])
# 管理员 CRUD
admin_router = APIRouter(prefix="/api/admin/banners", tags=["admin-banners"])


def _to_dict(row: Banner) -> dict[str, Any]:
    return {
        "id": int(row.id),
        "title": row.title or "",
        "image_url": row.image_url or "",
        "image_object_key": row.image_object_key or "",
        "link_url": row.link_url or "",
        "sort_order": int(row.sort_order or 0),
        "enabled": bool(row.enabled),
        "remark": row.remark or "",
        "material_asset_id": int(row.material_asset_id) if row.material_asset_id else None,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


# ---------------- 用户端：返回启用的轮播 ----------------

@user_router.get("/banners")
async def list_active_banners(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[dict[str, Any]]:
    del user
    result = await db.execute(
        select(Banner)
        .where(Banner.enabled.is_(True))
        .order_by(Banner.sort_order.asc(), Banner.id.asc())
    )
    return [_to_dict(row) for row in result.scalars().all()]


# ---------------- 管理员：列出 / 详情 ----------------

@admin_router.get("")
async def list_banners(
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> list[dict[str, Any]]:
    del admin
    result = await db.execute(
        select(Banner).order_by(Banner.sort_order.asc(), Banner.id.asc())
    )
    return [_to_dict(row) for row in result.scalars().all()]


# ---------------- 上传图片 / 从素材库导入 ----------------

@admin_router.post("/upload")
async def upload_banner_image(
    file: UploadFile = File(...),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    """上传新图片到 OSS，返回 url + object_key，前端再走 create 接口入库。"""
    del admin
    file_name = (file.filename or "banner").strip() or "banner"
    raw = await file.read()
    extension = _validate_reading_image_payload(file_name, len(raw), file.content_type or "")
    object_key, _stored_name = _build_object_key_and_name(file_name, extension)
    mime_type = (file.content_type or "").strip() or mimetypes.guess_type(file_name)[0] or "image/jpeg"
    await asyncio.to_thread(_upload_binary_to_oss, object_key, raw, mime_type)
    oss_settings = _ensure_oss_settings()
    return {
        "object_key": object_key,
        "url": _build_oss_object_url(oss_settings["public_base_url"], object_key),
        "mime_type": mime_type,
        "file_name": file_name,
        "file_size": len(raw),
    }


class BannerImportFromMaterialPayload(BaseModel):
    material_asset_id: int = Field(..., gt=0)


@admin_router.post("/import-from-material")
async def import_banner_from_material(
    payload: BannerImportFromMaterialPayload,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    """从素材库选一张图片，复用其 OSS 对象，不重新上传。"""
    del admin
    asset = await db.get(MaterialAsset, payload.material_asset_id)
    if not asset or asset.is_deleted:
        raise HTTPException(status_code=404, detail="素材不存在或已删除。")
    if (asset.asset_type or "").lower() != "image":
        raise HTTPException(status_code=400, detail="仅支持选择图片类型素材。")
    oss_settings = _ensure_oss_settings()
    return {
        "object_key": asset.object_key,
        "url": _build_oss_object_url(oss_settings["public_base_url"], asset.object_key),
        "mime_type": asset.mime_type or "image/jpeg",
        "file_name": asset.file_name or asset.name,
        "file_size": int(asset.file_size or 0),
        "material_asset_id": int(asset.id),
        "name": asset.name or "",
    }


# ---------------- 管理员：创建 / 更新 / 删除 ----------------

class BannerCreatePayload(BaseModel):
    title: str = Field(default="", max_length=255)
    image_url: str = Field(..., min_length=1, max_length=2048)
    image_object_key: str = Field(default="", max_length=1024)
    link_url: str = Field(default="", max_length=2048)
    sort_order: int = 0
    enabled: bool = True
    remark: str = Field(default="", max_length=500)
    material_asset_id: int | None = None


class BannerUpdatePayload(BaseModel):
    title: str | None = Field(default=None, max_length=255)
    image_url: str | None = Field(default=None, max_length=2048)
    image_object_key: str | None = Field(default=None, max_length=1024)
    link_url: str | None = Field(default=None, max_length=2048)
    sort_order: int | None = None
    enabled: bool | None = None
    remark: str | None = Field(default=None, max_length=500)
    material_asset_id: int | None = None


@admin_router.post("")
async def create_banner(
    payload: BannerCreatePayload,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    row = Banner(
        title=(payload.title or "").strip(),
        image_url=payload.image_url.strip(),
        image_object_key=(payload.image_object_key or "").strip(),
        link_url=(payload.link_url or "").strip(),
        sort_order=int(payload.sort_order or 0),
        enabled=bool(payload.enabled),
        remark=(payload.remark or "").strip(),
        material_asset_id=payload.material_asset_id,
        created_by=admin.id,
    )
    db.add(row)
    await db.flush()
    await db.refresh(row)
    return _to_dict(row)


@admin_router.put("/{banner_id}")
async def update_banner(
    banner_id: int,
    payload: BannerUpdatePayload,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    del admin
    row = await db.get(Banner, banner_id)
    if not row:
        raise HTTPException(status_code=404, detail="轮播图不存在。")
    old_object_key = row.image_object_key or ""
    old_came_from_material = bool(row.material_asset_id)

    if payload.title is not None:
        row.title = payload.title.strip()
    if payload.image_url is not None:
        row.image_url = payload.image_url.strip()
    if payload.image_object_key is not None:
        row.image_object_key = payload.image_object_key.strip()
    if payload.link_url is not None:
        row.link_url = payload.link_url.strip()
    if payload.sort_order is not None:
        row.sort_order = int(payload.sort_order)
    if payload.enabled is not None:
        row.enabled = bool(payload.enabled)
    if payload.remark is not None:
        row.remark = payload.remark.strip()
    if payload.material_asset_id is not None:
        row.material_asset_id = payload.material_asset_id or None

    await db.flush()
    await db.refresh(row)

    new_object_key = row.image_object_key or ""
    # 仅当旧图属于"自己上传"（不是从素材库导入）且对象键变了时才回收 OSS。
    if (
        old_object_key
        and old_object_key != new_object_key
        and not old_came_from_material
    ):
        schedule_oss_object_cleanup([old_object_key], logger=logger)

    return _to_dict(row)


@admin_router.delete("/{banner_id}")
async def delete_banner(
    banner_id: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, bool]:
    del admin
    row = await db.get(Banner, banner_id)
    if not row:
        raise HTTPException(status_code=404, detail="轮播图不存在。")
    object_key = row.image_object_key or ""
    came_from_material = bool(row.material_asset_id)
    await db.execute(sql_delete(Banner).where(Banner.id == banner_id))
    await db.flush()
    # 自己上传的图，配套清理 OSS；素材库导入的不动，避免影响素材本身。
    if object_key and not came_from_material:
        schedule_oss_object_cleanup([object_key], logger=logger)
    return {"success": True}
