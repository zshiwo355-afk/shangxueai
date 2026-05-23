from __future__ import annotations

import asyncio
import mimetypes
import uuid
from pathlib import Path
from typing import Any

from fastapi import Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import delete as sql_delete, desc, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import require_admin
from ..db import get_db
from ..magic_academy_schemas import (
    MagicVideoPayload,
    MagicVideoReplaceCompletePayload,
    MagicVideoReplaceFailPayload,
    MagicVideoReplaceInitPayload,
    MagicVideoUploadCompletePayload,
    MagicVideoUploadFailPayload,
    MagicVideoUploadInitPayload,
)
from ..models import (
    MagicVideo,
    MagicVideoProgress,
    MagicVideoSeriesItem,
    MagicVideoTarget,
    MagicVideoWatchConfirmSetting,
    MagicVideoWhitelist,
    MaterialAsset,
    User,
)
from . import magic_video_router, router
from ._oss import (
    MULTIPART_URL_EXPIRE_SECONDS,
    _abort_multipart_upload,
    _build_object_key_and_name,
    _build_oss_object_url,
    _build_public_base_url,
    _complete_multipart_upload,
    _delete_oss_object,
    _ensure_oss_settings,
    _start_multipart_upload,
    _validate_video_payload,
    logger,
    settings,
)
from ._utils import UPLOAD_ROOT, VIDEO_DIR, _now, _safe_filename
from ._video_helpers import (
    _get_material_asset_or_403,
    _get_series_context_map,
    _get_video_or_404,
    _get_video_targets,
    _get_watch_confirm_settings_map,
    _is_video_upload_ready,
    _video_to_dict,
)


async def _commit_refresh_and_serialize_video(
    db: AsyncSession,
    video: MagicVideo,
) -> dict[str, Any]:
    """Persist DB-side defaults/onupdate columns before serializing the ORM row."""
    await db.commit()
    await db.refresh(video)
    targets_map = await _get_video_targets(db, [video.id])
    return _video_to_dict(video, targets_map.get(video.id, []))


