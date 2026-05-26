from __future__ import annotations

import asyncio
import mimetypes
from datetime import date
from typing import Any

from fastapi import Depends, File, Form, HTTPException, Query, UploadFile
from sqlalchemy import delete as sql_delete, desc, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..access import is_super_admin
from ..auth import get_current_user, require_admin
from ..db import get_db
from ..models import (
    MagicReadingContent,
    MagicReadingContentTarget,
    User,
)
from ..magic_auto_actions import enqueue_audio_actions_for_reading_content
from . import router
from ._oss import (
    _build_oss_object_url,
    _build_signed_stream_url,
    _ensure_oss_settings,
    _upload_binary_to_oss,
    _validate_reading_image_payload,
)
from ._utils import (
    READING_CONTENT_ACTIVE,
    _iso,
    _json_loads,
    _normalize_image_source,
    _normalize_reading_target_type,
    _now,
    _parse_form_id_list,
    _parse_month,
    _safe_filename,
    _user_department,
    _user_name,
    _user_position,
)
from ._video_helpers import _get_material_asset_or_403


def _reading_target_to_dict(item: MagicReadingContentTarget) -> dict[str, Any]:
    return {
        "id": int(item.id),
        "target_type": item.target_type,
        "target_id": item.target_id or "",
    }


def _reading_image_url(object_key: str) -> str:
    if not (object_key or "").strip():
        return ""
    return _build_signed_stream_url(object_key.strip())


def _reading_content_to_dict(
    item: MagicReadingContent,
    *,
    targets: list[MagicReadingContentTarget] | None = None,
    image_url: str | None = None,
    creator: User | None = None,
    push_count: int | None = None,
) -> dict[str, Any]:
    resolved_url = image_url if image_url is not None else (item.image_url or "")
    target_rows = list(targets or [])
    return {
        "id": int(item.id),
        "reading_date": _iso(item.reading_date),
        "title": item.title,
        "description": item.description or "",
        "image_object_key": item.image_object_key or "",
        "image_url": resolved_url,
        "image_file_name": item.image_file_name or "",
        "image_mime_type": item.image_mime_type or "",
        "image_size": int(item.image_size or 0),
        "status": item.status or READING_CONTENT_ACTIVE,
        "created_by": int(item.created_by),
        "creator_name": _user_name(creator) if creator else "",
        "created_at": _iso(item.created_at),
        "updated_at": _iso(item.updated_at),
        "targets": [_reading_target_to_dict(target) for target in target_rows],
        "push_count": int(push_count if push_count is not None else sum(1 for target in target_rows if target.target_type == "user")),
    }


async def _get_reading_content_targets_map(
    db: AsyncSession,
    content_ids: list[int],
) -> dict[int, list[MagicReadingContentTarget]]:
    if not content_ids:
        return {}
    result = await db.execute(
        select(MagicReadingContentTarget)
        .where(MagicReadingContentTarget.content_id.in_(content_ids))
        .order_by(MagicReadingContentTarget.id.asc())
    )
    mapping: dict[int, list[MagicReadingContentTarget]] = {}
    for item in result.scalars().all():
        mapping.setdefault(item.content_id, []).append(item)
    return mapping


def _reading_target_matches_user(user: User, target: MagicReadingContentTarget) -> bool:
    ttype = (target.target_type or "").strip().lower()
    target_id = (target.target_id or "").strip()
    if ttype == "all":
        return user.role == "user"
    if ttype == "all_newcomers":
        return user.role == "user" and bool(user.is_newcomer)
    if ttype == "department":
        return user.role == "user" and _user_department(user) == target_id
    if ttype == "position":
        return user.role == "user" and _user_position(user) == target_id
    if ttype == "user":
        return str(user.id) == target_id
    return False


async def _get_reading_content_or_404(
    db: AsyncSession,
    content_id: int,
) -> MagicReadingContent:
    row = await db.get(MagicReadingContent, content_id)
    if not row or row.is_deleted:
        raise HTTPException(status_code=404, detail="读书内容不存在。")
    return row


def _can_manage_reading_content(admin: User, row: MagicReadingContent) -> bool:
    return is_super_admin(admin) or int(row.created_by) == int(admin.id)


