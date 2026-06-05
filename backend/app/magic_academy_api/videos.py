from __future__ import annotations

import asyncio
import base64
import math
import mimetypes
import uuid
from contextlib import asynccontextmanager
from io import BytesIO
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlparse

import httpx
from PIL import Image
from fastapi import Depends, File, Form, HTTPException, Query, UploadFile
from sqlalchemy import delete as sql_delete, desc, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import require_admin
from ..db import get_db
from ..magic_auto_actions import enqueue_video_actions_for_video
from ..magic_academy_schemas import (
    MagicVideoPayload,
    MagicVideoCoverGeneratePayload,
    MagicVideoReplaceCompletePayload,
    MagicVideoReplaceFailPayload,
    MagicVideoReplaceInitPayload,
    MagicVideoUploadStatusPayload,
    MagicVideoUploadCompletePayload,
    MagicVideoUploadFailPayload,
    MagicVideoUploadInitPayload,
)
from ..magic_push_service import (
    batch_to_dict,
    entries_to_dicts,
    get_latest_batch,
    get_push_entries,
    run_course_manual_retry,
    schedule_course_initial_push,
    should_trigger_course_initial_push,
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
    _list_uploaded_parts,
    _start_multipart_upload,
    _upload_binary_to_oss,
    _validate_reading_image_payload,
    _validate_video_payload,
    logger,
    settings,
)
from ._resource_cleanup import schedule_oss_object_cleanup
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


def _page_payload(items: list[dict[str, Any]], total: int, page: int, page_size: int) -> dict[str, Any]:
    return {"items": items, "total": int(total), "page": int(page), "page_size": int(page_size)}


UPLOAD_CHUNK_SIZE = 4 * 1024 * 1024
_video_operation_locks: dict[int, asyncio.Lock] = {}


def _get_video_operation_lock(video_id: int) -> asyncio.Lock:
    lock = _video_operation_locks.get(int(video_id))
    if lock is None:
        lock = asyncio.Lock()
        _video_operation_locks[int(video_id)] = lock
    return lock


@asynccontextmanager
async def _video_operation_scope(video_id: int):
    lock = _get_video_operation_lock(video_id)
    async with lock:
        yield


async def _commit_refresh_and_serialize_video(
    db: AsyncSession,
    video: MagicVideo,
) -> dict[str, Any]:
    """Persist DB-side defaults/onupdate columns before serializing the ORM row."""
    await db.commit()
    await db.refresh(video)
    targets_map = await _get_video_targets(db, [video.id])
    return _video_to_dict(video, targets_map.get(video.id, []))


async def _refresh_and_serialize_video(
    db: AsyncSession,
    video: MagicVideo,
) -> dict[str, Any]:
    await db.refresh(video)
    targets_map = await _get_video_targets(db, [video.id])
    return _video_to_dict(video, targets_map.get(video.id, []))


async def _resolve_cover_url(
    db: AsyncSession,
    admin: User,
    *,
    cover_asset_id: int | None,
    cover_url: str,
) -> tuple[int | None, str]:
    resolved_cover_url = (cover_url or "").strip()
    resolved_cover_asset_id = int(cover_asset_id) if cover_asset_id else None
    if not resolved_cover_asset_id:
        return None, resolved_cover_url
    cover_asset = await _get_material_asset_or_403(
        db,
        resolved_cover_asset_id,
        admin,
        expected_type="image",
    )
    oss_settings = _ensure_oss_settings()
    public_base_url = _build_public_base_url(
        oss_settings["bucket"],
        oss_settings["endpoint"],
        settings.oss_public_base_url,
    )
    return resolved_cover_asset_id, _build_oss_object_url(public_base_url, cover_asset.object_key)


def _extract_oss_object_key_from_url(url: str) -> str:
    text = (url or "").strip()
    if not text:
        return ""
    try:
        parsed = urlparse(text)
    except ValueError:
        return ""
    path = unquote((parsed.path or "").lstrip("/"))
    return path.strip()