@magic_video_router.post("/videos/upload/init")
async def init_magic_video_upload(
    payload: MagicVideoUploadInitPayload,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    extension = _validate_video_payload(payload.original_filename, payload.file_size, payload.mime_type)
    object_key, stored_filename = _build_object_key_and_name(payload.original_filename, extension)
    oss_settings = _ensure_oss_settings()
    upload_plan = await asyncio.to_thread(
        _start_multipart_upload,
        object_key,
        payload.mime_type.strip() or "video/mp4",
        int(payload.file_size or 0),
    )
    video = MagicVideo(
        title=payload.title.strip(),
        description=payload.description.strip(),
        category=payload.category.strip(),
        file_name=_safe_filename(payload.original_filename),
        file_path=object_key,
        original_filename=_safe_filename(payload.original_filename),
        stored_filename=stored_filename,
        storage_type="oss",
        oss_bucket=oss_settings["bucket"],
        oss_endpoint=oss_settings["endpoint"],
        oss_object_key=object_key,
        mime_type=payload.mime_type.strip() or "video/mp4",
        file_size=int(payload.file_size or 0),
        duration_seconds=int(payload.duration_seconds or 0),
        duration=int(payload.duration_seconds or 0),
        is_required=payload.is_required,
        is_newcomer_required=payload.is_newcomer_required,
        deadline_at=payload.deadline_at,
        status=payload.status,
        upload_status="pending",
        upload_id=upload_plan["upload_id"],
        upload_error="",
        transcode_status="none",
        created_by=admin.id,
    )
    db.add(video)
    await db.flush()
    for target in payload.targets:
        db.add(
            MagicVideoTarget(
                video_id=video.id,
                target_type=target.target_type,
                target_value=target.target_value,
            )
        )
    await db.flush()
    return {
        "video_id": video.id,
        "oss_object_key": object_key,
        "bucket": oss_settings["bucket"],
        "endpoint": oss_settings["endpoint"],
        "public_base_url": oss_settings["public_base_url"],
        "upload_id": upload_plan["upload_id"],
        "part_size": upload_plan["part_size"],
        "part_count": upload_plan["part_count"],
        "part_urls": upload_plan["part_urls"],
        "expires_in_seconds": MULTIPART_URL_EXPIRE_SECONDS,
    }


@magic_video_router.post("/videos/upload/complete")
async def complete_magic_video_upload(
    payload: MagicVideoUploadCompletePayload,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    del admin
    video = await _get_video_or_404(db, payload.video_id)
    expected_key = (video.oss_object_key or "").strip()
    if not expected_key or expected_key != payload.oss_object_key.strip():
        raise HTTPException(status_code=400, detail="oss_object_key 与上传任务不匹配。")
    if (video.upload_id or "").strip() != payload.upload_id.strip():
        raise HTTPException(status_code=400, detail="upload_id 与上传任务不匹配。")
    if (video.upload_status or "pending") == "completed":
        targets_map = await _get_video_targets(db, [video.id])
        return _video_to_dict(video, targets_map.get(video.id, []))
    object_size = await asyncio.to_thread(
        _complete_multipart_upload,
        payload.oss_object_key.strip(),
        payload.upload_id.strip(),
        [item.model_dump() for item in payload.parts],
    )
    if object_size != int(payload.file_size or 0):
        raise HTTPException(status_code=400, detail="OSS 文件大小校验失败。")
    public_base_url = _build_public_base_url(video.oss_bucket or settings.oss_bucket, video.oss_endpoint or settings.oss_endpoint, settings.oss_public_base_url)
    object_url = _build_oss_object_url(public_base_url, payload.oss_object_key.strip())
    video.file_path = payload.oss_object_key.strip()
    video.oss_url = object_url
    video.cdn_url = object_url
    video.play_url = object_url
    video.file_size = object_size
    video.upload_status = "completed"
    video.upload_id = ""
    video.upload_error = ""
    return await _commit_refresh_and_serialize_video(db, video)


@magic_video_router.post("/videos/upload/fail")
async def fail_magic_video_upload(
    payload: MagicVideoUploadFailPayload,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    del admin
    video = await _get_video_or_404(db, payload.video_id)
    if (video.oss_object_key or "").strip() != payload.oss_object_key.strip():
        raise HTTPException(status_code=400, detail="oss_object_key 与上传任务不匹配。")
    if (video.upload_id or "").strip() != payload.upload_id.strip():
        raise HTTPException(status_code=400, detail="upload_id 与上传任务不匹配。")
    if (video.upload_status or "").strip().lower() == "completed":
        return {"ignored": True, "reason": "video already completed"}
    if (video.upload_status or "pending").strip().lower() not in {"pending", "uploading"}:
        return {"ignored": True, "reason": f"video status is {video.upload_status or 'unknown'}"}
    try:
        await asyncio.to_thread(_abort_multipart_upload, payload.oss_object_key.strip(), payload.upload_id.strip())
    except Exception:  # noqa: BLE001
        logger.exception("Failed to abort multipart upload for video %s", video.id)
    video.upload_status = "failed"
    video.upload_id = ""
    video.upload_error = payload.reason.strip() or "上传失败"
    await db.commit()
    return {
        "video_id": video.id,
        "upload_status": video.upload_status,
        "upload_error": video.upload_error,
    }


@magic_video_router.post("/videos/{video_id}/replace/init")
async def init_magic_video_replace_upload(
    video_id: int,
    payload: MagicVideoReplaceInitPayload,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    del admin
    video = await _get_video_or_404(db, video_id)
    extension = _validate_video_payload(payload.original_filename, payload.file_size, payload.mime_type)
    object_key, _stored_filename = _build_object_key_and_name(payload.original_filename, extension)
    oss_settings = _ensure_oss_settings()
    upload_plan = await asyncio.to_thread(
        _start_multipart_upload,
        object_key,
        payload.mime_type.strip() or "video/mp4",
        int(payload.file_size or 0),
    )
    video.replacement_upload_id = upload_plan["upload_id"]
    video.replacement_object_key = object_key
    video.replacement_original_filename = _safe_filename(payload.original_filename)
    video.replacement_mime_type = payload.mime_type.strip() or "video/mp4"
    video.replacement_file_size = int(payload.file_size or 0)
    video.replacement_duration_seconds = int(payload.duration_seconds or 0)
    await db.commit()
    return {
        "video_id": video.id,
        "oss_object_key": object_key,
        "bucket": oss_settings["bucket"],
        "endpoint": oss_settings["endpoint"],
        "public_base_url": oss_settings["public_base_url"],
        "upload_id": upload_plan["upload_id"],
        "part_size": upload_plan["part_size"],
        "part_count": upload_plan["part_count"],
        "part_urls": upload_plan["part_urls"],
        "expires_in_seconds": MULTIPART_URL_EXPIRE_SECONDS,
    }


@magic_video_router.post("/videos/{video_id}/replace/complete")
async def complete_magic_video_replace_upload(
    video_id: int,
    payload: MagicVideoReplaceCompletePayload,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    del admin
    video = await _get_video_or_404(db, video_id)
    if (video.replacement_object_key or "").strip() != payload.oss_object_key.strip():
        raise HTTPException(status_code=400, detail="替换任务 object_key 不匹配。")
    if (video.replacement_upload_id or "").strip() != payload.upload_id.strip():
        raise HTTPException(status_code=400, detail="替换任务 upload_id 不匹配。")

    object_size = await asyncio.to_thread(
        _complete_multipart_upload,
        payload.oss_object_key.strip(),
        payload.upload_id.strip(),
        [item.model_dump() for item in payload.parts],
    )
    if object_size != int(payload.file_size or 0):
        raise HTTPException(status_code=400, detail="OSS 文件大小校验失败。")

    old_object_key = (video.oss_object_key or "").strip()
    public_base_url = _build_public_base_url(
        video.oss_bucket or settings.oss_bucket,
        video.oss_endpoint or settings.oss_endpoint,
        settings.oss_public_base_url,
    )
    object_url = _build_oss_object_url(public_base_url, payload.oss_object_key.strip())
    video.quiz_version = int(video.quiz_version or 1) + 1

    video.title = payload.title.strip()
    video.description = payload.description.strip()
    video.category = payload.category.strip()
    video.file_name = video.replacement_original_filename or _safe_filename(payload.oss_object_key.strip())
    video.file_path = payload.oss_object_key.strip()
    video.original_filename = video.replacement_original_filename or video.file_name
    video.stored_filename = Path(payload.oss_object_key.strip()).name
    video.storage_type = "oss"
    video.mime_type = video.replacement_mime_type or "video/mp4"
    video.file_size = object_size
    video.duration_seconds = int(payload.duration_seconds or video.replacement_duration_seconds or 0)
    video.duration = int(payload.duration_seconds or video.replacement_duration_seconds or 0)
    video.is_required = payload.is_required
    video.is_newcomer_required = payload.is_newcomer_required
    video.deadline_at = payload.deadline_at
    video.status = payload.status
    video.oss_url = object_url
    video.cdn_url = object_url
    video.play_url = object_url
    video.oss_object_key = payload.oss_object_key.strip()
    video.upload_status = "completed"
    video.upload_error = ""
    video.replacement_upload_id = ""
    video.replacement_object_key = ""
    video.replacement_original_filename = ""
    video.replacement_mime_type = ""
    video.replacement_file_size = 0
    video.replacement_duration_seconds = 0

    await db.execute(sql_delete(MagicVideoTarget).where(MagicVideoTarget.video_id == video_id))
    for target in payload.targets:
        db.add(
            MagicVideoTarget(
                video_id=video.id,
                target_type=target.target_type,
                target_value=target.target_value,
            )
        )

    await db.execute(
        update(MagicVideoProgress)
        .where(MagicVideoProgress.video_id == video_id)
        .values(
            current_position=0,
            max_watched_position=0,
            progress_percent=0,
            is_completed=False,
            completed_at=None,
            last_watched_at=None,
            total_duration=float(video.duration_seconds or 0),
            answered_point_ids_json="[]",
            quiz_passed=False,
            quiz_version=int(video.quiz_version or 1),
            answer_attempt_count=0,
        )
    )

    await db.commit()
    await db.refresh(video)
    if old_object_key and old_object_key != video.oss_object_key:
        try:
            await asyncio.to_thread(_delete_oss_object, old_object_key)
        except Exception:  # noqa: BLE001
            logger.exception("Failed to delete old OSS object after replacement: %s", old_object_key)
    targets_map = await _get_video_targets(db, [video.id])
    return _video_to_dict(video, targets_map.get(video.id, []))


@magic_video_router.post("/videos/{video_id}/replace/fail")
async def fail_magic_video_replace_upload(
    video_id: int,
    payload: MagicVideoReplaceFailPayload,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    del admin
    video = await _get_video_or_404(db, video_id)
    if (video.replacement_object_key or "").strip() != payload.oss_object_key.strip():
        raise HTTPException(status_code=400, detail="替换任务 object_key 不匹配。")
    if (video.replacement_upload_id or "").strip() != payload.upload_id.strip():
        raise HTTPException(status_code=400, detail="替换任务 upload_id 不匹配。")
    try:
        await asyncio.to_thread(_abort_multipart_upload, payload.oss_object_key.strip(), payload.upload_id.strip())
    except Exception:  # noqa: BLE001
        logger.exception("Failed to abort replacement multipart upload for video %s", video_id)
    video.replacement_upload_id = ""
    video.replacement_object_key = ""
    video.replacement_original_filename = ""
    video.replacement_mime_type = ""
    video.replacement_file_size = 0
    video.replacement_duration_seconds = 0
    await db.commit()
    return {
        "video_id": video.id,
        "kept_current_video": True,
        "reason": payload.reason.strip() or "替换上传失败",
    }


@magic_video_router.get("/videos")
async def list_magic_video_uploads(
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> list[dict[str, Any]]:
    del admin
    result = await db.execute(
        select(MagicVideo).where(MagicVideo.deleted_at.is_(None)).order_by(desc(MagicVideo.created_at))
    )
    videos = result.scalars().all()
    targets_map = await _get_video_targets(db, [item.id for item in videos])
    return [_video_to_dict(video, targets_map.get(video.id, [])) for video in videos]


@router.post("/upload/video")
async def upload_video(
    file: UploadFile = File(...),
    duration_seconds: int = Form(default=0),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    del admin
    suffix = Path(file.filename or "").suffix.lower() or ".mp4"
    safe_name = _safe_filename(file.filename or f"video{suffix}")
    stored_name = f"{uuid.uuid4().hex}{suffix}"
    stored_path = VIDEO_DIR / stored_name
    content = await file.read()
    stored_path.write_bytes(content)
    mime_type = file.content_type or mimetypes.guess_type(safe_name)[0] or "video/mp4"
    return {
        "file_name": safe_name,
        "file_path": str(stored_path.relative_to(UPLOAD_ROOT)),
        "mime_type": mime_type,
        "file_size": len(content),
        "duration_seconds": max(int(duration_seconds or 0), 0),
    }


@router.get("/videos")
async def list_videos(
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> list[dict[str, Any]]:
    del admin
    result = await db.execute(
        select(MagicVideo).where(MagicVideo.deleted_at.is_(None)).order_by(desc(MagicVideo.created_at))
    )
    videos = result.scalars().all()
    video_ids = [item.id for item in videos]
    targets_map = await _get_video_targets(db, [item.id for item in videos])
    series_context_map = await _get_series_context_map(db, video_ids)
    watch_confirm_settings = await _get_watch_confirm_settings_map(db, video_ids)
    return [
        _video_to_dict(
            video,
            targets_map.get(video.id, []),
            series_meta=series_context_map.get(video.id),
            watch_confirm_setting=watch_confirm_settings.get(video.id),
        )
        for video in videos
    ]


@router.post("/videos")
async def create_video(
    payload: MagicVideoPayload,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    material_asset: MaterialAsset | None = None
    storage_type = "local"
    file_name = payload.file_name.strip()
    file_path = payload.file_path.strip()
    original_filename = payload.file_name.strip()
    stored_filename = Path(payload.file_path.strip()).name if payload.file_path.strip() else ""
    mime_type = payload.mime_type.strip()
    file_size = int(payload.file_size or 0)
    duration_seconds = int(payload.duration_seconds or 0)
    oss_bucket = ""
    oss_endpoint = ""
    oss_object_key = ""
    oss_url = ""
    cdn_url = ""
    play_url = ""
    material_asset_id = None

    if payload.video_source == "material":
        if not payload.material_asset_id:
            raise HTTPException(status_code=400, detail="请选择素材库视频。")
        material_asset = await _get_material_asset_or_403(
            db,
            payload.material_asset_id,
            admin,
            expected_type="video",
        )
        oss_settings = _ensure_oss_settings()
        public_base_url = _build_public_base_url(
            oss_settings["bucket"],
            oss_settings["endpoint"],
            settings.oss_public_base_url,
        )
        object_url = _build_oss_object_url(public_base_url, material_asset.object_key)
        storage_type = "oss"
        file_name = material_asset.file_name
        file_path = material_asset.object_key
        original_filename = material_asset.file_name
        stored_filename = Path(material_asset.object_key).name
        mime_type = material_asset.mime_type or "video/mp4"
        file_size = int(material_asset.file_size or 0)
        duration_seconds = int(material_asset.duration_seconds or 0)
        oss_bucket = oss_settings["bucket"]
        oss_endpoint = oss_settings["endpoint"]
        oss_object_key = material_asset.object_key
        oss_url = object_url
        cdn_url = object_url
        play_url = object_url
        material_asset_id = int(material_asset.id)
    else:
        if not file_name or not file_path:
            raise HTTPException(status_code=400, detail="请先上传视频文件。")
    video = MagicVideo(
        title=payload.title.strip(),
        description=payload.description.strip(),
        category=payload.category.strip(),
        file_name=file_name,
        file_path=file_path,
        original_filename=original_filename,
        stored_filename=stored_filename,
        storage_type=storage_type,
        oss_bucket=oss_bucket,
        oss_endpoint=oss_endpoint,
        oss_object_key=oss_object_key,
        oss_url=oss_url,
        cdn_url=cdn_url,
        play_url=play_url,
        mime_type=mime_type,
        file_size=file_size,
        duration_seconds=duration_seconds,
        duration=duration_seconds,
        is_required=payload.is_required,
        is_newcomer_required=payload.is_newcomer_required,
        deadline_at=payload.deadline_at,
        status=payload.status,
        upload_status="completed",
        upload_error="",
        transcode_status="none",
        material_asset_id=material_asset_id,
        created_by=admin.id,
    )
    db.add(video)
    await db.flush()
    for target in payload.targets:
        db.add(
            MagicVideoTarget(
                video_id=video.id,
                target_type=target.target_type,
                target_value=target.target_value,
            )
        )
    await db.flush()
    return await _commit_refresh_and_serialize_video(db, video)


@router.get("/videos/{video_id}")
async def get_video(
    video_id: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    del admin
    video = await _get_video_or_404(db, video_id)
    targets_map = await _get_video_targets(db, [video.id])
    series_context_map = await _get_series_context_map(db, [video.id])
    watch_confirm_settings = await _get_watch_confirm_settings_map(db, [video.id])
    return _video_to_dict(
        video,
        targets_map.get(video.id, []),
        series_meta=series_context_map.get(video.id),
        watch_confirm_setting=watch_confirm_settings.get(video.id),
    )


@router.put("/videos/{video_id}")
async def update_video(
    video_id: int,
    payload: MagicVideoPayload,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    video = await _get_video_or_404(db, video_id)
    next_file_name = payload.file_name.strip() or video.file_name
    next_file_path = payload.file_path.strip() or video.file_path
    next_original_filename = next_file_name
    next_stored_filename = Path(next_file_path).name if next_file_path else video.stored_filename
    next_storage_type = video.storage_type or "local"
    next_mime_type = payload.mime_type.strip() or video.mime_type
    next_file_size = int(payload.file_size or video.file_size or 0)
    next_duration_seconds = int(payload.duration_seconds or video.duration_seconds or 0)
    next_duration = int(payload.duration_seconds or video.duration or video.duration_seconds or 0)
    next_oss_bucket = video.oss_bucket or ""
    next_oss_endpoint = video.oss_endpoint or ""
    next_oss_object_key = video.oss_object_key or ""
    next_oss_url = video.oss_url or ""
    next_cdn_url = video.cdn_url or ""
    next_play_url = video.play_url or ""
    next_material_asset_id = video.material_asset_id

    if payload.video_source == "material":
        if not payload.material_asset_id:
            raise HTTPException(status_code=400, detail="请选择素材库视频。")
        material_asset = await _get_material_asset_or_403(
            db,
            payload.material_asset_id,
            admin,
            expected_type="video",
        )
        oss_settings = _ensure_oss_settings()
        public_base_url = _build_public_base_url(
            oss_settings["bucket"],
            oss_settings["endpoint"],
            settings.oss_public_base_url,
        )
        object_url = _build_oss_object_url(public_base_url, material_asset.object_key)
        next_file_name = material_asset.file_name
        next_file_path = material_asset.object_key
        next_original_filename = material_asset.file_name
        next_stored_filename = Path(material_asset.object_key).name
        next_storage_type = "oss"
        next_mime_type = material_asset.mime_type or "video/mp4"
        next_file_size = int(material_asset.file_size or 0)
        next_duration_seconds = int(material_asset.duration_seconds or 0)
        next_duration = next_duration_seconds
        next_oss_bucket = oss_settings["bucket"]
        next_oss_endpoint = oss_settings["endpoint"]
        next_oss_object_key = material_asset.object_key
        next_oss_url = object_url
        next_cdn_url = object_url
        next_play_url = object_url
        next_material_asset_id = int(material_asset.id)

    video.title = payload.title.strip()
    video.description = payload.description.strip()
    video.category = payload.category.strip()
    video.file_name = next_file_name
    video.file_path = next_file_path
    video.original_filename = next_original_filename
    video.stored_filename = next_stored_filename
    video.storage_type = next_storage_type
    video.mime_type = next_mime_type
    video.file_size = next_file_size
    video.duration_seconds = next_duration_seconds
    video.duration = next_duration
    video.oss_bucket = next_oss_bucket
    video.oss_endpoint = next_oss_endpoint
    video.oss_object_key = next_oss_object_key
    video.oss_url = next_oss_url
    video.cdn_url = next_cdn_url
    video.play_url = next_play_url
    video.material_asset_id = next_material_asset_id
    video.is_required = payload.is_required
    video.is_newcomer_required = payload.is_newcomer_required
    video.deadline_at = payload.deadline_at
    if payload.status == "published" and not _is_video_upload_ready(video):
        raise HTTPException(status_code=400, detail="视频尚未上传完成，不能通过编辑直接发布。")
    video.status = payload.status
    await db.execute(sql_delete(MagicVideoTarget).where(MagicVideoTarget.video_id == video_id))
    for target in payload.targets:
        db.add(
            MagicVideoTarget(
                video_id=video.id,
                target_type=target.target_type,
                target_value=target.target_value,
            )
        )
    await db.flush()
    return await _commit_refresh_and_serialize_video(db, video)


@router.delete("/videos/{video_id}")
async def delete_video(
    video_id: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, bool]:
    del admin
    video = await _get_video_or_404(db, video_id)
    current_upload_status = (video.upload_status or "").strip().lower()
    if (video.storage_type or "local").strip().lower() == "oss":
        if current_upload_status in {"pending", "uploading"} and video.upload_id and video.oss_object_key:
            try:
                await asyncio.to_thread(_abort_multipart_upload, video.oss_object_key.strip(), video.upload_id.strip())
            except Exception:  # noqa: BLE001
                logger.exception("Failed to abort OSS multipart upload while deleting video %s", video.id)
        if video.replacement_upload_id and video.replacement_object_key:
            try:
                await asyncio.to_thread(
                    _abort_multipart_upload,
                    video.replacement_object_key.strip(),
                    video.replacement_upload_id.strip(),
                )
            except Exception:  # noqa: BLE001
                logger.exception("Failed to abort replacement multipart upload while deleting video %s", video.id)
        if video.oss_object_key:
            try:
                await asyncio.to_thread(_delete_oss_object, video.oss_object_key.strip())
            except Exception:  # noqa: BLE001
                logger.exception("Failed to delete OSS object while deleting video %s", video.id)
    await db.execute(sql_delete(MagicVideoWhitelist).where(MagicVideoWhitelist.video_id == video_id))
    await db.execute(sql_delete(MagicVideoSeriesItem).where(MagicVideoSeriesItem.video_id == video_id))
    await db.execute(sql_delete(MagicVideoWatchConfirmSetting).where(MagicVideoWatchConfirmSetting.video_id == video_id))
    video.deleted_at = _now()
    video.status = "disabled"
    video.upload_status = "deleted"
    video.upload_id = ""
    video.upload_error = "已删除"
    video.replacement_upload_id = ""
    video.replacement_object_key = ""
    video.replacement_original_filename = ""
    video.replacement_mime_type = ""
    video.replacement_file_size = 0
    video.replacement_duration_seconds = 0
    await db.flush()
    return {"success": True}


@router.post("/videos/{video_id}/publish")
async def publish_video(
    video_id: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    del admin
    video = await _get_video_or_404(db, video_id)
    if not _is_video_upload_ready(video):
        raise HTTPException(status_code=400, detail="视频尚未上传完成，不能发布。")
    video.status = "published"
    return await _commit_refresh_and_serialize_video(db, video)


@router.post("/videos/{video_id}/disable")
async def disable_video(
    video_id: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    del admin
    video = await _get_video_or_404(db, video_id)
    video.status = "disabled"
    return await _commit_refresh_and_serialize_video(db, video)