async def _replace_reading_targets(
    db: AsyncSession,
    content_id: int,
    *,
    target_type: str,
    user_ids: list[int],
    department_names: list[str],
    position_names: list[str],
) -> list[MagicReadingContentTarget]:
    await db.execute(sql_delete(MagicReadingContentTarget).where(MagicReadingContentTarget.content_id == content_id))
    rows: list[MagicReadingContentTarget] = []
    if target_type == "all":
        rows.append(MagicReadingContentTarget(content_id=content_id, target_type="all", target_id="0"))
    elif target_type == "all_newcomers":
        rows.append(MagicReadingContentTarget(content_id=content_id, target_type="all_newcomers", target_id="1"))
    elif target_type == "department":
        rows.extend(
            MagicReadingContentTarget(content_id=content_id, target_type="department", target_id=name)
            for name in department_names
        )
    elif target_type == "position":
        rows.extend(
            MagicReadingContentTarget(content_id=content_id, target_type="position", target_id=name)
            for name in position_names
        )
    else:
        rows.extend(
            MagicReadingContentTarget(content_id=content_id, target_type="user", target_id=str(user_id))
            for user_id in user_ids
        )
    for row in rows:
        db.add(row)
    await db.flush()
    return rows


async def _validate_reading_recipients(
    db: AsyncSession,
    *,
    target_type: str,
    target_user_ids: list[int],
    target_department_names: list[str],
    target_position_names: list[str],
) -> tuple[list[int], list[str], list[str], int]:
    target_type = _normalize_reading_target_type(target_type)
    if target_type == "all":
        result = await db.execute(select(func.count(User.id)).where(User.role == "user", User.disabled.is_(False)))
        return [], [], [], int(result.scalar_one() or 0)
    if target_type == "all_newcomers":
        result = await db.execute(
            select(func.count(User.id)).where(User.role == "user", User.disabled.is_(False), User.is_newcomer.is_(True))
        )
        return [], [], [], int(result.scalar_one() or 0)
    if target_type == "department":
        names = sorted({(name or "").strip() for name in target_department_names if (name or "").strip()})
        if not names:
            raise HTTPException(status_code=400, detail="请选择至少一个部门。")
        result = await db.execute(
            select(User.id, User.department)
            .where(User.role == "user", User.disabled.is_(False), User.department.in_(names))
        )
        rows = result.all()
        matched_departments = sorted({(department or "").strip() for _, department in rows if (department or "").strip()})
        if not rows:
            raise HTTPException(status_code=400, detail="所选部门下没有可推送员工。")
        return [], matched_departments, [], len(rows)
    if target_type == "position":
        names = sorted({(name or "").strip() for name in target_position_names if (name or "").strip()})
        if not names:
            raise HTTPException(status_code=400, detail="请选择至少一个岗位。")
        result = await db.execute(
            select(User.id, User.position)
            .where(User.role == "user", User.disabled.is_(False), User.position.in_(names))
        )
        rows = result.all()
        matched_positions = sorted({(position or "").strip() for _, position in rows if (position or "").strip()})
        if not rows:
            raise HTTPException(status_code=400, detail="所选岗位下没有可推送员工。")
        return [], [], matched_positions, len(rows)
    user_ids = sorted(set(target_user_ids))
    if not user_ids:
        raise HTTPException(status_code=400, detail="请选择至少一个员工。")
    result = await db.execute(
        select(User.id).where(User.id.in_(user_ids), User.role == "user", User.disabled.is_(False))
    )
    existing_ids = sorted({int(item[0]) for item in result.all()})
    if len(existing_ids) != len(user_ids):
        raise HTTPException(status_code=400, detail="推送对象里包含无效员工。")
    return existing_ids, [], [], len(existing_ids)


async def _count_reading_targets(
    db: AsyncSession,
    targets: list[MagicReadingContentTarget],
) -> int:
    if not targets:
        return 0
    if any((item.target_type or "").lower() == "all" for item in targets):
        result = await db.execute(select(func.count(User.id)).where(User.role == "user", User.disabled.is_(False)))
        return int(result.scalar_one() or 0)
    if any((item.target_type or "").lower() == "all_newcomers" for item in targets):
        result = await db.execute(
            select(func.count(User.id)).where(User.role == "user", User.disabled.is_(False), User.is_newcomer.is_(True))
        )
        return int(result.scalar_one() or 0)
    departments = sorted({
        (item.target_id or "").strip()
        for item in targets
        if (item.target_type or "").lower() == "department" and (item.target_id or "").strip()
    })
    if departments:
        result = await db.execute(
            select(func.count(User.id)).where(
                User.role == "user",
                User.disabled.is_(False),
                User.department.in_(departments),
            )
        )
        return int(result.scalar_one() or 0)
    positions = sorted({
        (item.target_id or "").strip()
        for item in targets
        if (item.target_type or "").lower() == "position" and (item.target_id or "").strip()
    })
    if positions:
        result = await db.execute(
            select(func.count(User.id)).where(
                User.role == "user",
                User.disabled.is_(False),
                User.position.in_(positions),
            )
        )
        return int(result.scalar_one() or 0)
    user_ids = sorted({
        int(item.target_id)
        for item in targets
        if (item.target_type or "").lower() == "user" and str(item.target_id or "").isdigit()
    })
    return len(user_ids)


