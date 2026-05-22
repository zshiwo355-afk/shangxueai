from __future__ import annotations

import asyncio
import mimetypes
import re
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import quote

import oss2
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import delete as sql_delete, desc, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from .access import is_super_admin
from .auth import get_current_user, require_admin
from .config import get_settings
from .db import get_db
from .models import MagicReadingContent, MagicVideo, MaterialAsset, MaterialProject, User

router = APIRouter(prefix="/api/materials", tags=["materials"])

settings = get_settings()
ASSET_TYPE_VALUES = {"video", "image", "document", "other"}
PROJECT_VISIBILITY_VALUES = {"private", "admin", "shared"}
MAX_MATERIAL_FILE_SIZE = 1024 * 1024 * 1024
OSS_PREFIX_RE = re.compile(r"^[A-Za-z0-9/_-]+$")


def _now() -> datetime:
    return datetime.now()


def _iso(value: Any) -> str | None:
    if value is None:
        return None
    return value.isoformat()


def _user_name(user: User | None) -> str:
    if not user:
        return ""
    return (user.real_name or user.display_name or user.username or "").strip()


def _safe_filename(name: str) -> str:
    return Path((name or "file").replace("\\", "/")).name or "file"


def _strip_slashes(value: str) -> str:
    return (value or "").strip().strip("/")


def _normalize_oss_endpoint(value: str) -> str:
    endpoint = (value or "").strip().rstrip("/")
    if not endpoint:
        raise HTTPException(status_code=500, detail="OSS_ENDPOINT 未配置。")
    if endpoint.startswith("http://") or endpoint.startswith("https://"):
        return endpoint
    return f"https://{endpoint}"


def _build_public_base_url(bucket: str, endpoint: str, public_base_url: str) -> str:
    custom_base = (public_base_url or "").strip().rstrip("/")
    if custom_base:
        return custom_base
    host = endpoint.split("://", 1)[-1]
    return f"https://{bucket}.{host}"


def _ensure_oss_settings() -> dict[str, Any]:
    if not settings.oss_access_key_id or not settings.oss_access_key_secret:
        raise HTTPException(status_code=500, detail="OSS AccessKey 未配置完整。")
    endpoint = _normalize_oss_endpoint(settings.oss_endpoint)
    bucket = (settings.oss_bucket or "").strip()
    if not bucket:
        raise HTTPException(status_code=500, detail="OSS_BUCKET 未配置。")
    public_base_url = _build_public_base_url(bucket, endpoint, settings.oss_public_base_url)
    default_prefix = _strip_slashes(settings.oss_upload_prefix) or "materials"
    return {
        "access_key_id": settings.oss_access_key_id,
        "access_key_secret": settings.oss_access_key_secret,
        "endpoint": endpoint,
        "bucket": bucket,
        "public_base_url": public_base_url,
        "default_prefix": default_prefix,
    }


def _build_oss_bucket() -> oss2.Bucket:
    oss_settings = _ensure_oss_settings()
    auth = oss2.Auth(oss_settings["access_key_id"], oss_settings["access_key_secret"])
    return oss2.Bucket(auth, oss_settings["endpoint"], oss_settings["bucket"])


def _build_oss_object_url(public_base_url: str, object_key: str) -> str:
    return f"{public_base_url.rstrip('/')}/{quote(object_key, safe='/')}"


def _build_signed_stream_url(object_key: str) -> str:
    bucket = _build_oss_bucket()
    expire_seconds = max(int(settings.oss_signed_url_expire_seconds or 3600), 60)
    return bucket.sign_url("GET", object_key, expire_seconds, slash_safe=True)


def _upload_binary_to_oss(object_key: str, content: bytes, mime_type: str) -> None:
    bucket = _build_oss_bucket()
    bucket.put_object(object_key, content, headers={"Content-Type": mime_type})


def _normalize_visibility(value: str) -> str:
    text = (value or "admin").strip().lower()
    if text not in PROJECT_VISIBILITY_VALUES:
        raise HTTPException(status_code=400, detail="不支持的项目可见性。")
    return text


