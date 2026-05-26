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
from fastapi.responses import RedirectResponse, StreamingResponse
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import delete as sql_delete, desc, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from .access import is_super_admin
from .auth import get_current_user, require_admin
from .config import get_settings
from .db import get_db
from .magic_academy_api._oss import (
    MULTIPART_URL_EXPIRE_SECONDS,
    _abort_multipart_upload,
    _complete_multipart_upload,
    _start_multipart_upload,
)
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


def _page_payload(items: list[dict[str, Any]], total: int, page: int, page_size: int) -> dict[str, Any]:
    return {"items": items, "total": int(total), "page": int(page), "page_size": int(page_size)}


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


def _format_content_disposition(filename: str | None, *, attachment: bool) -> str:
    kind = "attachment" if attachment else "inline"
    name = (filename or "").strip()
    if not name:
        return kind
    try:
        ascii_name = name.encode("ascii").decode("ascii")
        return f'{kind}; filename="{ascii_name}"'
    except UnicodeEncodeError:
        return f"{kind}; filename*=UTF-8''{quote(name)}"


def _build_signed_disposition_url(
    object_key: str,
    *,
    filename: str | None = None,
    attachment: bool = False,
) -> str:
    """Sign a GET URL that asks OSS to respond with the chosen
    Content-Disposition. Used to drive direct browser playback / preview /
    download without proxying bytes through this backend."""
    bucket = _build_oss_bucket()
    expire_seconds = max(int(settings.oss_signed_url_expire_seconds or 3600), 60)
    disposition = _format_content_disposition(filename, attachment=attachment)
    return bucket.sign_url(
        "GET",
        object_key,
        expire_seconds,
        params={"response-content-disposition": disposition},
        slash_safe=True,
    )


def _build_signed_inline_url(
    object_key: str,
    *,
    mime_type: str | None = None,
    filename: str | None = None,
) -> str:
    """Sign a GET URL that asks OSS to respond with inline disposition so
    browsers render the file in <img>/<video>/<iframe> instead of downloading.

    Note: we deliberately avoid `response-content-type` because some OSS
    buckets / sub-accounts reject it (error 0017-00000902). The Content-Type
    stored at upload time is what the browser sees -- making sure that's
    correct is the upload path's job.
    """
    del mime_type  # kept for backwards-compat, intentionally unused
    return _build_signed_disposition_url(object_key, filename=filename, attachment=False)


def _upload_binary_to_oss(object_key: str, content: bytes, mime_type: str) -> None:
    bucket = _build_oss_bucket()
    bucket.put_object(object_key, content, headers={"Content-Type": mime_type})


def _upload_file_to_oss(object_key: str, file_obj: Any, mime_type: str) -> None:
    bucket = _build_oss_bucket()
    bucket.put_object(object_key, file_obj, headers={"Content-Type": mime_type})


async def _upload_file_size(file: UploadFile) -> int:
    await file.seek(0)
    await asyncio.to_thread(file.file.seek, 0, 2)
    size = int(await asyncio.to_thread(file.file.tell))
    await file.seek(0)
    return size


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


async def _list_visible_projects(db: AsyncSession, user: User) -> list[MaterialProject]:
    stmt = select(MaterialProject).where(MaterialProject.is_deleted.is_(False))
    if not is_super_admin(user):
        stmt = stmt.where(
            or_(
                MaterialProject.created_by == user.id,
                MaterialProject.visibility.in_(["admin", "shared"]),
            )
        )
    stmt = stmt.order_by(MaterialProject.sort_order.asc(), MaterialProject.id.asc())
    return list((await db.execute(stmt)).scalars().all())


async def _next_project_sort_order(db: AsyncSession, parent_id: int | None) -> int:
    value = (
        await db.execute(
            select(func.max(MaterialProject.sort_order)).where(
                MaterialProject.parent_id == parent_id,
                MaterialProject.is_deleted.is_(False),
            )
        )
    ).scalar_one_or_none()
    return int(value or 0) + 1


async def _next_asset_sort_order(db: AsyncSession, project_id: int) -> int:
    value = (
        await db.execute(
            select(func.max(MaterialAsset.sort_order)).where(
                MaterialAsset.project_id == project_id,
                MaterialAsset.is_deleted.is_(False),
            )
        )
    ).scalar_one_or_none()
    return int(value or 0) + 1