@router.get("/admin/reading-contents")
async def list_admin_reading_contents(
    month: str | None = None,
    date_value: str | None = Query(default=None, alias="date"),
    keyword: str = "",
    page: int = 1,
    page_size: int = 20,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    stmt = select(MagicReadingContent).where(MagicReadingContent.is_deleted.is_(False))
    if not is_super_admin(admin):
        stmt = stmt.where(MagicReadingContent.created_by == admin.id)
    if date_value:
        try:
            target_date = date.fromisoformat(date_value)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="date 格式应为 YYYY-MM-DD。") from exc
        stmt = stmt.where(MagicReadingContent.reading_date == target_date)
    elif month:
        month_start, month_end = _parse_month(month)
        stmt = stmt.where(
            MagicReadingContent.reading_date >= month_start,
            MagicReadingContent.reading_date <= month_end,
        )
    keyword_text = (keyword or "").strip()
    if keyword_text:
        like_value = f"%{keyword_text}%"
        stmt = stmt.where(
            or_(
                MagicReadingContent.title.like(like_value),
                MagicReadingContent.description.like(like_value),
            )
        )
    page = max(int(page or 1), 1)
    page_size = max(min(int(page_size or 20), 100), 1)
    count_stmt = select(func.count()).select_from(stmt.order_by(None).subquery())
    total = int((await db.execute(count_stmt)).scalar_one() or 0)
    stmt = stmt.order_by(desc(MagicReadingContent.reading_date), desc(MagicReadingContent.created_at))
    stmt = stmt.offset((page - 1) * page_size).limit(page_size)
    rows = (await db.execute(stmt)).scalars().all()
    content_ids = [item.id for item in rows]
    targets_map = await _get_reading_content_targets_map(db, content_ids)
    creator_ids = sorted({int(item.created_by) for item in rows})
    creator_map: dict[int, User] = {}
    if creator_ids:
        creator_result = await db.execute(select(User).where(User.id.in_(creator_ids)))
        creator_map = {item.id: item for item in creator_result.scalars().all()}
    items = []
    for row in rows:
        targets = targets_map.get(row.id, [])
        items.append(
            _reading_content_to_dict(
                row,
                targets=targets,
                image_url=await asyncio.to_thread(_reading_image_url, row.image_object_key or ""),
                creator=creator_map.get(row.created_by),
                push_count=await _count_reading_targets(db, targets),
            )
        )
    return {
        "items": items,
        "page": page,
        "page_size": page_size,
        "total": total,
    }