async def _should_delete_video_object(db: AsyncSession, video: MagicVideo) -> bool:
    if not (video.oss_object_key or "").strip():
        return False
    if video.material_asset_id:
        asset = await db.get(MaterialAsset, int(video.material_asset_id))
        if asset and not bool(asset.is_deleted) and (asset.object_key or "").strip() == (video.oss_object_key or "").strip():
            return False
    return True


async def _resolve_video_cover_cleanup_key(db: AsyncSession, video: MagicVideo) -> str:
    cover_url = (video.cover_url or "").strip()
    if not cover_url or video.cover_asset_id:
        return ""
    cover_object_key = _extract_oss_object_key_from_url(cover_url)
    if not cover_object_key:
        return ""
    if video.material_asset_id:
        asset = await db.get(MaterialAsset, int(video.material_asset_id))
        if asset and not bool(asset.is_deleted) and (asset.cover_url or "").strip() == cover_url:
            return ""
    return cover_object_key


async def _enqueue_video_auto_actions_if_published(
    db: AsyncSession,
    video: MagicVideo,
    *,
    created_by: int | None,
) -> None:
    if (video.status or "").strip().lower() != "published":
        return
    targets_map = await _get_video_targets(db, [video.id])
    await enqueue_video_actions_for_video(
        db,
        video,
        targets_map.get(video.id, []),
        created_by=created_by,
    )


async def _write_upload_to_disk(file: UploadFile, stored_path: Path, max_size: int) -> int:
    total_size = 0
    try:
        with stored_path.open("wb") as output:
            while True:
                chunk = await file.read(UPLOAD_CHUNK_SIZE)
                if not chunk:
                    break
                total_size += len(chunk)
                if max_size > 0 and total_size > max_size:
                    raise HTTPException(status_code=400, detail="视频大小超过限制。")
                await asyncio.to_thread(output.write, chunk)
    except Exception:
        stored_path.unlink(missing_ok=True)
        raise
    return total_size