def _validate_oss_prefix(value: str) -> str:
    text = _strip_slashes(value)
    if not text:
        return ""
    if text.startswith("/") or ".." in text or " " in text:
        raise HTTPException(status_code=400, detail="OSS 路径不合法。")
    if not OSS_PREFIX_RE.fullmatch(text):
        raise HTTPException(status_code=400, detail="OSS 路径仅允许字母、数字、-、_、/。")
    return text


def _detect_asset_type(mime_type: str, file_name: str) -> str:
    mime_text = (mime_type or "").strip().lower()
    suffix = Path(file_name or "").suffix.lower()
    if mime_text.startswith("video/"):
        return "video"
    if mime_text.startswith("image/"):
        return "image"
    if (
        mime_text in {
            "application/pdf",
            "application/msword",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "application/vnd.ms-excel",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "application/vnd.ms-powerpoint",
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            "text/plain",
        }
        or suffix in {".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".txt"}
    ):
        return "document"
    return "other"


def _build_material_object_key(prefix: str, file_name: str) -> str:
    safe_file_name = _safe_filename(file_name)
    suffix = Path(safe_file_name).suffix.lower()
    stored_name = f"{uuid.uuid4().hex}{suffix}"
    now = _now()
    date_path = now.strftime("%Y/%m")
    return f"{prefix}/{date_path}/{stored_name}"


def _project_visible_to_admin(project: MaterialProject, user: User) -> bool:
    if is_super_admin(user):
        return True
    if int(project.created_by) == int(user.id):
        return True
    visibility = (project.visibility or "admin").strip().lower()
    return visibility in {"admin", "shared"}


def _project_manageable_by_admin(project: MaterialProject, user: User) -> bool:
    return is_super_admin(user) or int(project.created_by) == int(user.id)


async def _get_project_or_404(db: AsyncSession, project_id: int) -> MaterialProject:
    row = await db.get(MaterialProject, project_id)
    if not row or row.is_deleted:
        raise HTTPException(status_code=404, detail="素材项目不存在。")
    return row


async def _get_asset_or_404(db: AsyncSession, asset_id: int) -> MaterialAsset:
    row = await db.get(MaterialAsset, asset_id)
    if not row or row.is_deleted:
        raise HTTPException(status_code=404, detail="素材文件不存在。")
    return row


async def _ensure_project_view_access(db: AsyncSession, project_id: int, user: User) -> MaterialProject:
    project = await _get_project_or_404(db, project_id)
    if not _project_visible_to_admin(project, user):
        raise HTTPException(status_code=403, detail="无权查看该素材项目。")
    return project


async def _ensure_project_manage_access(db: AsyncSession, project_id: int, user: User) -> MaterialProject:
    project = await _get_project_or_404(db, project_id)
    if not _project_manageable_by_admin(project, user):
        raise HTTPException(status_code=403, detail="无权管理该素材项目。")
    return project


async def _ensure_asset_view_access(db: AsyncSession, asset_id: int, user: User) -> tuple[MaterialAsset, MaterialProject]:
    asset = await _get_asset_or_404(db, asset_id)
    project = await _ensure_project_view_access(db, asset.project_id, user)
    return asset, project


async def _ensure_asset_manage_access(db: AsyncSession, asset_id: int, user: User) -> tuple[MaterialAsset, MaterialProject]:
    asset = await _get_asset_or_404(db, asset_id)
    project = await _ensure_project_manage_access(db, asset.project_id, user)
    return asset, project


def _project_to_dict(project: MaterialProject, *, asset_count: int = 0, creator: User | None = None) -> dict[str, Any]:
    return {
        "id": int(project.id),
        "name": project.name,
        "description": project.description or "",
        "oss_prefix": project.oss_prefix or "",
        "visibility": project.visibility or "admin",
        "created_by": int(project.created_by),
        "creator_name": _user_name(creator),
        "asset_count": int(asset_count),
        "created_at": _iso(project.created_at),
        "updated_at": _iso(project.updated_at),
    }


def _asset_to_dict(asset: MaterialAsset, *, project: MaterialProject | None = None, creator: User | None = None) -> dict[str, Any]:
    return {
        "id": int(asset.id),
        "project_id": int(asset.project_id),
        "project_name": project.name if project else "",
        "name": asset.name,
        "asset_type": asset.asset_type or "other",
        "file_name": asset.file_name,
        "object_key": asset.object_key,
        "mime_type": asset.mime_type or "",
        "file_size": int(asset.file_size or 0),
        "duration_seconds": int(asset.duration_seconds or 0),
        "remark": asset.remark or "",
        "tags": asset.tags or "",
        "status": asset.status or "active",
        "created_by": int(asset.created_by),
        "creator_name": _user_name(creator),
        "created_at": _iso(asset.created_at),
        "updated_at": _iso(asset.updated_at),
    }


class MaterialProjectPayload(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    description: str = Field(default="", max_length=5000)
    oss_prefix: str = Field(default="", max_length=255)
    visibility: str = Field(default="admin", max_length=16)

    @field_validator("visibility")
    @classmethod
    def _visibility(cls, value: str) -> str:
        text = (value or "admin").strip().lower()
        if text not in PROJECT_VISIBILITY_VALUES:
            raise ValueError("不支持的项目可见性。")
        return text


class MaterialAssetUpdatePayload(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    remark: str = Field(default="", max_length=5000)
    tags: str = Field(default="", max_length=5000)


@router.get("/projects")
async def list_material_projects(
    keyword: str | None = None,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> list[dict[str, Any]]:
    stmt = select(MaterialProject).where(MaterialProject.is_deleted.is_(False))
    if not is_super_admin(admin):
        stmt = stmt.where(
            or_(
                MaterialProject.created_by == admin.id,
                MaterialProject.visibility.in_(["admin", "shared"]),
            )
        )
    if (keyword or "").strip():
        like_value = f"%{keyword.strip()}%"
        stmt = stmt.where(or_(MaterialProject.name.like(like_value), MaterialProject.description.like(like_value)))
    stmt = stmt.order_by(desc(MaterialProject.updated_at), desc(MaterialProject.id))
    projects = (await db.execute(stmt)).scalars().all()
    if not projects:
        return []
    project_ids = [item.id for item in projects]
    count_rows = (
        await db.execute(
            select(MaterialAsset.project_id, func.count(MaterialAsset.id))
            .where(MaterialAsset.project_id.in_(project_ids), MaterialAsset.is_deleted.is_(False))
            .group_by(MaterialAsset.project_id)
        )
    ).all()
    count_map = {int(project_id): int(count) for project_id, count in count_rows}
    creator_ids = sorted({int(item.created_by) for item in projects})
    creators = {}
    if creator_ids:
        creators = {item.id: item for item in (await db.execute(select(User).where(User.id.in_(creator_ids)))).scalars().all()}
    return [_project_to_dict(item, asset_count=count_map.get(int(item.id), 0), creator=creators.get(item.created_by)) for item in projects]


@router.post("/projects")
async def create_material_project(
    payload: MaterialProjectPayload,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    prefix = _validate_oss_prefix(payload.oss_prefix)
    row = MaterialProject(
        name=payload.name.strip(),
        description=payload.description.strip(),
        oss_prefix=prefix,
        visibility=_normalize_visibility(payload.visibility),
        created_by=admin.id,
        is_deleted=False,
    )
    db.add(row)
    await db.flush()
    if not row.oss_prefix:
        oss_settings = _ensure_oss_settings()
        row.oss_prefix = f"{oss_settings['default_prefix']}/project-{row.id}"
        await db.flush()
    await db.refresh(row)
    return _project_to_dict(row, asset_count=0, creator=admin)


@router.get("/projects/{project_id}")
async def get_material_project(
    project_id: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    row = await _ensure_project_view_access(db, project_id, admin)
    creator = await db.get(User, row.created_by)
    count = int(
        (
            await db.execute(
                select(func.count(MaterialAsset.id)).where(
                    MaterialAsset.project_id == project_id,
                    MaterialAsset.is_deleted.is_(False),
                )
            )
        ).scalar_one()
        or 0
    )
    return _project_to_dict(row, asset_count=count, creator=creator)


@router.put("/projects/{project_id}")
async def update_material_project(
    project_id: int,
    payload: MaterialProjectPayload,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    row = await _ensure_project_manage_access(db, project_id, admin)
    row.name = payload.name.strip()
    row.description = payload.description.strip()
    row.visibility = _normalize_visibility(payload.visibility)
    row.oss_prefix = _validate_oss_prefix(payload.oss_prefix) or row.oss_prefix
    await db.flush()
    await db.refresh(row)
    creator = await db.get(User, row.created_by)
    count = int(
        (
            await db.execute(
                select(func.count(MaterialAsset.id)).where(
                    MaterialAsset.project_id == project_id,
                    MaterialAsset.is_deleted.is_(False),
                )
            )
        ).scalar_one()
        or 0
    )
    return _project_to_dict(row, asset_count=count, creator=creator)


@router.delete("/projects/{project_id}")
async def delete_material_project(
    project_id: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, bool]:
    row = await _ensure_project_manage_access(db, project_id, admin)
    asset_count = int(
        (
            await db.execute(
                select(func.count(MaterialAsset.id)).where(
                    MaterialAsset.project_id == project_id,
                    MaterialAsset.is_deleted.is_(False),
                )
            )
        ).scalar_one()
        or 0
    )
    if asset_count > 0:
        raise HTTPException(status_code=400, detail="项目下仍有素材文件，请先删除或迁移文件。")
    row.is_deleted = True
    row.deleted_at = _now()
    await db.flush()
    return {"success": True}


@router.get("/projects/{project_id}/assets")
async def list_material_assets(
    project_id: int,
    keyword: str | None = None,
    asset_type: str | None = None,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> list[dict[str, Any]]:
    project = await _ensure_project_view_access(db, project_id, admin)
    stmt = select(MaterialAsset).where(
        MaterialAsset.project_id == project_id,
        MaterialAsset.is_deleted.is_(False),
    )
    if (keyword or "").strip():
        like_value = f"%{keyword.strip()}%"
        stmt = stmt.where(
            or_(
                MaterialAsset.name.like(like_value),
                MaterialAsset.file_name.like(like_value),
                MaterialAsset.tags.like(like_value),
                MaterialAsset.remark.like(like_value),
            )
        )
    if (asset_type or "").strip():
        normalized_type = (asset_type or "").strip().lower()
        if normalized_type not in ASSET_TYPE_VALUES:
            raise HTTPException(status_code=400, detail="不支持的素材类型。")
        stmt = stmt.where(MaterialAsset.asset_type == normalized_type)
    stmt = stmt.order_by(desc(MaterialAsset.created_at), desc(MaterialAsset.id))
    assets = (await db.execute(stmt)).scalars().all()
    creator_ids = sorted({int(item.created_by) for item in assets})
    creators = {}
    if creator_ids:
        creators = {item.id: item for item in (await db.execute(select(User).where(User.id.in_(creator_ids)))).scalars().all()}
    return [_asset_to_dict(item, project=project, creator=creators.get(item.created_by)) for item in assets]


@router.get("/assets")
async def list_all_material_assets(
    keyword: str | None = None,
    asset_type: str | None = None,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> list[dict[str, Any]]:
    stmt = (
        select(MaterialAsset, MaterialProject)
        .join(MaterialProject, MaterialProject.id == MaterialAsset.project_id)
        .where(
            MaterialAsset.is_deleted.is_(False),
            MaterialProject.is_deleted.is_(False),
        )
    )
    if not is_super_admin(admin):
        stmt = stmt.where(
            or_(
                MaterialProject.created_by == admin.id,
                MaterialProject.visibility.in_(["admin", "shared"]),
            )
        )
    if (keyword or "").strip():
        like_value = f"%{keyword.strip()}%"
        stmt = stmt.where(
            or_(
                MaterialAsset.name.like(like_value),
                MaterialAsset.file_name.like(like_value),
                MaterialAsset.tags.like(like_value),
                MaterialProject.name.like(like_value),
            )
        )
    if (asset_type or "").strip():
        normalized_type = (asset_type or "").strip().lower()
        if normalized_type not in ASSET_TYPE_VALUES:
            raise HTTPException(status_code=400, detail="不支持的素材类型。")
        stmt = stmt.where(MaterialAsset.asset_type == normalized_type)
    stmt = stmt.order_by(desc(MaterialAsset.created_at), desc(MaterialAsset.id))
    rows = (await db.execute(stmt)).all()
    creator_ids = sorted({int(asset.created_by) for asset, _project in rows})
    creators = {}
    if creator_ids:
        creators = {item.id: item for item in (await db.execute(select(User).where(User.id.in_(creator_ids)))).scalars().all()}
    return [_asset_to_dict(asset, project=project, creator=creators.get(asset.created_by)) for asset, project in rows]


@router.post("/projects/{project_id}/assets")
async def create_material_asset(
    project_id: int,
    name: str = Form(...),
    remark: str = Form(default=""),
    tags: str = Form(default=""),
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    project = await _ensure_project_manage_access(db, project_id, admin)
    content = await file.read()
    file_size = len(content)
    if file_size <= 0:
        raise HTTPException(status_code=400, detail="文件内容不能为空。")
    if file_size > MAX_MATERIAL_FILE_SIZE:
        raise HTTPException(status_code=400, detail="文件大小超过限制。")
    safe_name = _safe_filename(file.filename or "asset")
    mime_type = (file.content_type or "").strip() or mimetypes.guess_type(safe_name)[0] or "application/octet-stream"
    object_key = _build_material_object_key(project.oss_prefix or "materials", safe_name)
    await asyncio.to_thread(_upload_binary_to_oss, object_key, content, mime_type)
    row = MaterialAsset(
        project_id=project_id,
        name=(name or "").strip() or Path(safe_name).stem,
        asset_type=_detect_asset_type(mime_type, safe_name),
        file_name=safe_name,
        object_key=object_key,
        mime_type=mime_type,
        file_size=file_size,
        duration_seconds=0,
        remark=(remark or "").strip(),
        tags=(tags or "").strip(),
        status="active",
        created_by=admin.id,
        is_deleted=False,
    )
    db.add(row)
    await db.flush()
    await db.refresh(row)
    return _asset_to_dict(row, project=project, creator=admin)


@router.get("/assets/{asset_id}")
async def get_material_asset(
    asset_id: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    asset, project = await _ensure_asset_view_access(db, asset_id, admin)
    creator = await db.get(User, asset.created_by)
    return _asset_to_dict(asset, project=project, creator=creator)


@router.put("/assets/{asset_id}")
async def update_material_asset(
    asset_id: int,
    payload: MaterialAssetUpdatePayload,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    asset, project = await _ensure_asset_manage_access(db, asset_id, admin)
    asset.name = payload.name.strip()
    asset.remark = payload.remark.strip()
    asset.tags = payload.tags.strip()
    await db.flush()
    await db.refresh(asset)
    creator = await db.get(User, asset.created_by)
    return _asset_to_dict(asset, project=project, creator=creator)


@router.delete("/assets/{asset_id}")
async def delete_material_asset(
    asset_id: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, bool]:
    asset, _project = await _ensure_asset_manage_access(db, asset_id, admin)
    video_ref = await db.execute(
        select(MagicVideo.id).where(
            MagicVideo.material_asset_id == asset.id,
            MagicVideo.deleted_at.is_(None),
        ).limit(1)
    )
    if video_ref.scalar_one_or_none() is not None:
        raise HTTPException(status_code=400, detail="该素材已被课程视频使用，不能删除。")
    reading_ref = await db.execute(
        select(MagicReadingContent.id).where(
            MagicReadingContent.image_object_key == asset.object_key,
            MagicReadingContent.is_deleted.is_(False),
        ).limit(1)
    )
    if reading_ref.scalar_one_or_none() is not None:
        raise HTTPException(status_code=400, detail="该素材已被读书内容推送使用，不能删除。")
    asset.is_deleted = True
    asset.deleted_at = _now()
    await db.flush()
    return {"success": True}


@router.get("/assets/{asset_id}/preview", response_model=None)
async def preview_material_asset(
    asset_id: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(get_current_user),
) -> RedirectResponse:
    if not (admin.role or "").strip().lower() in {"admin", "super_admin"}:
        raise HTTPException(status_code=403, detail="仅管理员可访问该素材。")
    asset, _project = await _ensure_asset_view_access(db, asset_id, admin)
    signed_url = await asyncio.to_thread(_build_signed_stream_url, asset.object_key)
    return RedirectResponse(signed_url, status_code=307)