async def _ensure_valid_parent(
    db: AsyncSession,
    *,
    parent_id: int | None,
    admin: User,
    current_id: int | None = None,
) -> MaterialProject | None:
    if parent_id in (None, 0):
        return None
    parent = await _ensure_project_manage_access(db, int(parent_id), admin)
    if current_id and int(parent.id) == int(current_id):
        raise HTTPException(status_code=400, detail="文件夹不能移动到自己下面。")
    if current_id:
        projects = (
            await db.execute(select(MaterialProject.id, MaterialProject.parent_id).where(MaterialProject.is_deleted.is_(False)))
        ).all()
        parent_map = {int(project_id): (int(parent_value) if parent_value is not None else None) for project_id, parent_value in projects}
        probe = int(parent.id)
        while probe is not None:
            if int(probe) == int(current_id):
                raise HTTPException(status_code=400, detail="不能把文件夹移动到自己的子文件夹下。")
            probe = parent_map.get(int(probe))
    return parent


def _build_project_path_ids(project: MaterialProject, project_map: dict[int, MaterialProject]) -> list[int]:
    path: list[int] = []
    current: MaterialProject | None = project
    visited: set[int] = set()
    while current:
        current_id = int(current.id)
        if current_id in visited:
            break
        visited.add(current_id)
        path.append(current_id)
        parent_id = int(current.parent_id) if current.parent_id is not None else None
        current = project_map.get(parent_id) if parent_id is not None else None
    return list(reversed(path))


def _project_to_dict(
    project: MaterialProject,
    *,
    asset_count: int = 0,
    child_count: int = 0,
    creator: User | None = None,
    project_map: dict[int, MaterialProject] | None = None,
) -> dict[str, Any]:
    path_ids = _build_project_path_ids(project, project_map or {int(project.id): project})
    path_names = [
        (project_map or {}).get(path_id).name if (project_map or {}).get(path_id) else project.name
        for path_id in path_ids
    ]
    return {
        "id": int(project.id),
        "name": project.name,
        "description": project.description or "",
        "oss_prefix": project.oss_prefix or "",
        "visibility": project.visibility or "admin",
        "parent_id": int(project.parent_id) if project.parent_id is not None else None,
        "sort_order": int(project.sort_order or 0),
        "created_by": int(project.created_by),
        "creator_name": _user_name(creator),
        "asset_count": int(asset_count),
        "child_count": int(child_count),
        "path_ids": path_ids,
        "path_names": path_names,
        "created_at": _iso(project.created_at),
        "updated_at": _iso(project.updated_at),
    }