@router.post("/upload/video-cover")
async def upload_magic_video_cover(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    del db, admin
    file_name = (file.filename or "cover").strip() or "cover"
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


def _build_video_cover_prompt(payload: MagicVideoCoverGeneratePayload) -> str:
    style_prompt_map = {
        "企业培训": "画面偏企业培训与组织学习氛围，可信、克制、正式，适合内部课程封面。",
        "简洁商务": "画面偏商务简洁风，留白清晰，排版感强，色彩控制干净利落。",
        "科技蓝调": "画面偏科技蓝调与数字化质感，可使用冷色、光效与轻微未来感，但不要过于炫技。",
        "海报感封面": "画面具有宣传海报感和视觉冲击力，主体突出，层次清楚，适合做课程封面头图。",
    }
    parts = [
        "为企业培训或课程后台生成一张 16:9 视频封面。",
        "整体风格专业、简洁、现代，适合课程管理后台列表展示。",
        "保留参考图的主体构图与核心视觉元素，但提升完成度与封面感。",
        "不要二维码，不要水印，不要密集小字，不要拉伸变形。",
    ]
    if payload.title.strip():
        parts.append(f"标题主题：{payload.title.strip()}")
    if payload.category.strip():
        parts.append(f"课程分类：{payload.category.strip()}")
    if payload.description.strip():
        parts.append(f"补充说明：{payload.description.strip()}")
    if payload.style_preset.strip():
        parts.append(f"风格名称：{payload.style_preset.strip()}")
        mapped_style_prompt = style_prompt_map.get(payload.style_preset.strip())
        if mapped_style_prompt:
            parts.append(mapped_style_prompt)
    if payload.prompt.strip():
        parts.append(f"额外要求：{payload.prompt.strip()}")
    return "\n".join(parts)


def _ceil_to_multiple(value: int, base: int) -> int:
    safe_value = max(int(value), 1)
    return max(base, ((safe_value + base - 1) // base) * base)


def _normalize_video_cover_generation_size(reference_size: tuple[int, int]) -> tuple[int, int]:
    """Normalize arbitrary reference image sizes to values accepted by the upstream image API.

    The upstream `/images/edits` endpoint rejects many raw image sizes from the UI:
    width/height must be divisible by 16, and low-resolution sizes can be rejected for
    being below the minimum pixel budget. We therefore upscale while preserving aspect
    ratio, then round both edges up to multiples of 16. The returned image is still
    resized back to the original reference size later in the pipeline.
    """

    width, height = (int(reference_size[0]), int(reference_size[1]))
    if width <= 0 or height <= 0:
        return (1536, 864)

    min_area = 1024 * 1024 if width == height else 1536 * 864
    current_area = width * height
    scale = max(1.0, math.sqrt(min_area / float(current_area))) if current_area > 0 else 1.0
    normalized_width = _ceil_to_multiple(math.ceil(width * scale), 16)
    normalized_height = _ceil_to_multiple(math.ceil(height * scale), 16)
    return normalized_width, normalized_height


@router.post("/admin/video-cover/generate")
async def generate_magic_video_cover(
    title: str = Form(""),
    description: str = Form(""),
    category: str = Form(""),
    style_preset: str = Form(""),
    prompt: str = Form(""),
    reference_image: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    del db, admin
    if not settings.llm_api_key:
        raise HTTPException(status_code=500, detail="未配置 LLM_API_KEY，无法使用 AI 生图。")

    payload = MagicVideoCoverGeneratePayload(
        title=title,
        description=description,
        category=category,
        style_preset=style_preset,
        prompt=prompt,
    )
    file_name = (reference_image.filename or "reference").strip() or "reference"
    mime_type = (reference_image.content_type or "").strip() or mimetypes.guess_type(file_name)[0] or "image/png"
    reference_raw = await reference_image.read()
    _validate_reading_image_payload(file_name, len(reference_raw), mime_type)
    try:
        with Image.open(BytesIO(reference_raw)) as reference_pil:
            reference_size = tuple(int(v) for v in reference_pil.size)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail="参考封面图片解析失败。") from exc
    if len(reference_size) != 2 or reference_size[0] <= 0 or reference_size[1] <= 0:
        raise HTTPException(status_code=400, detail="参考封面图片尺寸无效。")
    final_prompt = _build_video_cover_prompt(payload)
    generated_size = _normalize_video_cover_generation_size(reference_size)
    endpoint = f"{settings.llm_base_url.rstrip('/')}/images/edits"
    data = {
        "model": settings.image_gen_model,
        "prompt": final_prompt,
        "size": f"{generated_size[0]}x{generated_size[1]}",
        "quality": settings.image_gen_quality,
        "n": "1",
    }
    files = {
        "image": (file_name, reference_raw, mime_type),
    }

    try:
        async with httpx.AsyncClient(timeout=max(int(settings.image_gen_timeout_seconds or 180), 30)) as client:
            response = await client.post(
                endpoint,
                headers={"Authorization": f"Bearer {settings.llm_api_key}"},
                data=data,
                files=files,
            )
    except httpx.RequestError as exc:
        raise HTTPException(status_code=502, detail="无法连接 AI 生图服务，请稍后重试。") from exc

    detail = ""
    try:
        payload_json = response.json()
    except ValueError:
        payload_json = None
        detail = (response.text or "").strip()
    else:
        detail = str(payload_json.get("error", {}).get("message") or payload_json.get("detail") or "").strip()
    if response.status_code >= 400:
        if response.status_code in {400, 422}:
            raise HTTPException(
                status_code=400,
                detail=detail or "AI 生图请求参数不合法，请更换参考图或调整配置后重试。",
            )
        raise HTTPException(status_code=502, detail=detail or "AI 生图失败，请检查模型配置或稍后重试。")

    items = payload_json.get("data") if isinstance(payload_json, dict) else None
    if not isinstance(items, list) or not items:
        raise HTTPException(status_code=502, detail="AI 生图未返回有效图片。")
    first = items[0] if isinstance(items[0], dict) else {}
    revised_prompt = str(first.get("revised_prompt") or final_prompt).strip()
    generated_url = str(first.get("url") or "").strip()
    generated_b64 = str(first.get("b64_json") or "").strip()
    if generated_url:
        try:
            async with httpx.AsyncClient(timeout=max(int(settings.image_gen_timeout_seconds or 180), 30)) as client:
                image_response = await client.get(generated_url)
                image_response.raise_for_status()
        except httpx.HTTPError as exc:
            raise HTTPException(status_code=502, detail="AI 图片下载失败，请稍后重试。") from exc
        generated_raw = image_response.content
        output_mime_type = (image_response.headers.get("content-type") or "").split(";", 1)[0].strip() or "image/png"
    elif generated_b64:
        try:
            generated_raw = base64.b64decode(generated_b64)
        except ValueError as exc:
            raise HTTPException(status_code=502, detail="AI 生图结果解析失败。") from exc
        output_mime_type = "image/png"
    else:
        raise HTTPException(status_code=502, detail="AI 生图未返回可用图片。")
    try:
        with Image.open(BytesIO(generated_raw)) as generated_pil:
            current_size = tuple(int(v) for v in generated_pil.size)
            if current_size != reference_size:
                output_format = generated_pil.format or "PNG"
                resized = generated_pil.convert("RGBA" if output_format.upper() == "PNG" else "RGB")
                resized = resized.resize(reference_size, Image.LANCZOS)
                buffer = BytesIO()
                save_kwargs = {}
                if output_format.upper() in {"JPEG", "JPG"} and resized.mode == "RGBA":
                    resized = resized.convert("RGB")
                if output_format.upper() == "PNG":
                    save_kwargs["optimize"] = True
                resized.save(buffer, format=output_format, **save_kwargs)
                generated_raw = buffer.getvalue()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail="AI 生图结果处理失败。") from exc

    output_extension = _validate_reading_image_payload("ai-cover.png", len(generated_raw), output_mime_type)
    object_key, _stored_name = _build_object_key_and_name("ai-cover" + output_extension, output_extension)
    await asyncio.to_thread(_upload_binary_to_oss, object_key, generated_raw, output_mime_type)
    oss_settings = _ensure_oss_settings()
    return {
        "object_key": object_key,
        "url": _build_oss_object_url(oss_settings["public_base_url"], object_key),
        "mime_type": output_mime_type,
        "file_name": file_name,
        "file_size": len(generated_raw),
        "model": settings.image_gen_model,
        "prompt": final_prompt,
        "revised_prompt": revised_prompt,
    }


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
    _cover_asset_id, resolved_cover_url = await _resolve_cover_url(
        db,
        admin,
        cover_asset_id=payload.cover_asset_id,
        cover_url=payload.cover_url,
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
        cover_url=resolved_cover_url or None,
        cover_asset_id=_cover_asset_id,
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
    async with _video_operation_scope(payload.video_id):
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
    async with _video_operation_scope(payload.video_id):
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


@magic_video_router.post("/videos/upload/status")
async def get_magic_video_upload_status(
    payload: MagicVideoUploadStatusPayload,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    del admin
    video = await _get_video_or_404(db, payload.video_id)
    if (video.oss_object_key or "").strip() != payload.oss_object_key.strip():
        raise HTTPException(status_code=400, detail="oss_object_key 与上传任务不匹配。")
    if (video.upload_id or "").strip() != payload.upload_id.strip():
        raise HTTPException(status_code=400, detail="upload_id 与上传任务不匹配。")
    uploaded_parts = await asyncio.to_thread(
        _list_uploaded_parts,
        payload.oss_object_key.strip(),
        payload.upload_id.strip(),
    )
    return {
        "video_id": int(video.id),
        "upload_status": (video.upload_status or "").strip().lower(),
        "oss_object_key": payload.oss_object_key.strip(),
        "upload_id": payload.upload_id.strip(),
        "uploaded_parts": [
            {"part_number": int(part_number), "etag": etag}
            for part_number, etag in sorted(uploaded_parts.items())
        ],
    }


@magic_video_router.post("/videos/{video_id}/replace/init")
async def init_magic_video_replace_upload(
    video_id: int,
    payload: MagicVideoReplaceInitPayload,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    del admin
    async with _video_operation_scope(video_id):
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
    async with _video_operation_scope(video_id):
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
        should_delete_old_object = await _should_delete_video_object(db, video)
        old_cover_cleanup_key = await _resolve_video_cover_cleanup_key(db, video)
        old_cover_url = (video.cover_url or "").strip()
        public_base_url = _build_public_base_url(
            video.oss_bucket or settings.oss_bucket,
            video.oss_endpoint or settings.oss_endpoint,
            settings.oss_public_base_url,
        )
        object_url = _build_oss_object_url(public_base_url, payload.oss_object_key.strip())
        _cover_asset_id, resolved_cover_url = await _resolve_cover_url(
            db,
            admin,
            cover_asset_id=payload.cover_asset_id,
            cover_url=payload.cover_url,
        )
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
        video.cover_url = resolved_cover_url or None
        video.cover_asset_id = _cover_asset_id
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
        schedule_oss_object_cleanup(
            [
                old_object_key if should_delete_old_object and old_object_key != (video.oss_object_key or "").strip() else "",
                old_cover_cleanup_key if old_cover_url != (video.cover_url or "").strip() else "",
            ],
            logger=logger,
        )
        return await _refresh_and_serialize_video(db, video)


@magic_video_router.post("/videos/{video_id}/replace/fail")
async def fail_magic_video_replace_upload(
    video_id: int,
    payload: MagicVideoReplaceFailPayload,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    del admin
    async with _video_operation_scope(video_id):
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


@magic_video_router.post("/videos/{video_id}/replace/status")
async def get_magic_video_replace_upload_status(
    video_id: int,
    payload: MagicVideoUploadStatusPayload,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    del admin
    if int(payload.video_id) != int(video_id):
        raise HTTPException(status_code=400, detail="video_id 与路径不匹配。")
    video = await _get_video_or_404(db, video_id)
    if (video.replacement_object_key or "").strip() != payload.oss_object_key.strip():
        raise HTTPException(status_code=400, detail="替换任务 object_key 不匹配。")
    if (video.replacement_upload_id or "").strip() != payload.upload_id.strip():
        raise HTTPException(status_code=400, detail="替换任务 upload_id 不匹配。")
    uploaded_parts = await asyncio.to_thread(
        _list_uploaded_parts,
        payload.oss_object_key.strip(),
        payload.upload_id.strip(),
    )
    return {
        "video_id": int(video.id),
        "upload_status": "uploading" if (video.replacement_upload_id or "").strip() else "idle",
        "oss_object_key": payload.oss_object_key.strip(),
        "upload_id": payload.upload_id.strip(),
        "uploaded_parts": [
            {"part_number": int(part_number), "etag": etag}
            for part_number, etag in sorted(uploaded_parts.items())
        ],
    }


@magic_video_router.get("/videos")
async def list_magic_video_uploads(
    page: int | None = Query(None, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> list[dict[str, Any]] | dict[str, Any]:
    del admin
    stmt = select(MagicVideo).where(MagicVideo.deleted_at.is_(None)).order_by(desc(MagicVideo.created_at))
    total = 0
    if page is not None:
        total = int(
            (await db.execute(select(func.count()).select_from(MagicVideo).where(MagicVideo.deleted_at.is_(None)))).scalar_one()
            or 0
        )
        stmt = stmt.limit(page_size).offset((page - 1) * page_size)
    result = await db.execute(stmt)
    videos = result.scalars().all()
    targets_map = await _get_video_targets(db, [item.id for item in videos])
    items = [_video_to_dict(video, targets_map.get(video.id, [])) for video in videos]
    if page is None:
        return items
    return _page_payload(items, total, page, page_size)


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
    max_size = int(settings.magic_video_max_size_mb or 10240) * 1024 * 1024
    file_size = await _write_upload_to_disk(file, stored_path, max_size)
    if file_size <= 0:
        stored_path.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail="视频内容不能为空。")
    mime_type = file.content_type or mimetypes.guess_type(safe_name)[0] or "video/mp4"
    return {
        "file_name": safe_name,
        "file_path": str(stored_path.relative_to(UPLOAD_ROOT)),
        "mime_type": mime_type,
        "file_size": file_size,
        "duration_seconds": max(int(duration_seconds or 0), 0),
    }


@router.get("/videos")
async def list_videos(
    page: int | None = Query(None, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> list[dict[str, Any]] | dict[str, Any]:
    del admin
    stmt = select(MagicVideo).where(MagicVideo.deleted_at.is_(None)).order_by(desc(MagicVideo.created_at))
    total = 0
    if page is not None:
        total = int(
            (await db.execute(select(func.count()).select_from(MagicVideo).where(MagicVideo.deleted_at.is_(None)))).scalar_one()
            or 0
        )
        stmt = stmt.limit(page_size).offset((page - 1) * page_size)
    result = await db.execute(stmt)
    videos = result.scalars().all()
    video_ids = [item.id for item in videos]
    targets_map = await _get_video_targets(db, [item.id for item in videos])
    series_context_map = await _get_series_context_map(db, video_ids)
    watch_confirm_settings = await _get_watch_confirm_settings_map(db, video_ids)
    items = [
        _video_to_dict(
            video,
            targets_map.get(video.id, []),
            series_meta=series_context_map.get(video.id),
            watch_confirm_setting=watch_confirm_settings.get(video.id),
        )
        for video in videos
    ]
    if page is None:
        return items
    return _page_payload(items, total, page, page_size)


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
    _cover_asset_id, resolved_cover_url = await _resolve_cover_url(
        db,
        admin,
        cover_asset_id=payload.cover_asset_id,
        cover_url=payload.cover_url,
    )
    if payload.video_source == "material" and material_asset and not resolved_cover_url:
        resolved_cover_url = (material_asset.cover_url or "").strip()
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
        cover_url=resolved_cover_url or None,
        cover_asset_id=_cover_asset_id,
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
    await _enqueue_video_auto_actions_if_published(db, video, created_by=admin.id)
    response = await _commit_refresh_and_serialize_video(db, video)
    if should_trigger_course_initial_push(old_status="draft", new_status=video.status):
        schedule_course_initial_push(video_id=int(video.id), created_by=int(admin.id))
    return response


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


@router.get("/videos/{video_id}/push-summary")
async def get_video_push_summary(
    video_id: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    del admin
    await _get_video_or_404(db, video_id)
    batch = await get_latest_batch(db, content_type="course", content_id=video_id)
    return {"item": batch_to_dict(batch)}


@router.get("/videos/{video_id}/push-entries")
async def get_video_push_entries(
    video_id: int,
    batch_id: int | None = Query(None, ge=1),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    del admin
    await _get_video_or_404(db, video_id)
    entries = await get_push_entries(db, content_type="course", content_id=video_id, batch_id=batch_id)
    return {"items": await entries_to_dicts(db, entries)}


@router.post("/videos/{video_id}/push-retry")
async def retry_video_push(
    video_id: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    await _get_video_or_404(db, video_id)
    return await run_course_manual_retry(db, video_id=video_id, created_by=int(admin.id))


@router.put("/videos/{video_id}")
async def update_video(
    video_id: int,
    payload: MagicVideoPayload,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    async with _video_operation_scope(video_id):
        video = await _get_video_or_404(db, video_id)
        old_status = (video.status or "draft").strip().lower()
        old_cover_cleanup_key = await _resolve_video_cover_cleanup_key(db, video)
        old_cover_url = (video.cover_url or "").strip()
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
        _cover_asset_id, resolved_cover_url = await _resolve_cover_url(
            db,
            admin,
            cover_asset_id=payload.cover_asset_id,
            cover_url=payload.cover_url,
        )
        if payload.video_source == "material" and 'material_asset' in locals() and material_asset and not resolved_cover_url:
            resolved_cover_url = (material_asset.cover_url or "").strip()

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
        video.cover_url = resolved_cover_url or None
        video.cover_asset_id = _cover_asset_id
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
        await _enqueue_video_auto_actions_if_published(db, video, created_by=admin.id)
        await db.commit()
        schedule_oss_object_cleanup(
            [old_cover_cleanup_key if old_cover_url != (video.cover_url or "").strip() else ""],
            logger=logger,
        )
        response = await _refresh_and_serialize_video(db, video)
        if should_trigger_course_initial_push(old_status=old_status, new_status=video.status):
            schedule_course_initial_push(video_id=int(video.id), created_by=int(admin.id))
        return response


@router.delete("/videos/{video_id}")
async def delete_video(
    video_id: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, bool]:
    del admin
    async with _video_operation_scope(video_id):
        video = await _get_video_or_404(db, video_id)
        current_upload_status = (video.upload_status or "").strip().lower()
        should_delete_video_object = await _should_delete_video_object(db, video)
        cover_cleanup_key = await _resolve_video_cover_cleanup_key(db, video)
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
        await db.commit()
        schedule_oss_object_cleanup(
            [
                video.oss_object_key if should_delete_video_object else "",
                cover_cleanup_key,
            ],
            logger=logger,
        )
        return {"success": True}


@router.post("/videos/batch-delete")
async def batch_delete_videos(
    payload: dict[str, Any],
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    raw_ids = payload.get("ids") or []
    ids = sorted({int(item) for item in raw_ids if str(item).isdigit() and int(item) > 0})
    if not ids:
        raise HTTPException(status_code=400, detail="请选择至少一个视频。")
    deleted_ids: list[int] = []
    skipped: list[dict[str, Any]] = []
    for video_id in ids:
        try:
            await delete_video(video_id, db=db, admin=admin)
            deleted_ids.append(video_id)
        except HTTPException as exc:
            skipped.append({"id": video_id, "reason": str(exc.detail)})
    return {"success": True, "deleted_ids": deleted_ids, "skipped": skipped}


@router.post("/videos/{video_id}/publish")
async def publish_video(
    video_id: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    video = await _get_video_or_404(db, video_id)
    old_status = (video.status or "draft").strip().lower()
    if not _is_video_upload_ready(video):
        raise HTTPException(status_code=400, detail="视频尚未上传完成，不能发布。")
    video.status = "published"
    await _enqueue_video_auto_actions_if_published(db, video, created_by=admin.id)
    response = await _commit_refresh_and_serialize_video(db, video)
    if should_trigger_course_initial_push(old_status=old_status, new_status=video.status):
        schedule_course_initial_push(video_id=int(video.id), created_by=int(admin.id))
    return response


@router.post("/videos/batch-publish")
async def batch_publish_videos(
    payload: dict[str, Any],
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    raw_ids = payload.get("ids") or []
    ids = sorted({int(item) for item in raw_ids if str(item).isdigit() and int(item) > 0})
    if not ids:
        raise HTTPException(status_code=400, detail="请选择至少一个视频。")
    updated_ids: list[int] = []
    skipped: list[dict[str, Any]] = []
    for video_id in ids:
        try:
            await publish_video(video_id, db=db, admin=admin)
            updated_ids.append(video_id)
        except HTTPException as exc:
            skipped.append({"id": video_id, "reason": str(exc.detail)})
    return {"success": True, "updated_ids": updated_ids, "skipped": skipped}


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


@router.post("/videos/batch-disable")
async def batch_disable_videos(
    payload: dict[str, Any],
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    raw_ids = payload.get("ids") or []
    ids = sorted({int(item) for item in raw_ids if str(item).isdigit() and int(item) > 0})
    if not ids:
        raise HTTPException(status_code=400, detail="请选择至少一个视频。")
    updated_ids: list[int] = []
    skipped: list[dict[str, Any]] = []
    for video_id in ids:
        try:
            await disable_video(video_id, db=db, admin=admin)
            updated_ids.append(video_id)
        except HTTPException as exc:
            skipped.append({"id": video_id, "reason": str(exc.detail)})
    return {"success": True, "updated_ids": updated_ids, "skipped": skipped}