@router.get("/admin/reading-contents/{content_id}")
async def get_admin_reading_content_detail(
    content_id: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    row = await _get_reading_content_or_404(db, content_id)
    if not _can_manage_reading_content(admin, row):
        raise HTTPException(status_code=403, detail="无权查看该读书内容。")
    targets_map = await _get_reading_content_targets_map(db, [content_id])
    creator = await db.get(User, row.created_by)
    targets = targets_map.get(content_id, [])
    return _reading_content_to_dict(
        row,
        targets=targets,
        image_url=await asyncio.to_thread(_reading_image_url, row.image_object_key or ""),
        creator=creator,
        push_count=await _count_reading_targets(db, targets),
    )


@router.post("/admin/reading-contents")
async def create_admin_reading_content(
    reading_date: date = Form(...),
    title: str = Form(...),
    description: str = Form(default=""),
    image_source: str = Form(default="upload"),
    material_asset_id: int | None = Form(default=None),
    target_type: str = Form(...),
    target_user_ids: str = Form(default=""),
    target_department_ids: str = Form(default=""),
    target_position_ids: str = Form(default=""),
    image: UploadFile | None = File(default=None),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    normalized_image_source = _normalize_image_source(image_source)
    normalized_target_type = _normalize_reading_target_type(target_type)
    normalized_title = (title or "").strip()
    if not normalized_title:
        raise HTTPException(status_code=400, detail="请输入标题。")
    user_ids = _parse_form_id_list(target_user_ids)
    department_names = sorted({
        item.strip()
        for item in (_json_loads(target_department_ids, []) if (target_department_ids or "").strip().startswith("[") else (target_department_ids or "").split(","))
        if str(item).strip()
    })
    position_names = sorted({
        item.strip()
        for item in (_json_loads(target_position_ids, []) if (target_position_ids or "").strip().startswith("[") else (target_position_ids or "").split(","))
        if str(item).strip()
    })
    valid_user_ids, valid_departments, valid_positions, push_count = await _validate_reading_recipients(
        db,
        target_type=normalized_target_type,
        target_user_ids=user_ids,
        target_department_names=department_names,
        target_position_names=position_names,
    )
    if normalized_image_source == "material":
        if not material_asset_id:
            raise HTTPException(status_code=400, detail="请选择素材库图片。")
        material_asset = await _get_material_asset_or_403(
            db,
            material_asset_id,
            admin,
            expected_type="image",
        )
        object_key = material_asset.object_key
        object_url = _build_oss_object_url(_ensure_oss_settings()["public_base_url"], object_key)
        image_file_name = material_asset.file_name
        image_mime_type = material_asset.mime_type or "image/jpeg"
        image_size = int(material_asset.file_size or 0)
    else:
        if image is None:
            raise HTTPException(status_code=400, detail="请先上传读书内容图片。")
        raw = await image.read()
        mime_type = (image.content_type or "").strip() or mimetypes.guess_type(image.filename or "")[0] or "image/jpeg"
        extension = _validate_reading_image_payload(image.filename or "", len(raw), mime_type)
        from ._oss import _build_object_key_and_name

        object_key, stored_filename = _build_object_key_and_name(image.filename or f"reading-content{extension}", extension)
        await asyncio.to_thread(_upload_binary_to_oss, object_key, raw, mime_type)
        object_url = _build_oss_object_url(_ensure_oss_settings()["public_base_url"], object_key)
        image_file_name = _safe_filename(image.filename or stored_filename)
        image_mime_type = mime_type
        image_size = len(raw)
    row = MagicReadingContent(
        reading_date=reading_date,
        title=normalized_title,
        description=(description or "").strip(),
        image_object_key=object_key,
        image_url=object_url,
        image_file_name=image_file_name,
        image_mime_type=image_mime_type,
        image_size=image_size,
        status=READING_CONTENT_ACTIVE,
        created_by=admin.id,
        is_deleted=False,
    )
    db.add(row)
    await db.flush()
    targets = await _replace_reading_targets(
        db,
        row.id,
        target_type=normalized_target_type,
        user_ids=valid_user_ids,
        department_names=valid_departments,
        position_names=valid_positions,
    )
    await enqueue_audio_actions_for_reading_content(
        db,
        row,
        targets,
        created_by=admin.id,
    )
    await db.refresh(row)
    return _reading_content_to_dict(
        row,
        targets=targets,
        image_url=await asyncio.to_thread(_reading_image_url, row.image_object_key or ""),
        creator=admin,
        push_count=push_count,
    )


@router.put("/admin/reading-contents/{content_id}")
async def update_admin_reading_content(
    content_id: int,
    reading_date: date = Form(...),
    title: str = Form(...),
    description: str = Form(default=""),
    image_source: str = Form(default="upload"),
    material_asset_id: int | None = Form(default=None),
    target_type: str = Form(...),
    target_user_ids: str = Form(default=""),
    target_department_ids: str = Form(default=""),
    target_position_ids: str = Form(default=""),
    image: UploadFile | None = File(default=None),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    row = await _get_reading_content_or_404(db, content_id)
    if not _can_manage_reading_content(admin, row):
        raise HTTPException(status_code=403, detail="无权编辑该读书内容。")
    normalized_image_source = _normalize_image_source(image_source)
    normalized_target_type = _normalize_reading_target_type(target_type)
    normalized_title = (title or "").strip()
    if not normalized_title:
        raise HTTPException(status_code=400, detail="请输入标题。")
    user_ids = _parse_form_id_list(target_user_ids)
    department_names = sorted({
        item.strip()
        for item in (_json_loads(target_department_ids, []) if (target_department_ids or "").strip().startswith("[") else (target_department_ids or "").split(","))
        if str(item).strip()
    })
    position_names = sorted({
        item.strip()
        for item in (_json_loads(target_position_ids, []) if (target_position_ids or "").strip().startswith("[") else (target_position_ids or "").split(","))
        if str(item).strip()
    })
    valid_user_ids, valid_departments, valid_positions, push_count = await _validate_reading_recipients(
        db,
        target_type=normalized_target_type,
        target_user_ids=user_ids,
        target_department_names=department_names,
        target_position_names=position_names,
    )
    row.reading_date = reading_date
    row.title = normalized_title
    row.description = (description or "").strip()
    row.status = READING_CONTENT_ACTIVE
    if normalized_image_source == "material":
        if not material_asset_id:
            raise HTTPException(status_code=400, detail="请选择素材库图片。")
        material_asset = await _get_material_asset_or_403(
            db,
            material_asset_id,
            admin,
            expected_type="image",
        )
        row.image_object_key = material_asset.object_key
        row.image_url = _build_oss_object_url(_ensure_oss_settings()["public_base_url"], material_asset.object_key)
        row.image_file_name = material_asset.file_name
        row.image_mime_type = material_asset.mime_type or "image/jpeg"
        row.image_size = int(material_asset.file_size or 0)
    elif image is not None and image.filename:
        raw = await image.read()
        mime_type = (image.content_type or "").strip() or mimetypes.guess_type(image.filename or "")[0] or "image/jpeg"
        extension = _validate_reading_image_payload(image.filename or "", len(raw), mime_type)
        from ._oss import _build_object_key_and_name

        object_key, stored_filename = _build_object_key_and_name(image.filename or f"reading-content{extension}", extension)
        await asyncio.to_thread(_upload_binary_to_oss, object_key, raw, mime_type)
        row.image_object_key = object_key
        row.image_url = _build_oss_object_url(_ensure_oss_settings()["public_base_url"], object_key)
        row.image_file_name = _safe_filename(image.filename or stored_filename)
        row.image_mime_type = mime_type
        row.image_size = len(raw)
    targets = await _replace_reading_targets(
        db,
        row.id,
        target_type=normalized_target_type,
        user_ids=valid_user_ids,
        department_names=valid_departments,
        position_names=valid_positions,
    )
    await db.flush()
    await db.refresh(row)
    creator = await db.get(User, row.created_by)
    return _reading_content_to_dict(
        row,
        targets=targets,
        image_url=await asyncio.to_thread(_reading_image_url, row.image_object_key or ""),
        creator=creator,
        push_count=push_count,
    )


@router.delete("/admin/reading-contents/{content_id}")
async def delete_admin_reading_content(
    content_id: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, bool]:
    row = await _get_reading_content_or_404(db, content_id)
    if not _can_manage_reading_content(admin, row):
        raise HTTPException(status_code=403, detail="无权删除该读书内容。")
    row.is_deleted = True
    row.deleted_at = _now()
    await db.flush()
    return {"success": True}


@router.get("/my/reading-contents")
async def list_my_reading_contents(
    date_value: str | None = Query(default=None, alias="date"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[dict[str, Any]]:
    target_date = date.today()
    if date_value:
        try:
            target_date = date.fromisoformat(date_value)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="date 格式应为 YYYY-MM-DD。") from exc
    result = await db.execute(
        select(MagicReadingContent)
        .where(
            MagicReadingContent.is_deleted.is_(False),
            MagicReadingContent.status == READING_CONTENT_ACTIVE,
            MagicReadingContent.reading_date == target_date,
        )
        .order_by(desc(MagicReadingContent.created_at), desc(MagicReadingContent.id))
    )
    rows = result.scalars().all()
    if not rows:
        return []
    targets_map = await _get_reading_content_targets_map(db, [item.id for item in rows])
    output = []
    for row in rows:
        targets = targets_map.get(row.id, [])
        if not targets or not any(_reading_target_matches_user(user, target) for target in targets):
            continue
        output.append(
            _reading_content_to_dict(
                row,
                targets=targets,
                image_url=await asyncio.to_thread(_reading_image_url, row.image_object_key or ""),
            )
        )
    return output