def _asset_to_dict(asset: MaterialAsset, *, project: MaterialProject | None = None, creator: User | None = None) -> dict[str, Any]:
    return {
        "id": int(asset.id),
        "project_id": int(asset.project_id),
        "project_name": project.name if project else "",
        "sort_order": int(asset.sort_order or 0),
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
    parent_id: int | None = None

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


class MaterialAssetUploadInitPayload(BaseModel):
    file_name: str = Field(..., min_length=1, max_length=512)
    file_size: int = Field(..., ge=1, le=MAX_MATERIAL_FILE_SIZE)
    mime_type: str = Field(default="", max_length=255)


class MaterialAssetUploadPartPayload(BaseModel):
    part_number: int = Field(..., ge=1)
    etag: str = Field(..., min_length=1, max_length=128)


class MaterialAssetUploadCompletePayload(BaseModel):
    object_key: str = Field(..., min_length=1, max_length=1024)
    upload_id: str = Field(..., min_length=1, max_length=256)
    file_name: str = Field(..., min_length=1, max_length=512)
    file_size: int = Field(..., ge=1, le=MAX_MATERIAL_FILE_SIZE)
    parts: list[MaterialAssetUploadPartPayload] = Field(..., min_length=1)
    name: str = Field(default="", max_length=255)
    mime_type: str = Field(default="", max_length=255)
    remark: str = Field(default="", max_length=5000)
    tags: str = Field(default="", max_length=5000)


class MaterialAssetUploadAbortPayload(BaseModel):
    object_key: str = Field(..., min_length=1, max_length=1024)
    upload_id: str = Field(..., min_length=1, max_length=256)


class MaterialProjectMovePayload(BaseModel):
    parent_id: int | None = None


class MaterialAssetMovePayload(BaseModel):
    project_id: int = Field(..., gt=0)


@router.get("/projects")
async def list_material_projects(
    keyword: str | None = None,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> list[dict[str, Any]]:
    projects = await _list_visible_projects(db, admin)
    if not projects:
        return []
    if (keyword or "").strip():
        like_value = keyword.strip().lower()
        projects = [
            item
            for item in projects
            if like_value in (item.name or "").lower()
            or like_value in (item.description or "").lower()
        ]
        if not projects:
            return []
    project_map = {int(item.id): item for item in projects}
    project_ids = [item.id for item in projects]
    count_rows = (
        await db.execute(
            select(MaterialAsset.project_id, func.count(MaterialAsset.id))
            .where(MaterialAsset.project_id.in_(project_ids), MaterialAsset.is_deleted.is_(False))
            .group_by(MaterialAsset.project_id)
        )
    ).all()
    count_map = {int(project_id): int(count) for project_id, count in count_rows}
    child_rows = (
        await db.execute(
            select(MaterialProject.parent_id, func.count(MaterialProject.id))
            .where(
                MaterialProject.parent_id.in_(project_ids),
                MaterialProject.is_deleted.is_(False),
            )
            .group_by(MaterialProject.parent_id)
        )
    ).all()
    child_map = {int(parent_id): int(count) for parent_id, count in child_rows if parent_id is not None}
    creator_ids = sorted({int(item.created_by) for item in projects})
    creators = {}
    if creator_ids:
        creators = {item.id: item for item in (await db.execute(select(User).where(User.id.in_(creator_ids)))).scalars().all()}
    return [
        _project_to_dict(
            item,
            asset_count=count_map.get(int(item.id), 0),
            child_count=child_map.get(int(item.id), 0),
            creator=creators.get(item.created_by),
            project_map=project_map,
        )
        for item in projects
    ]


@router.post("/projects")
async def create_material_project(
    payload: MaterialProjectPayload,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    prefix = _validate_oss_prefix(payload.oss_prefix)
    parent = await _ensure_valid_parent(db, parent_id=payload.parent_id, admin=admin)
    row = MaterialProject(
        name=payload.name.strip(),
        description=payload.description.strip(),
        oss_prefix=prefix,
        visibility=_normalize_visibility(payload.visibility),
        parent_id=int(parent.id) if parent else None,
        sort_order=await _next_project_sort_order(db, int(parent.id) if parent else None),
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
    project_map = {int(row.id): row}
    if parent:
        project_map[int(parent.id)] = parent
    return _project_to_dict(row, asset_count=0, creator=admin, project_map=project_map)


@router.get("/projects/{project_id}")
async def get_material_project(
    project_id: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    row = await _ensure_project_view_access(db, project_id, admin)
    visible_projects = await _list_visible_projects(db, admin)
    project_map = {int(item.id): item for item in visible_projects}
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
    child_count = int(
        (
            await db.execute(
                select(func.count(MaterialProject.id)).where(
                    MaterialProject.parent_id == project_id,
                    MaterialProject.is_deleted.is_(False),
                )
            )
        ).scalar_one()
        or 0
    )
    return _project_to_dict(row, asset_count=count, child_count=child_count, creator=creator, project_map=project_map)


@router.put("/projects/{project_id}")
async def update_material_project(
    project_id: int,
    payload: MaterialProjectPayload,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    row = await _ensure_project_manage_access(db, project_id, admin)
    parent = await _ensure_valid_parent(db, parent_id=payload.parent_id, admin=admin, current_id=project_id)
    row.name = payload.name.strip()
    row.description = payload.description.strip()
    row.visibility = _normalize_visibility(payload.visibility)
    row.parent_id = int(parent.id) if parent else None
    row.oss_prefix = _validate_oss_prefix(payload.oss_prefix) or row.oss_prefix
    await db.flush()
    await db.refresh(row)
    visible_projects = await _list_visible_projects(db, admin)
    project_map = {int(item.id): item for item in visible_projects}
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
    child_count = int(
        (
            await db.execute(
                select(func.count(MaterialProject.id)).where(
                    MaterialProject.parent_id == project_id,
                    MaterialProject.is_deleted.is_(False),
                )
            )
        ).scalar_one()
        or 0
    )
    return _project_to_dict(row, asset_count=count, child_count=child_count, creator=creator, project_map=project_map)


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
    if asset_count > 0:
        raise HTTPException(status_code=400, detail="当前文件夹下还有素材文件，请先移动或删除。")
    child_count = int(
        (
            await db.execute(
                select(func.count(MaterialProject.id)).where(
                    MaterialProject.parent_id == project_id,
                    MaterialProject.is_deleted.is_(False),
                )
            )
        ).scalar_one()
        or 0
    )
    if child_count > 0:
        raise HTTPException(status_code=400, detail="当前文件夹下还有子文件夹，请先清空后再删除。")
    row.is_deleted = True
    row.deleted_at = _now()
    await db.flush()
    return {"success": True}


@router.get("/projects/{project_id}/assets")
async def list_material_assets(
    project_id: int,
    page: int | None = Query(None, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    keyword: str | None = None,
    asset_type: str | None = None,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> list[dict[str, Any]] | dict[str, Any]:
    project = await _ensure_project_view_access(db, project_id, admin)
    stmt = select(MaterialAsset).where(
        MaterialAsset.project_id == project_id,
        MaterialAsset.is_deleted.is_(False),
    )
    count_stmt = select(func.count()).select_from(MaterialAsset).where(
        MaterialAsset.project_id == project_id,
        MaterialAsset.is_deleted.is_(False),
    )
    if (keyword or "").strip():
        like_value = f"%{keyword.strip()}%"
        keyword_cond = or_(
            MaterialAsset.name.like(like_value),
            MaterialAsset.file_name.like(like_value),
            MaterialAsset.tags.like(like_value),
            MaterialAsset.remark.like(like_value),
        )
        stmt = stmt.where(keyword_cond)
        count_stmt = count_stmt.where(keyword_cond)
    if (asset_type or "").strip():
        normalized_type = (asset_type or "").strip().lower()
        if normalized_type not in ASSET_TYPE_VALUES:
            raise HTTPException(status_code=400, detail="不支持的素材类型。")
        stmt = stmt.where(MaterialAsset.asset_type == normalized_type)
        count_stmt = count_stmt.where(MaterialAsset.asset_type == normalized_type)
    stmt = stmt.order_by(MaterialAsset.sort_order.asc(), MaterialAsset.created_at.desc(), MaterialAsset.id.desc())
    total = 0
    if page is not None:
        total = int((await db.execute(count_stmt)).scalar_one() or 0)
        stmt = stmt.limit(page_size).offset((page - 1) * page_size)
    assets = (await db.execute(stmt)).scalars().all()
    creator_ids = sorted({int(item.created_by) for item in assets})
    creators = {}
    if creator_ids:
        creators = {item.id: item for item in (await db.execute(select(User).where(User.id.in_(creator_ids)))).scalars().all()}
    items = [_asset_to_dict(item, project=project, creator=creators.get(item.created_by)) for item in assets]
    if page is None:
        return items
    return _page_payload(items, total, page, page_size)


@router.get("/assets")
async def list_all_material_assets(
    page: int | None = Query(None, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    keyword: str | None = None,
    asset_type: str | None = None,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> list[dict[str, Any]] | dict[str, Any]:
    stmt = (
        select(MaterialAsset, MaterialProject)
        .join(MaterialProject, MaterialProject.id == MaterialAsset.project_id)
        .where(
            MaterialAsset.is_deleted.is_(False),
            MaterialProject.is_deleted.is_(False),
        )
    )
    count_stmt = (
        select(func.count())
        .select_from(MaterialAsset)
        .join(MaterialProject, MaterialProject.id == MaterialAsset.project_id)
        .where(
            MaterialAsset.is_deleted.is_(False),
            MaterialProject.is_deleted.is_(False),
        )
    )
    if not is_super_admin(admin):
        visibility_cond = or_(
            MaterialProject.created_by == admin.id,
            MaterialProject.visibility.in_(["admin", "shared"]),
        )
        stmt = stmt.where(visibility_cond)
        count_stmt = count_stmt.where(visibility_cond)
    if (keyword or "").strip():
        like_value = f"%{keyword.strip()}%"
        keyword_cond = or_(
            MaterialAsset.name.like(like_value),
            MaterialAsset.file_name.like(like_value),
            MaterialAsset.tags.like(like_value),
            MaterialProject.name.like(like_value),
        )
        stmt = stmt.where(keyword_cond)
        count_stmt = count_stmt.where(keyword_cond)
    if (asset_type or "").strip():
        normalized_type = (asset_type or "").strip().lower()
        if normalized_type not in ASSET_TYPE_VALUES:
            raise HTTPException(status_code=400, detail="不支持的素材类型。")
        stmt = stmt.where(MaterialAsset.asset_type == normalized_type)
        count_stmt = count_stmt.where(MaterialAsset.asset_type == normalized_type)
    stmt = stmt.order_by(MaterialAsset.created_at.desc(), MaterialAsset.id.desc())
    total = 0
    if page is not None:
        total = int((await db.execute(count_stmt)).scalar_one() or 0)
        stmt = stmt.limit(page_size).offset((page - 1) * page_size)
    rows = (await db.execute(stmt)).all()
    creator_ids = sorted({int(asset.created_by) for asset, _project in rows})
    creators = {}
    if creator_ids:
        creators = {item.id: item for item in (await db.execute(select(User).where(User.id.in_(creator_ids)))).scalars().all()}
    items = [_asset_to_dict(asset, project=project, creator=creators.get(asset.created_by)) for asset, project in rows]
    if page is None:
        return items
    return _page_payload(items, total, page, page_size)


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
    file_size = await _upload_file_size(file)
    if file_size <= 0:
        raise HTTPException(status_code=400, detail="文件内容不能为空。")
    if file_size > MAX_MATERIAL_FILE_SIZE:
        raise HTTPException(status_code=400, detail="文件大小超过限制。")
    safe_name = _safe_filename(file.filename or "asset")
    raw_browser_mime = (file.content_type or "").strip().lower()
    guessed_by_ext = (mimetypes.guess_type(safe_name)[0] or "").strip().lower()
    # Prefer extension-based guess when the browser is unsure or wrong
    # (e.g. some browsers send "application/octet-stream" for everything).
    if not raw_browser_mime or raw_browser_mime == "application/octet-stream":
        mime_type = guessed_by_ext or raw_browser_mime or "application/octet-stream"
    else:
        mime_type = raw_browser_mime
    object_key = _build_material_object_key(project.oss_prefix or "materials", safe_name)
    await file.seek(0)
    await asyncio.to_thread(_upload_file_to_oss, object_key, file.file, mime_type)
    row = MaterialAsset(
        project_id=project_id,
        sort_order=await _next_asset_sort_order(db, project_id),
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


@router.post("/projects/{project_id}/assets/upload/init")
async def init_material_asset_upload(
    project_id: int,
    payload: MaterialAssetUploadInitPayload,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    project = await _ensure_project_manage_access(db, project_id, admin)
    safe_name = _safe_filename(payload.file_name)
    raw_browser_mime = (payload.mime_type or "").strip().lower()
    guessed_by_ext = (mimetypes.guess_type(safe_name)[0] or "").strip().lower()
    if not raw_browser_mime or raw_browser_mime == "application/octet-stream":
        mime_type = guessed_by_ext or raw_browser_mime or "application/octet-stream"
    else:
        mime_type = raw_browser_mime
    object_key = _build_material_object_key(project.oss_prefix or "materials", safe_name)
    upload_plan = await asyncio.to_thread(
        _start_multipart_upload,
        object_key,
        mime_type,
        int(payload.file_size or 0),
    )
    return {
        "method": "PUT",
        "object_key": object_key,
        "mime_type": mime_type,
        "upload_id": upload_plan["upload_id"],
        "part_size": upload_plan["part_size"],
        "part_count": upload_plan["part_count"],
        "part_urls": upload_plan["part_urls"],
        "expires_in_seconds": MULTIPART_URL_EXPIRE_SECONDS,
    }


@router.post("/projects/{project_id}/assets/upload/complete")
async def complete_material_asset_upload(
    project_id: int,
    payload: MaterialAssetUploadCompletePayload,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    project = await _ensure_project_manage_access(db, project_id, admin)
    object_key = (payload.object_key or "").strip()
    expected_prefix = (project.oss_prefix or "materials").rstrip("/") + "/"
    if not object_key.startswith(expected_prefix):
        raise HTTPException(status_code=400, detail="OSS 路径与项目不匹配。")
    if ".." in object_key or object_key.startswith("/"):
        raise HTTPException(status_code=400, detail="OSS 路径不合法。")
    safe_name = _safe_filename(payload.file_name)
    object_size = await asyncio.to_thread(
        _complete_multipart_upload,
        object_key,
        payload.upload_id.strip(),
        [item.model_dump() for item in payload.parts],
    )
    if object_size != int(payload.file_size or 0):
        raise HTTPException(status_code=400, detail="OSS 文件大小校验失败。")
    if object_size > MAX_MATERIAL_FILE_SIZE:
        raise HTTPException(status_code=400, detail="文件大小超过限制。")
    claimed_mime = (payload.mime_type or "").strip().lower()
    guessed_by_ext = (mimetypes.guess_type(safe_name)[0] or "").strip().lower()
    if claimed_mime and claimed_mime != "application/octet-stream":
        mime_type = claimed_mime
    else:
        mime_type = guessed_by_ext or claimed_mime or "application/octet-stream"
    row = MaterialAsset(
        project_id=project_id,
        sort_order=await _next_asset_sort_order(db, project_id),
        name=(payload.name or "").strip() or Path(safe_name).stem,
        asset_type=_detect_asset_type(mime_type, safe_name),
        file_name=safe_name,
        object_key=object_key,
        mime_type=mime_type,
        file_size=int(object_size),
        duration_seconds=0,
        remark=(payload.remark or "").strip(),
        tags=(payload.tags or "").strip(),
        status="active",
        created_by=admin.id,
        is_deleted=False,
    )
    db.add(row)
    await db.flush()
    await db.refresh(row)
    return _asset_to_dict(row, project=project, creator=admin)


@router.post("/projects/{project_id}/assets/upload/abort")
async def abort_material_asset_upload(
    project_id: int,
    payload: MaterialAssetUploadAbortPayload,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    project = await _ensure_project_manage_access(db, project_id, admin)
    object_key = (payload.object_key or "").strip()
    expected_prefix = (project.oss_prefix or "materials").rstrip("/") + "/"
    if not object_key.startswith(expected_prefix):
        raise HTTPException(status_code=400, detail="OSS 路径与项目不匹配。")
    try:
        await asyncio.to_thread(_abort_multipart_upload, object_key, payload.upload_id.strip())
    except Exception:  # noqa: BLE001
        pass
    return {"aborted": True}


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


@router.put("/projects/{project_id}/move")
async def move_material_project(
    project_id: int,
    payload: MaterialProjectMovePayload,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    row = await _ensure_project_manage_access(db, project_id, admin)
    parent = await _ensure_valid_parent(db, parent_id=payload.parent_id, admin=admin, current_id=project_id)
    next_parent_id = int(parent.id) if parent else None
    if row.parent_id != next_parent_id:
        row.parent_id = next_parent_id
        row.sort_order = await _next_project_sort_order(db, next_parent_id)
    await db.flush()
    await db.refresh(row)
    visible_projects = await _list_visible_projects(db, admin)
    project_map = {int(item.id): item for item in visible_projects}
    creator = await db.get(User, row.created_by)
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
    child_count = int(
        (
            await db.execute(
                select(func.count(MaterialProject.id)).where(
                    MaterialProject.parent_id == project_id,
                    MaterialProject.is_deleted.is_(False),
                )
            )
        ).scalar_one()
        or 0
    )
    return _project_to_dict(row, asset_count=asset_count, child_count=child_count, creator=creator, project_map=project_map)


@router.put("/assets/{asset_id}/move")
async def move_material_asset(
    asset_id: int,
    payload: MaterialAssetMovePayload,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    asset, _current_project = await _ensure_asset_manage_access(db, asset_id, admin)
    target_project = await _ensure_project_manage_access(db, payload.project_id, admin)
    if int(asset.project_id) != int(target_project.id):
        asset.project_id = int(target_project.id)
        asset.sort_order = await _next_asset_sort_order(db, int(target_project.id))
        await db.flush()
        await db.refresh(asset)
    creator = await db.get(User, asset.created_by)
    return _asset_to_dict(asset, project=target_project, creator=creator)


@router.get("/assets/{asset_id}/preview", response_model=None)
async def preview_material_asset(
    asset_id: int,
    download: bool = False,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(get_current_user),
):
    if not (admin.role or "").strip().lower() in {"admin", "super_admin"}:
        raise HTTPException(status_code=403, detail="仅管理员可访问该素材。")
    asset, _project = await _ensure_asset_view_access(db, asset_id, admin)

    object_key = asset.object_key
    file_name = asset.file_name or ""
    asset_type = (asset.asset_type or "").strip().lower()

    # Resolve a sane Content-Type. Prefer extension-based guess so that legacy
    # uploads stored with application/octet-stream still preview correctly.
    guessed_mime = (mimetypes.guess_type(file_name)[0] or "").strip().lower()
    stored_mime = (asset.mime_type or "").strip().lower()
    resolved_mime = guessed_mime or stored_mime or "application/octet-stream"
    if stored_mime and stored_mime != "application/octet-stream" and not guessed_mime:
        resolved_mime = stored_mime

    # Explicit downloads: redirect with attachment disposition so the file
    # streams directly from OSS, not through this backend.
    if download:
        signed_url = await asyncio.to_thread(
            _build_signed_disposition_url,
            object_key,
            filename=file_name or f"asset-{asset_id}",
            attachment=True,
        )
        return RedirectResponse(signed_url, status_code=307)

    # Videos: native byte-range seeking from OSS.
    if asset_type == "video":
        signed_url = await asyncio.to_thread(_build_signed_stream_url, object_key)
        return RedirectResponse(signed_url, status_code=307)

    # When the stored Content-Type is trustworthy (i.e. not the legacy
    # octet-stream blob), redirect to OSS with inline disposition. This
    # bypasses the backend proxy entirely for images, PDFs, audio, etc. and
    # is by far the biggest win for preview latency in lists.
    if stored_mime and stored_mime != "application/octet-stream":
        signed_url = await asyncio.to_thread(
            _build_signed_inline_url,
            object_key,
            filename=file_name or f"asset-{asset_id}",
        )
        return RedirectResponse(signed_url, status_code=307)

    # Legacy fallback: octet-stream uploads where the browser would refuse
    # to render the file based on the stored mime. Proxy through us so we
    # can override Content-Type.
    bucket = await asyncio.to_thread(_build_oss_bucket)
    try:
        oss_object = await asyncio.to_thread(bucket.get_object, object_key)
    except oss2.exceptions.NoSuchKey as exc:
        raise HTTPException(status_code=404, detail="素材文件不存在或已过期。") from exc
    except oss2.exceptions.OssError as exc:
        raise HTTPException(status_code=502, detail=f"素材读取失败：{exc}") from exc

    inline_name = file_name or f"asset-{asset_id}"
    try:
        ascii_name = inline_name.encode("ascii").decode("ascii")
        disposition_filename = f'filename="{ascii_name}"'
    except UnicodeEncodeError:
        disposition_filename = f"filename*=UTF-8''{quote(inline_name)}"
    disposition_kind = "attachment" if download else "inline"
    disposition = f"{disposition_kind}; {disposition_filename}"

    headers = {"Content-Disposition": disposition}
    content_length = getattr(oss_object, "content_length", None)
    if content_length:
        headers["Content-Length"] = str(content_length)
    headers["Cache-Control"] = "private, max-age=300"

    def iter_chunks(stream, chunk_size: int = 64 * 1024):
        try:
            while True:
                chunk = stream.read(chunk_size)
                if not chunk:
                    break
                yield chunk
        finally:
            close = getattr(stream, "close", None)
            if callable(close):
                try:
                    close()
                except Exception:  # noqa: BLE001
                    pass

    return StreamingResponse(
        iter_chunks(oss_object),
        media_type=resolved_mime,
        headers=headers,
    )
