from __future__ import annotations

import asyncio
import hashlib
import mimetypes
import re
import secrets
from datetime import datetime, timedelta
from typing import Any
from urllib.parse import quote, urlencode

import oss2
from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import RedirectResponse, Response, StreamingResponse
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import and_, desc, func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from .auth import require_admin
from .db import get_db
from .magic_academy_api._oss import (
    MULTIPART_URL_EXPIRE_SECONDS,
    _abort_multipart_upload,
    _build_object_key_and_name,
    _build_oss_bucket,
    _build_oss_object_url,
    _build_public_base_url,
    _build_signed_stream_url,
    _complete_multipart_upload,
    _ensure_oss_settings,
    _start_multipart_upload,
    _upload_binary_to_oss,
    _validate_reading_image_payload,
    _validate_video_payload,
    ensure_mp4_faststart,
    logger,
    settings,
)
from .magic_academy_api._resource_cleanup import schedule_oss_object_cleanup
from .magic_academy_api._utils import _iso, _now, _safe_filename
from .magic_academy_api._video_helpers import _get_material_asset_or_403
from .live_status import LIVE_STATUSES, PUBLIC_STATUSES, default_publish_status, resolve_live_status, status_label
from .models import LiveCommentSetting, LiveCommentToggleLog, LiveInteraction, LiveRoom, User
from .wechat_client import WechatApiError, WechatMpClient
from .wecom_client import WecomApiError, WecomClient

admin_router = APIRouter(prefix="/api/admin/live", tags=["live-admin"])
public_router = APIRouter(prefix="/api/public/live", tags=["live-public"])
_wecom_client = WecomClient()
_wechat_mp_client = WechatMpClient()

CONTENT_TYPES = {"recorded", "live_stream"}
VIDEO_SOURCES = {"upload", "material", "external_url"}
COMMENT_STATUSES = {"visible", "hidden", "deleted"}
COMMENT_RATE_LIMIT_SECONDS = 5
SHARE_RATE_LIMIT_SECONDS = 3
COMMENT_SETTINGS_ID = 1
RANGE_RE = re.compile(r"^bytes=(\d*)-(\d*)$", re.IGNORECASE)
STREAM_CHUNK_SIZE = 256 * 1024


class LiveUploadPart(BaseModel):
    part_number: int = Field(..., ge=1)
    etag: str = Field(..., min_length=1, max_length=255)


class LiveVideoUploadInitPayload(BaseModel):
    file_name: str = Field(..., min_length=1, max_length=255)
    file_size: int = Field(..., gt=0)
    mime_type: str = Field(default="video/mp4", max_length=128)


class LiveVideoUploadCompletePayload(BaseModel):
    object_key: str = Field(..., min_length=1, max_length=1024)
    upload_id: str = Field(..., min_length=1, max_length=255)
    file_name: str = Field(..., min_length=1, max_length=255)
    file_size: int = Field(..., gt=0)
    mime_type: str = Field(default="video/mp4", max_length=128)
    duration_seconds: int = Field(default=0, ge=0)
    parts: list[LiveUploadPart] = Field(default_factory=list)


class LiveVideoUploadFailPayload(BaseModel):
    object_key: str = Field(..., min_length=1, max_length=1024)
    upload_id: str = Field(..., min_length=1, max_length=255)


class LiveRoomPayload(BaseModel):
    title: str = Field(..., min_length=1, max_length=100)
    lecturer: str = Field(default="", max_length=50)
    intro: str = Field(default="", max_length=200)
    detail_html: str = Field(default="", max_length=20000)
    content_type: str = "recorded"
    video_source: str = "upload"
    video_material_asset_id: int | None = Field(default=None, ge=1)
    video_object_key: str = Field(default="", max_length=1024)
    video_url: str = Field(default="", max_length=2048)
    video_mime_type: str = Field(default="video/mp4", max_length=128)
    video_file_name: str = Field(default="", max_length=255)
    video_file_size: int = Field(default=0, ge=0)
    duration_seconds: int = Field(default=0, ge=0)
    stream_url: str = Field(default="", max_length=2048)
    cover_url: str = Field(default="", max_length=2048)
    cover_object_key: str = Field(default="", max_length=1024)
    cover_material_asset_id: int | None = Field(default=None, ge=1)
    share_title: str = Field(default="", max_length=100)
    share_desc: str = Field(default="", max_length=200)
    share_image_url: str = Field(default="", max_length=2048)
    share_image_object_key: str = Field(default="", max_length=1024)
    share_image_material_asset_id: int | None = Field(default=None, ge=1)
    start_time: str | None = None
    duration_minutes: int | None = Field(default=None, ge=1, le=24 * 60)
    status: str = "draft"
    allow_like: bool = True
    allow_comment: bool = True
    show_counters: bool = True

    @field_validator("content_type")
    @classmethod
    def _content_type(cls, value: str) -> str:
        text = (value or "recorded").strip().lower()
        if text not in CONTENT_TYPES:
            raise ValueError("不支持的内容类型。")
        return text

    @field_validator("video_source")
    @classmethod
    def _video_source(cls, value: str) -> str:
        text = (value or "upload").strip().lower()
        if text not in VIDEO_SOURCES:
            raise ValueError("不支持的视频来源。")
        return text

    @field_validator("status")
    @classmethod
    def _status(cls, value: str) -> str:
        text = (value or "draft").strip().lower()
        if text not in LIVE_STATUSES:
            raise ValueError("不支持的直播状态。")
        return text


class LiveInteractionPayload(BaseModel):
    visitor_id: str = Field(default="", max_length=128)
    nickname: str = Field(default="", max_length=60)
    content: str = Field(default="", max_length=500)


class LiveCommentTogglePayload(BaseModel):
    allow_comment: bool = True


class LiveCommentSettingsPayload(BaseModel):
    block_words: str = Field(default="", max_length=4000)


class LiveCommentBatchPayload(BaseModel):
    ids: list[int] = Field(..., min_length=1, max_length=200)
    action: str = Field(..., max_length=16)

    @field_validator("action")
    @classmethod
    def _action(cls, value: str) -> str:
        action = (value or "").strip().lower()
        if action not in {"hide", "restore", "delete"}:
            raise ValueError("不支持的批量操作。")
        return action


def _page_payload(items: list[dict[str, Any]], total: int, page: int, page_size: int) -> dict[str, Any]:
    return {"items": items, "total": int(total), "page": int(page), "page_size": int(page_size)}


def _parse_datetime(value: str | None):
    text = (value or "").strip()
    if not text:
        return None
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="开始时间格式不正确。") from exc


def _public_base_url() -> str:
    oss_settings = _ensure_oss_settings()
    return _build_public_base_url(
        oss_settings["bucket"],
        oss_settings["endpoint"],
        settings.oss_public_base_url,
    )


def _object_public_url(object_key: str) -> str:
    key = (object_key or "").strip()
    if not key:
        return ""
    return _build_oss_object_url(_public_base_url(), key)


def _build_public_live_url(request: Request, slug: str) -> str:
    configured_base = settings.resolved_wecom_frontend_base_url
    base = (configured_base or str(request.base_url)).rstrip("/")
    return f"{base}/live/{quote(slug, safe='')}"


def _build_public_live_share_url(request: Request, slug: str) -> str:
    configured_base = settings.resolved_wecom_frontend_base_url
    base = (configured_base or str(request.base_url)).rstrip("/")
    return f"{base}/share/live/{quote(slug, safe='')}"


def _build_public_live_stream_url(
    request: Request,
    slug: str,
    *,
    preview: bool = False,
    proxy: bool = False,
) -> str:
    del request
    params: dict[str, str] = {}
    if preview:
        params["preview"] = "1"
    if proxy:
        params["proxy"] = "1"
    query = f"?{urlencode(params)}" if params else ""
    return f"/api/public/live/{quote(slug, safe='')}/stream{query}"


def _parse_single_range(range_header: str, total_size: int) -> tuple[int, int] | None:
    if total_size <= 0:
        return None
    match = RANGE_RE.match((range_header or "").strip())
    if not match:
        return None
    start_text, end_text = match.groups()
    if not start_text and not end_text:
        return None
    if start_text:
        start = int(start_text)
        end = int(end_text) if end_text else total_size - 1
    else:
        suffix_length = int(end_text)
        if suffix_length <= 0:
            return None
        start = max(total_size - suffix_length, 0)
        end = total_size - 1
    if start >= total_size or start > end:
        return None
    return start, min(end, total_size - 1)


def _stream_chunks(stream, chunk_size: int = STREAM_CHUNK_SIZE):
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


def _content_disposition_inline(file_name: str | None) -> str:
    name = (file_name or "").strip()
    if not name:
        return "inline"
    try:
        ascii_name = name.encode("ascii").decode("ascii")
        return f'inline; filename="{ascii_name}"'
    except UnicodeEncodeError:
        return f"inline; filename*=UTF-8''{quote(name)}"


async def _proxy_oss_video_response(
    request: Request,
    *,
    object_key: str,
    mime_type: str,
    file_name: str,
    head_only: bool = False,
) -> Response | StreamingResponse:
    bucket = await asyncio.to_thread(_build_oss_bucket)
    try:
        head = await asyncio.to_thread(bucket.head_object, object_key)
    except oss2.exceptions.NoSuchKey as exc:
        raise HTTPException(status_code=404, detail="Video file is not available.") from exc
    except oss2.exceptions.OssError as exc:
        raise HTTPException(status_code=502, detail=f"Video file read failed: {exc}") from exc

    total_size = int(getattr(head, "content_length", None) or 0)
    guessed_mime = mimetypes.guess_type(file_name or object_key)[0] or ""
    stored_mime = (mime_type or "").strip().lower()
    head_mime = (getattr(head, "content_type", None) or "").strip().lower()
    resolved_mime = (
        guessed_mime
        or (stored_mime if stored_mime and stored_mime != "application/octet-stream" else "")
        or (head_mime if head_mime and head_mime != "application/octet-stream" else "")
        or "video/mp4"
    )
    range_header = (request.headers.get("range") or "").strip()
    byte_range: tuple[int, int] | None = None
    status_code = 200
    content_length = total_size
    headers = {
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, max-age=300",
        "Content-Disposition": _content_disposition_inline(file_name),
    }

    if range_header:
        parsed = _parse_single_range(range_header, total_size)
        if parsed is None:
            return Response(
                status_code=416,
                headers={
                    "Accept-Ranges": "bytes",
                    "Content-Range": f"bytes */{total_size}",
                },
            )
        start, end = parsed
        byte_range = (start, end)
        status_code = 206
        content_length = end - start + 1
        headers["Content-Range"] = f"bytes {start}-{end}/{total_size}"
    if content_length:
        headers["Content-Length"] = str(content_length)

    if head_only:
        return Response(status_code=status_code, media_type=resolved_mime, headers=headers)

    try:
        oss_object = await asyncio.to_thread(bucket.get_object, object_key, byte_range=byte_range)
    except oss2.exceptions.NoSuchKey as exc:
        raise HTTPException(status_code=404, detail="Video file is not available.") from exc
    except oss2.exceptions.OssError as exc:
        raise HTTPException(status_code=502, detail=f"Video file read failed: {exc}") from exc

    return StreamingResponse(
        _stream_chunks(oss_object),
        status_code=status_code,
        media_type=resolved_mime,
        headers=headers,
    )


def _make_slug() -> str:
    return secrets.token_urlsafe(8).replace("-", "").replace("_", "")[:11]


async def _unique_slug(db: AsyncSession) -> str:
    for _ in range(10):
        slug = _make_slug()
        exists = (
            await db.execute(select(LiveRoom.id).where(LiveRoom.slug == slug))
        ).scalar_one_or_none()
        if not exists:
            return slug
    raise HTTPException(status_code=500, detail="生成分享链接失败，请重试。")


def _effective_status(room: LiveRoom) -> str:
    return resolve_live_status(room, now=_now())


def _status_label(room: LiveRoom) -> str:
    return status_label(_effective_status(room))


def _share_payload(room: LiveRoom, request: Request | None = None) -> dict[str, str]:
    title = (room.share_title or "").strip() or room.title
    desc = (room.share_desc or "").strip() or (room.intro or "")
    image = (room.share_image_url or "").strip() or (room.cover_url or "")
    live_url = _build_public_live_url(request, room.slug) if request else f"/live/{room.slug}"
    share_url = _build_public_live_share_url(request, room.slug) if request else f"/share/live/{room.slug}"
    return {
        "title": f"{title} - 怀仁商学院" if "怀仁商学院" not in title else title,
        "description": desc,
        "image": image,
        "url": share_url,
        "live_url": live_url,
    }


def _room_to_dict(
    room: LiveRoom,
    request: Request | None = None,
    *,
    public: bool = False,
    preview: bool = False,
) -> dict[str, Any]:
    status = _effective_status(room)
    pv_count = int(getattr(room, "view_pv_count", None) or room.view_count or 0)
    uv_count = int(getattr(room, "view_uv_count", None) or 0)
    payload = {
        "id": int(room.id),
        "slug": room.slug,
        "title": room.title,
        "lecturer": room.lecturer or "",
        "intro": room.intro or "",
        "detail_html": room.detail_html or "",
        "content_type": room.content_type or "recorded",
        "video_source": room.video_source or "upload",
        "video_material_asset_id": int(room.video_material_asset_id) if room.video_material_asset_id else None,
        "video_object_key": "" if public else (room.video_object_key or ""),
        "video_url": "" if public else (room.video_url or ""),
        "video_mime_type": room.video_mime_type or "video/mp4",
        "video_file_name": room.video_file_name or "",
        "video_file_size": int(room.video_file_size or 0),
        "duration_seconds": int(room.duration_seconds or 0),
        "stream_url": "" if public else (room.stream_url or ""),
        "cover_url": room.cover_url or "",
        "cover_object_key": "" if public else (room.cover_object_key or ""),
        "cover_material_asset_id": int(room.cover_material_asset_id) if room.cover_material_asset_id else None,
        "share_title": room.share_title or "",
        "share_desc": room.share_desc or "",
        "share_image_url": room.share_image_url or "",
        "share_image_object_key": "" if public else (room.share_image_object_key or ""),
        "share_image_material_asset_id": int(room.share_image_material_asset_id) if room.share_image_material_asset_id else None,
        "start_time": _iso(room.start_time),
        "duration_minutes": int(room.duration_minutes) if room.duration_minutes else None,
        "status": room.status or "draft",
        "effective_status": status,
        "status_label": _status_label(room),
        "allow_like": bool(room.allow_like),
        "allow_comment": bool(room.allow_comment),
        "show_counters": bool(room.show_counters),
        "view_count": pv_count,
        "view_pv_count": pv_count,
        "view_uv_count": uv_count,
        "pv_count": pv_count,
        "uv_count": uv_count,
        "like_count": int(room.like_count or 0),
        "share_count": int(room.share_count or 0),
        "stats": {
            "pv_count": pv_count,
            "uv_count": uv_count,
            "like_count": int(room.like_count or 0),
            "share_count": int(room.share_count or 0),
        },
        "created_by": int(room.created_by) if room.created_by else None,
        "created_at": _iso(room.created_at),
        "updated_at": _iso(room.updated_at),
        "public_url": _build_public_live_url(request, room.slug) if request else f"/live/{room.slug}",
        "share": _share_payload(room, request),
        "share_url": _build_public_live_share_url(request, room.slug) if request else f"/share/live/{room.slug}",
        "can_play": status != "scheduled" and (preview or status in {"live", "replay", "ended"}) and bool(
            (room.stream_url or "").strip() if (room.content_type or "") == "live_stream" else ((room.video_object_key or "").strip() or (room.video_url or "").strip())
        ),
    }
    return payload


async def _get_room_or_404(db: AsyncSession, room_id: int) -> LiveRoom:
    room = await db.get(LiveRoom, room_id)
    if not room or room.deleted_at is not None:
        raise HTTPException(status_code=404, detail="直播活动不存在。")
    return room


async def _get_public_room_or_404(db: AsyncSession, slug: str, *, preview: bool = False) -> LiveRoom:
    room = (
        await db.execute(
            select(LiveRoom).where(
                LiveRoom.slug == slug,
                LiveRoom.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if not room or (not preview and _effective_status(room) not in PUBLIC_STATUSES):
        raise HTTPException(status_code=404, detail="直播活动不存在或尚未发布。")
    return room


def _effective_status_filter(status: str):
    now = _now()
    if status == "scheduled":
        return and_(
            LiveRoom.status == "scheduled",
            or_(LiveRoom.start_time.is_(None), LiveRoom.start_time > now),
        )
    if status == "replay":
        return or_(
            LiveRoom.status == "replay",
            LiveRoom.status == "published",
            and_(LiveRoom.status == "scheduled", LiveRoom.start_time.is_not(None), LiveRoom.start_time <= now),
            and_(LiveRoom.status == "live", LiveRoom.content_type != "live_stream"),
        )
    if status == "live":
        return and_(LiveRoom.status == "live", LiveRoom.content_type == "live_stream")
    return LiveRoom.status == status


async def _resolve_image(
    db: AsyncSession,
    admin: User,
    *,
    material_asset_id: int | None,
    image_url: str,
    object_key: str,
) -> tuple[int | None, str, str]:
    if material_asset_id:
        asset = await _get_material_asset_or_403(db, material_asset_id, admin, expected_type="image")
        return int(asset.id), _object_public_url(asset.object_key), asset.object_key
    key = (object_key or "").strip()
    url = (image_url or "").strip() or _object_public_url(key)
    return None, url, key


async def _resolve_video(
    db: AsyncSession,
    admin: User,
    payload: LiveRoomPayload,
    *,
    existing: LiveRoom | None = None,
) -> dict[str, Any]:
    if payload.content_type == "live_stream":
        stream_url = payload.stream_url.strip() or (existing.stream_url if existing else "")
        if not stream_url:
            raise HTTPException(status_code=400, detail="请填写直播流地址。")
        return {
            "video_source": "external_url",
            "video_material_asset_id": None,
            "video_object_key": existing.video_object_key if existing else "",
            "video_url": existing.video_url if existing else "",
            "video_mime_type": existing.video_mime_type if existing else "application/vnd.apple.mpegurl",
            "video_file_name": existing.video_file_name if existing else "",
            "video_file_size": int(existing.video_file_size or 0) if existing else 0,
            "duration_seconds": int(payload.duration_seconds or (existing.duration_seconds if existing else 0) or 0),
            "stream_url": stream_url,
        }

    if payload.video_source == "material":
        if not payload.video_material_asset_id:
            raise HTTPException(status_code=400, detail="请选择素材库视频。")
        asset = await _get_material_asset_or_403(db, payload.video_material_asset_id, admin, expected_type="video")
        return {
            "video_source": "material",
            "video_material_asset_id": int(asset.id),
            "video_object_key": asset.object_key or "",
            "video_url": _object_public_url(asset.object_key),
            "video_mime_type": asset.mime_type or "video/mp4",
            "video_file_name": asset.file_name or "",
            "video_file_size": int(asset.file_size or 0),
            "duration_seconds": int(asset.duration_seconds or payload.duration_seconds or 0),
            "stream_url": "",
        }

    if payload.video_source == "external_url":
        video_url = payload.video_url.strip() or (existing.video_url if existing else "")
        if not video_url:
            raise HTTPException(status_code=400, detail="请填写外部视频地址。")
        return {
            "video_source": "external_url",
            "video_material_asset_id": None,
            "video_object_key": "",
            "video_url": video_url,
            "video_mime_type": payload.video_mime_type.strip() or (existing.video_mime_type if existing else "video/mp4"),
            "video_file_name": payload.video_file_name.strip() or (existing.video_file_name if existing else "外部视频"),
            "video_file_size": int(payload.video_file_size or (existing.video_file_size if existing else 0) or 0),
            "duration_seconds": int(payload.duration_seconds or (existing.duration_seconds if existing else 0) or 0),
            "stream_url": "",
        }

    object_key = payload.video_object_key.strip() or (existing.video_object_key if existing else "")
    video_url = payload.video_url.strip() or _object_public_url(object_key) or (existing.video_url if existing else "")
    if not object_key and not video_url:
        raise HTTPException(status_code=400, detail="请上传视频或从素材库选择视频。")
    return {
        "video_source": "upload",
        "video_material_asset_id": None,
        "video_object_key": object_key,
        "video_url": video_url,
        "video_mime_type": payload.video_mime_type.strip() or (existing.video_mime_type if existing else "video/mp4"),
        "video_file_name": payload.video_file_name.strip() or (existing.video_file_name if existing else ""),
        "video_file_size": int(payload.video_file_size or (existing.video_file_size if existing else 0) or 0),
        "duration_seconds": int(payload.duration_seconds or (existing.duration_seconds if existing else 0) or 0),
        "stream_url": "",
    }


def _default_publish_status(room: LiveRoom) -> str:
    return default_publish_status(room, now=_now())


def _cleanup_owned_keys(*keys: str) -> None:
    schedule_oss_object_cleanup([key for key in keys if (key or "").strip()], logger=logger)


async def _apply_room_payload(
    db: AsyncSession,
    admin: User,
    room: LiveRoom,
    payload: LiveRoomPayload,
) -> None:
    old_video_key = room.video_object_key if not room.video_material_asset_id else ""
    old_cover_key = room.cover_object_key if not room.cover_material_asset_id else ""
    old_share_key = room.share_image_object_key if not room.share_image_material_asset_id else ""

    video_fields = await _resolve_video(db, admin, payload, existing=room)
    cover_asset_id, cover_url, cover_key = await _resolve_image(
        db,
        admin,
        material_asset_id=payload.cover_material_asset_id,
        image_url=payload.cover_url,
        object_key=payload.cover_object_key,
    )
    if not cover_url:
        raise HTTPException(status_code=400, detail="请上传或选择封面图片。")
    share_asset_id, share_url, share_key = await _resolve_image(
        db,
        admin,
        material_asset_id=payload.share_image_material_asset_id,
        image_url=payload.share_image_url,
        object_key=payload.share_image_object_key,
    )
    share_url = share_url or cover_url
    share_key = share_key or cover_key
    share_asset_id = share_asset_id or cover_asset_id

    room.title = payload.title.strip()
    room.lecturer = payload.lecturer.strip()
    room.intro = payload.intro.strip()
    room.detail_html = payload.detail_html.strip() or None
    room.content_type = payload.content_type
    for key, value in video_fields.items():
        setattr(room, key, value)
    room.cover_material_asset_id = cover_asset_id
    room.cover_url = cover_url
    room.cover_object_key = cover_key
    room.share_title = payload.share_title.strip()
    room.share_desc = payload.share_desc.strip()
    room.share_image_material_asset_id = share_asset_id
    room.share_image_url = share_url
    room.share_image_object_key = share_key
    room.start_time = _parse_datetime(payload.start_time)
    room.duration_minutes = payload.duration_minutes
    room.status = payload.status
    room.allow_like = bool(payload.allow_like)
    room.allow_comment = bool(payload.allow_comment)
    room.show_counters = bool(payload.show_counters)

    await db.flush()
    _cleanup_owned_keys(
        old_video_key if old_video_key and old_video_key != (room.video_object_key or "") else "",
        old_cover_key if old_cover_key and old_cover_key != (room.cover_object_key or "") else "",
        old_share_key if old_share_key and old_share_key != (room.share_image_object_key or "") else "",
    )


_faststart_tasks: set[asyncio.Task] = set()


def _schedule_faststart(object_key: str, mime_type: str) -> None:
    """在后台异步执行 faststart，不阻塞上传完成请求。持有任务引用防止被 GC。"""
    async def _runner() -> None:
        try:
            changed = await asyncio.to_thread(ensure_mp4_faststart, object_key, mime_type)
            if changed:
                logger.info("faststart 后台完成 object_key=%s", object_key)
        except Exception:  # noqa: BLE001
            logger.exception("faststart 后台处理失败 object_key=%s", object_key)

    try:
        task = asyncio.create_task(_runner())
    except RuntimeError:
        # 无事件循环（极少见），退化为同步线程执行。
        ensure_mp4_faststart(object_key, mime_type)
        return
    _faststart_tasks.add(task)
    task.add_done_callback(_faststart_tasks.discard)


@admin_router.post("/rooms/upload/init")
async def init_live_video_upload(
    payload: LiveVideoUploadInitPayload,
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    del admin
    extension = _validate_video_payload(payload.file_name, payload.file_size, payload.mime_type)
    object_key, _stored_name = _build_object_key_and_name(payload.file_name, extension)
    mime_type = payload.mime_type.strip() or mimetypes.guess_type(payload.file_name)[0] or "video/mp4"
    upload_plan = await asyncio.to_thread(_start_multipart_upload, object_key, mime_type, int(payload.file_size))
    return {
        "object_key": object_key,
        "upload_id": upload_plan["upload_id"],
        "part_size": upload_plan["part_size"],
        "part_count": upload_plan["part_count"],
        "part_urls": upload_plan["part_urls"],
        "mime_type": mime_type,
        "expires_in_seconds": MULTIPART_URL_EXPIRE_SECONDS,
    }


@admin_router.post("/rooms/upload/complete")
async def complete_live_video_upload(
    payload: LiveVideoUploadCompletePayload,
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    del admin
    parts = [{"part_number": int(item.part_number), "etag": item.etag} for item in payload.parts]
    if not parts:
        raise HTTPException(status_code=400, detail="缺少分片信息，无法完成上传。")
    object_size = await asyncio.to_thread(_complete_multipart_upload, payload.object_key.strip(), payload.upload_id.strip(), parts)
    if int(payload.file_size or 0) > 0 and object_size != int(payload.file_size):
        raise HTTPException(status_code=400, detail="OSS 文件大小校验失败。")
    resolved_mime = payload.mime_type.strip() or mimetypes.guess_type(payload.file_name)[0] or "video/mp4"
    # faststart（moov 前移）在后台异步执行：大视频（GB 级）处理需数分钟，
    # 同步等待会让上传完成请求超时。后台跑不阻塞前端，处理期间播放退而求其次仍可用。
    _schedule_faststart(payload.object_key.strip(), resolved_mime)
    return {
        "object_key": payload.object_key.strip(),
        "url": _object_public_url(payload.object_key.strip()),
        "file_name": _safe_filename(payload.file_name),
        "file_size": object_size,
        "mime_type": resolved_mime,
        "duration_seconds": int(payload.duration_seconds or 0),
    }


@admin_router.post("/rooms/upload/fail")
async def fail_live_video_upload(
    payload: LiveVideoUploadFailPayload,
    admin: User = Depends(require_admin),
) -> dict[str, bool]:
    del admin
    try:
        await asyncio.to_thread(_abort_multipart_upload, payload.object_key.strip(), payload.upload_id.strip())
    except Exception:  # noqa: BLE001
        logger.exception("Failed to abort live video multipart upload object_key=%s", payload.object_key)
    return {"success": True}


@admin_router.post("/upload/image")
async def upload_live_image(
    file: UploadFile = File(...),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    del admin
    raw = await file.read()
    file_name = _safe_filename(file.filename or "live-cover.jpg")
    mime_type = (file.content_type or "").strip() or mimetypes.guess_type(file_name)[0] or "image/jpeg"
    extension = _validate_reading_image_payload(file_name, len(raw), mime_type)
    object_key, _stored = _build_object_key_and_name(file_name, extension)
    await asyncio.to_thread(_upload_binary_to_oss, object_key, raw, mime_type)
    return {
        "object_key": object_key,
        "url": _object_public_url(object_key),
        "mime_type": mime_type,
        "file_name": file_name,
        "file_size": len(raw),
    }


@admin_router.get("/rooms")
async def list_live_rooms(
    request: Request,
    status: str | None = None,
    keyword: str | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    del admin
    stmt = select(LiveRoom).where(LiveRoom.deleted_at.is_(None))
    count_stmt = select(func.count()).select_from(LiveRoom).where(LiveRoom.deleted_at.is_(None))
    if (status or "").strip():
        normalized = (status or "").strip().lower()
        if normalized not in LIVE_STATUSES:
            raise HTTPException(status_code=400, detail="不支持的状态筛选。")
        status_clause = _effective_status_filter(normalized)
        stmt = stmt.where(status_clause)
        count_stmt = count_stmt.where(status_clause)
    if (keyword or "").strip():
        like_value = f"%{keyword.strip()}%"
        stmt = stmt.where(LiveRoom.title.like(like_value))
        count_stmt = count_stmt.where(LiveRoom.title.like(like_value))
    total = int((await db.execute(count_stmt)).scalar_one() or 0)
    rows = (
        await db.execute(
            stmt.order_by(desc(LiveRoom.created_at), desc(LiveRoom.id))
            .limit(page_size)
            .offset((page - 1) * page_size)
        )
    ).scalars().all()
    return _page_payload([_room_to_dict(item, request) for item in rows], total, page, page_size)


@admin_router.post("/rooms")
async def create_live_room(
    payload: LiveRoomPayload,
    request: Request,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    room = LiveRoom(
        slug=await _unique_slug(db),
        title=payload.title.strip(),
        created_by=int(admin.id),
        status="draft",
    )
    db.add(room)
    await db.flush()
    await _apply_room_payload(db, admin, room, payload)
    await db.commit()
    await db.refresh(room)
    return _room_to_dict(room, request)


@admin_router.get("/rooms/{room_id}")
async def get_live_room(
    room_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    room = await _get_room_or_404(db, room_id)
    return _room_to_dict(room, request)


@admin_router.put("/rooms/{room_id}")
async def update_live_room(
    room_id: int,
    payload: LiveRoomPayload,
    request: Request,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    room = await _get_room_or_404(db, room_id)
    await _apply_room_payload(db, admin, room, payload)
    await db.commit()
    await db.refresh(room)
    return _room_to_dict(room, request)


@admin_router.delete("/rooms/{room_id}")
async def delete_live_room(
    room_id: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, bool]:
    del admin
    room = await _get_room_or_404(db, room_id)
    room.deleted_at = _now()
    room.status = "disabled"
    await db.flush()
    _cleanup_owned_keys(
        room.video_object_key if not room.video_material_asset_id else "",
        room.cover_object_key if not room.cover_material_asset_id else "",
        room.share_image_object_key if not room.share_image_material_asset_id else "",
    )
    await db.commit()
    return {"success": True}


@admin_router.post("/rooms/{room_id}/publish")
async def publish_live_room(
    room_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    room = await _get_room_or_404(db, room_id)
    if not (room.cover_url or "").strip():
        raise HTTPException(status_code=400, detail="请先设置封面图片。")
    if (room.content_type or "") == "live_stream":
        if not (room.stream_url or "").strip():
            raise HTTPException(status_code=400, detail="请先填写直播流地址。")
    elif not ((room.video_object_key or "").strip() or (room.video_url or "").strip()):
        raise HTTPException(status_code=400, detail="请先上传或选择视频。")
    room.status = _default_publish_status(room)
    await db.commit()
    await db.refresh(room)
    return _room_to_dict(room, request)


@admin_router.post("/rooms/{room_id}/disable")
async def disable_live_room(
    room_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    room = await _get_room_or_404(db, room_id)
    room.status = "disabled"
    await db.commit()
    await db.refresh(room)
    return _room_to_dict(room, request)


async def _get_comment_or_404(db: AsyncSession, comment_id: int) -> LiveInteraction:
    row = await db.get(LiveInteraction, comment_id)
    if not row or row.type != "comment":
        raise HTTPException(status_code=404, detail="评论不存在。")
    return row


def _comment_setting_payload(row: LiveCommentSetting | None) -> dict[str, Any]:
    raw = row.block_words if row is not None else settings.live_comment_block_words
    return {
        "block_words": raw or "",
        "block_word_list": _split_comment_block_words(raw or ""),
        "updated_at": _iso(row.updated_at) if row is not None else "",
        "updated_by": int(row.updated_by) if row is not None and row.updated_by else None,
    }


def _toggle_log_to_dict(row: LiveCommentToggleLog) -> dict[str, Any]:
    return {
        "id": int(row.id),
        "live_id": int(row.live_id),
        "allow_comment": bool(row.allow_comment),
        "previous_allow_comment": bool(row.previous_allow_comment),
        "operator_id": int(row.operator_id) if row.operator_id else None,
        "created_at": _iso(row.created_at),
    }


@admin_router.get("/comments/settings")
async def get_live_comment_settings(
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    del admin
    return _comment_setting_payload(await _get_comment_setting(db))


@admin_router.put("/comments/settings")
async def update_live_comment_settings(
    payload: LiveCommentSettingsPayload,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    row = await _get_comment_setting(db)
    if row is None:
        row = LiveCommentSetting(id=COMMENT_SETTINGS_ID)
        db.add(row)
    row.block_words = payload.block_words.strip()
    row.updated_by = int(admin.id)
    await db.commit()
    await db.refresh(row)
    return _comment_setting_payload(row)


@admin_router.get("/comments")
async def list_live_comments(
    room_id: int | None = Query(None, ge=1),
    status: str | None = Query(None),
    keyword: str = Query("", max_length=80),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    del admin
    normalized_status = (status or "").strip().lower()
    if normalized_status and normalized_status not in COMMENT_STATUSES:
        raise HTTPException(status_code=400, detail="评论状态不正确。")
    filters = [
        LiveInteraction.type == "comment",
        LiveRoom.deleted_at.is_(None),
    ]
    if room_id:
        filters.append(LiveInteraction.live_id == int(room_id))
    if normalized_status:
        filters.append(LiveInteraction.status == normalized_status)
    else:
        filters.append(or_(LiveInteraction.status.is_(None), LiveInteraction.status != "deleted"))
    text = (keyword or "").strip()
    if text:
        like = f"%{text}%"
        filters.append(or_(LiveInteraction.content.like(like), LiveInteraction.nickname.like(like), LiveRoom.title.like(like)))
    total = (
        await db.execute(
            select(func.count(LiveInteraction.id))
            .select_from(LiveInteraction)
            .join(LiveRoom, LiveRoom.id == LiveInteraction.live_id)
            .where(*filters)
        )
    ).scalar_one()
    rows = (
        await db.execute(
            select(LiveInteraction, LiveRoom)
            .join(LiveRoom, LiveRoom.id == LiveInteraction.live_id)
            .where(*filters)
            .order_by(desc(LiveInteraction.id))
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    ).all()
    items = [_comment_to_dict(item, room) for item, room in rows]
    return _page_payload(items, int(total or 0), page, page_size)


@admin_router.post("/comments/batch")
async def batch_update_live_comments(
    payload: LiveCommentBatchPayload,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    del admin
    target_ids = sorted({int(item) for item in payload.ids if int(item) > 0})
    if not target_ids:
        raise HTTPException(status_code=400, detail="请选择要操作的评论。")
    next_status = {"hide": "hidden", "restore": "visible", "delete": "deleted"}[payload.action]
    rows = (
        await db.execute(
            select(LiveInteraction).where(
                LiveInteraction.id.in_(target_ids),
                LiveInteraction.type == "comment",
            )
        )
    ).scalars().all()
    for row in rows:
        row.status = next_status
    await db.commit()
    return {"success": True, "affected": len(rows), "status": next_status}


@admin_router.post("/comments/{comment_id}/hide")
async def hide_live_comment(
    comment_id: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    del admin
    row = await _get_comment_or_404(db, comment_id)
    row.status = "hidden"
    await db.commit()
    await db.refresh(row)
    return _comment_to_dict(row)


@admin_router.post("/comments/{comment_id}/restore")
async def restore_live_comment(
    comment_id: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    del admin
    row = await _get_comment_or_404(db, comment_id)
    row.status = "visible"
    await db.commit()
    await db.refresh(row)
    return _comment_to_dict(row)


@admin_router.delete("/comments/{comment_id}")
async def delete_live_comment(
    comment_id: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, bool]:
    del admin
    row = await _get_comment_or_404(db, comment_id)
    row.status = "deleted"
    await db.commit()
    return {"success": True}


@admin_router.get("/rooms/{room_id}/comments/toggle-logs")
async def list_live_comment_toggle_logs(
    room_id: int,
    limit: int = Query(10, ge=1, le=50),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    del admin
    await _get_room_or_404(db, room_id)
    rows = (
        await db.execute(
            select(LiveCommentToggleLog)
            .where(LiveCommentToggleLog.live_id == int(room_id))
            .order_by(desc(LiveCommentToggleLog.created_at), desc(LiveCommentToggleLog.id))
            .limit(limit)
        )
    ).scalars().all()
    return {"items": [_toggle_log_to_dict(item) for item in rows]}


@admin_router.post("/rooms/{room_id}/comments/toggle")
async def toggle_live_room_comments(
    room_id: int,
    payload: LiveCommentTogglePayload,
    request: Request,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    room = await _get_room_or_404(db, room_id)
    previous = bool(room.allow_comment)
    room.allow_comment = bool(payload.allow_comment)
    db.add(
        LiveCommentToggleLog(
            live_id=int(room.id),
            allow_comment=bool(payload.allow_comment),
            previous_allow_comment=previous,
            operator_id=int(admin.id),
        )
    )
    await db.commit()
    await db.refresh(room)
    return _room_to_dict(room, request)


def _visitor_id(payload: LiveInteractionPayload) -> str:
    return (payload.visitor_id or "").strip()[:128]


def _nickname(payload: LiveInteractionPayload) -> str:
    return (payload.nickname or "").strip()[:60]


def _ip_hash(request: Request) -> str:
    client_ip = request.client.host if request.client else ""
    raw = f"{client_ip}|{settings.jwt_secret}".encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def _interaction_dedupe_key(live_id: int, interaction_type: str, visitor_id: str, ip_hash: str) -> str:
    raw = f"{int(live_id)}|{interaction_type}|{visitor_id}|{ip_hash}".encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


async def _existing_deduped_interaction(
    db: AsyncSession,
    *,
    live_id: int,
    interaction_type: str,
    visitor_id: str,
    ip_hash: str,
    dedupe_key: str,
) -> int | None:
    legacy_match = and_(
        LiveInteraction.visitor_id == visitor_id,
        LiveInteraction.ip_hash == ip_hash,
    )
    return (
        await db.execute(
            select(LiveInteraction.id).where(
                LiveInteraction.live_id == int(live_id),
                LiveInteraction.type == interaction_type,
                or_(LiveInteraction.dedupe_key == dedupe_key, legacy_match),
            )
        )
    ).scalar_one_or_none()


async def _ensure_interaction_rate_limit(
    db: AsyncSession,
    *,
    live_id: int,
    interaction_type: str,
    visitor_id: str,
    ip_hash: str,
    seconds: int,
) -> None:
    threshold = _now() - timedelta(seconds=int(seconds))
    identity_filters = [LiveInteraction.ip_hash == ip_hash]
    if visitor_id:
        identity_filters.append(LiveInteraction.visitor_id == visitor_id)
    existing = (
        await db.execute(
            select(LiveInteraction.id)
            .where(
                LiveInteraction.live_id == int(live_id),
                LiveInteraction.type == interaction_type,
                LiveInteraction.created_at >= threshold,
                or_(*identity_filters),
            )
            .limit(1)
        )
    ).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=429, detail="操作太频繁，请稍后再试。")


def _split_comment_block_words(raw: str) -> list[str]:
    for sep in ("，", "、", "\n", "\r", "\t", ";", "；"):
        raw = raw.replace(sep, ",")
    return [item.strip() for item in raw.split(",") if item.strip()]


async def _get_comment_setting(db: AsyncSession) -> LiveCommentSetting | None:
    return await db.get(LiveCommentSetting, COMMENT_SETTINGS_ID)


async def _comment_block_words(db: AsyncSession) -> list[str]:
    row = await _get_comment_setting(db)
    raw = row.block_words if row is not None else settings.live_comment_block_words
    return _split_comment_block_words(raw or "")


def _ensure_comment_allowed(content: str, block_words: list[str]) -> None:
    lowered = content.lower()
    for word in block_words:
        if word.lower() in lowered:
            raise HTTPException(status_code=400, detail="评论包含敏感词，请调整后再发送。")


def _comment_to_dict(item: LiveInteraction, room: LiveRoom | None = None) -> dict[str, Any]:
    payload = {
        "id": int(item.id),
        "live_id": int(item.live_id),
        "visitor_id": item.visitor_id or "",
        "nickname": item.nickname or "",
        "content": item.content or "",
        "status": item.status or "visible",
        "status_label": {"visible": "可见", "hidden": "已隐藏", "deleted": "已删除"}.get(item.status or "visible", item.status or ""),
        "created_at": _iso(item.created_at),
        "updated_at": _iso(item.updated_at),
    }
    if room is not None:
        payload.update(
            {
                "room_id": int(room.id),
                "room_title": room.title or "",
                "room_slug": room.slug or "",
                "room_allow_comment": bool(room.allow_comment),
            }
        )
    return payload


@public_router.get("/{slug}")
async def get_public_live_room(
    slug: str,
    request: Request,
    preview: bool = Query(False),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    room = await _get_public_room_or_404(db, slug, preview=preview)
    return _room_to_dict(room, request, public=True, preview=preview)


@public_router.get("/{slug}/share-config")
async def get_public_live_share_config(
    slug: str,
    request: Request,
    url: str | None = Query(None, max_length=4096),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    room = await _get_public_room_or_404(db, slug)
    share = _share_payload(room, request)
    sign_url = ((url or "").strip() or share["url"]).split("#", 1)[0]
    sdk: dict[str, Any] = {
        "enabled": False,
        "corp_id": "",
        "app_id": "",
        "agent_id": 0,
        "timestamp": 0,
        "nonce_str": "",
        "signature": "",
        "js_api_list": [],
    }
    agent_sdk: dict[str, Any] = {**sdk}
    wechat_sdk: dict[str, Any] = {**sdk}
    wecom_configured = bool(
        settings.wecom_enabled
        and settings.wecom_corp_id.strip()
        and settings.wecom_agent_id
        and settings.wecom_app_secret.strip()
    )
    wecom_error = ""
    wechat_error = ""
    if wecom_configured:
        try:
            sdk = await _wecom_client.build_js_sdk_config(sign_url)
            sdk["js_api_list"] = [
                "updateAppMessageShareData",
                "updateTimelineShareData",
                "onMenuShareAppMessage",
                "onMenuShareTimeline",
            ]
            agent_sdk = await _wecom_client.build_agent_js_sdk_config(sign_url)
            agent_sdk["js_api_list"] = ["sendChatMessage"]
        except WecomApiError as exc:
            wecom_error = str(exc) or "企微 JS-SDK 签名失败。"
            logger.warning("live share js sdk config failed slug=%s err=%s", slug, exc)
    wechat_configured = bool(settings.wechat_mp_ready)
    if wechat_configured:
        try:
            wechat_sdk = await _wechat_mp_client.build_js_sdk_config(sign_url)
            wechat_sdk["js_api_list"] = [
                "updateAppMessageShareData",
                "updateTimelineShareData",
                "onMenuShareAppMessage",
                "onMenuShareTimeline",
            ]
        except WechatApiError as exc:
            wechat_error = str(exc) or "微信公众号 JS-SDK 签名失败。"
            logger.warning("live wechat share js sdk config failed slug=%s err=%s", slug, exc)
    diagnostics = {
        "sign_url": sign_url,
        "share_url": share["url"],
        "live_url": share["live_url"],
        "wecom": {
            "configured": wecom_configured,
            "enabled": bool(sdk.get("enabled")),
            "reason": "" if wecom_configured else "未配置企微应用参数。",
        },
        "wecom_agent": {
            "configured": wecom_configured,
            "enabled": bool(agent_sdk.get("enabled")),
            "reason": wecom_error if wecom_error else ("" if wecom_configured else "未配置企微应用参数。"),
        },
        "wechat": {
            "configured": wechat_configured,
            "enabled": bool(wechat_sdk.get("enabled")),
            "reason": wechat_error if wechat_error else ("" if wechat_configured else "未配置微信公众号参数。"),
        },
    }
    if wecom_error:
        diagnostics["wecom"]["reason"] = wecom_error
    return {"share": share, "sdk": sdk, "agent_sdk": agent_sdk, "wechat_sdk": wechat_sdk, "diagnostics": diagnostics}


async def _public_playback_payload(
    room: LiveRoom,
    request: Request,
    *,
    preview: bool = False,
    proxy: bool = False,
) -> dict[str, Any]:
    status = _effective_status(room)
    if status == "scheduled":
        raise HTTPException(status_code=409, detail="Live has not started.")
    if (room.content_type or "") == "live_stream":
        url = (room.stream_url or "").strip()
        if not url:
            raise HTTPException(status_code=404, detail="Live stream is not available.")
        return {
            "url": url,
            "mime_type": room.video_mime_type or "application/vnd.apple.mpegurl",
            "source": "live_stream",
            "expires_in": 0,
        }

    object_key = (room.video_object_key or "").strip()
    if object_key:
        if proxy:
            return {
                "url": _build_public_live_stream_url(request, room.slug, preview=preview, proxy=True),
                "mime_type": room.video_mime_type or "video/mp4",
                "source": "oss_proxy",
                "expires_in": 0,
            }
        signed_url = await asyncio.to_thread(_build_signed_stream_url, object_key)
        return {
            "url": signed_url,
            "mime_type": room.video_mime_type or "video/mp4",
            "source": "oss",
            "expires_in": max(int(settings.oss_signed_url_expire_seconds or 21600), 21600),
        }
    url = (room.video_url or "").strip()
    if url:
        return {
            "url": url,
            "mime_type": room.video_mime_type or "video/mp4",
            "source": "external_url",
            "expires_in": 0,
        }
    raise HTTPException(status_code=404, detail="Video is not available.")


@public_router.get("/{slug}/playback-url")
async def get_public_live_playback_url(
    slug: str,
    request: Request,
    preview: bool = Query(False),
    proxy: bool = Query(False),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    room = await _get_public_room_or_404(db, slug, preview=preview)
    return await _public_playback_payload(room, request, preview=preview, proxy=proxy)


@public_router.get("/{slug}/stream")
async def stream_public_live_room(
    slug: str,
    request: Request,
    preview: bool = Query(False),
    proxy: bool = Query(False),
    db: AsyncSession = Depends(get_db),
):
    room = await _get_public_room_or_404(db, slug, preview=preview)
    status = _effective_status(room)
    if status == "scheduled":
        raise HTTPException(status_code=409, detail="直播尚未开始。")
    if (room.content_type or "") == "live_stream":
        if not (room.stream_url or "").strip():
            raise HTTPException(status_code=404, detail="直播流暂不可用。")
        return RedirectResponse(room.stream_url, status_code=307)
    object_key = (room.video_object_key or "").strip()
    if object_key:
        if proxy:
            return await _proxy_oss_video_response(
                request,
                object_key=object_key,
                mime_type=room.video_mime_type or "video/mp4",
                file_name=room.video_file_name or f"{room.slug}.mp4",
            )
        signed_url = await asyncio.to_thread(_build_signed_stream_url, object_key)
        return RedirectResponse(signed_url, status_code=307)
    if (room.video_url or "").strip():
        return RedirectResponse(room.video_url, status_code=307)
    raise HTTPException(status_code=404, detail="视频暂不可用。")


@public_router.head("/{slug}/stream")
async def head_public_live_room_stream(
    slug: str,
    request: Request,
    preview: bool = Query(False),
    proxy: bool = Query(False),
    db: AsyncSession = Depends(get_db),
):
    room = await _get_public_room_or_404(db, slug, preview=preview)
    status = _effective_status(room)
    if status == "scheduled":
        raise HTTPException(status_code=409, detail="直播尚未开始。")
    if (room.content_type or "") == "live_stream":
        if not (room.stream_url or "").strip():
            raise HTTPException(status_code=404, detail="直播流暂不可用。")
        return RedirectResponse(room.stream_url, status_code=307)
    object_key = (room.video_object_key or "").strip()
    if object_key:
        if proxy:
            return await _proxy_oss_video_response(
                request,
                object_key=object_key,
                mime_type=room.video_mime_type or "video/mp4",
                file_name=room.video_file_name or f"{room.slug}.mp4",
                head_only=True,
            )
        signed_url = await asyncio.to_thread(_build_signed_stream_url, object_key)
        return RedirectResponse(signed_url, status_code=307)
    if (room.video_url or "").strip():
        return RedirectResponse(room.video_url, status_code=307)
    raise HTTPException(status_code=404, detail="视频暂不可用。")


@public_router.post("/{slug}/view")
async def record_public_live_view(
    slug: str,
    payload: LiveInteractionPayload,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    room = await _get_public_room_or_404(db, slug)
    visitor_id = _visitor_id(payload)
    ip_hash = _ip_hash(request)
    dedupe_key = _interaction_dedupe_key(int(room.id), "view", visitor_id, ip_hash)
    is_unique_visitor = not await _existing_deduped_interaction(
        db,
        live_id=int(room.id),
        interaction_type="view",
        visitor_id=visitor_id,
        ip_hash=ip_hash,
        dedupe_key=dedupe_key,
    )
    db.add(
        LiveInteraction(
            live_id=int(room.id),
            visitor_id=visitor_id,
            type="view",
            status="visible",
            ip_hash=ip_hash,
            user_agent=(request.headers.get("user-agent") or "")[:500],
        )
    )
    values = {
        "view_count": LiveRoom.view_count + 1,
        "view_pv_count": LiveRoom.view_pv_count + 1,
    }
    if is_unique_visitor:
        values["view_uv_count"] = LiveRoom.view_uv_count + 1
    await db.execute(update(LiveRoom).where(LiveRoom.id == int(room.id)).values(**values))
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        room = await _get_public_room_or_404(db, slug)
    else:
        await db.refresh(room)
    pv_count = int(getattr(room, "view_pv_count", None) or room.view_count or 0)
    uv_count = int(getattr(room, "view_uv_count", None) or 0)
    return {
        "view_count": pv_count,
        "view_pv_count": pv_count,
        "view_uv_count": uv_count,
        "pv_count": pv_count,
        "uv_count": uv_count,
    }


@public_router.post("/{slug}/like")
async def like_public_live_room(
    slug: str,
    payload: LiveInteractionPayload,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    room = await _get_public_room_or_404(db, slug)
    if not bool(room.allow_like):
        raise HTTPException(status_code=400, detail="该直播未开启点赞。")
    visitor_id = _visitor_id(payload)
    ip_hash = _ip_hash(request)
    dedupe_key = _interaction_dedupe_key(int(room.id), "like", visitor_id, ip_hash)
    existing = await _existing_deduped_interaction(
        db,
        live_id=int(room.id),
        interaction_type="like",
        visitor_id=visitor_id,
        ip_hash=ip_hash,
        dedupe_key=dedupe_key,
    )
    if existing:
        return {"liked": True, "like_count": int(room.like_count or 0)}
    db.add(
        LiveInteraction(
            live_id=int(room.id),
            visitor_id=visitor_id,
            type="like",
            dedupe_key=dedupe_key,
            status="visible",
            ip_hash=ip_hash,
            user_agent=(request.headers.get("user-agent") or "")[:500],
        )
    )
    await db.execute(
        update(LiveRoom)
        .where(LiveRoom.id == int(room.id))
        .values(like_count=LiveRoom.like_count + 1)
    )
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        room = await _get_public_room_or_404(db, slug)
    else:
        await db.refresh(room)
    return {"liked": True, "like_count": int(room.like_count or 0)}


@public_router.post("/{slug}/share")
async def share_public_live_room(
    slug: str,
    payload: LiveInteractionPayload,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    room = await _get_public_room_or_404(db, slug)
    visitor_id = _visitor_id(payload)
    ip_hash = _ip_hash(request)
    try:
        await _ensure_interaction_rate_limit(
            db,
            live_id=int(room.id),
            interaction_type="share",
            visitor_id=visitor_id,
            ip_hash=ip_hash,
            seconds=SHARE_RATE_LIMIT_SECONDS,
        )
    except HTTPException as exc:
        if exc.status_code == 429:
            return {"share_count": int(room.share_count or 0), "share": _share_payload(room, request)}
        raise
    db.add(
        LiveInteraction(
            live_id=int(room.id),
            visitor_id=visitor_id,
            type="share",
            status="visible",
            ip_hash=ip_hash,
            user_agent=(request.headers.get("user-agent") or "")[:500],
        )
    )
    await db.execute(
        update(LiveRoom)
        .where(LiveRoom.id == int(room.id))
        .values(share_count=LiveRoom.share_count + 1)
    )
    await db.commit()
    await db.refresh(room)
    return {"share_count": int(room.share_count or 0), "share": _share_payload(room, request)}


@public_router.get("/{slug}/comments")
async def list_public_live_comments(
    slug: str,
    after_id: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    room = await _get_public_room_or_404(db, slug)
    query = select(LiveInteraction).where(
        LiveInteraction.live_id == room.id,
        LiveInteraction.type == "comment",
        LiveInteraction.status == "visible",
    )
    if after_id:
        rows = (
            await db.execute(
                query.where(LiveInteraction.id > int(after_id)).order_by(LiveInteraction.id.asc()).limit(limit)
            )
        ).scalars().all()
    else:
        rows = (
            await db.execute(
                query.order_by(desc(LiveInteraction.id)).limit(limit)
            )
        ).scalars().all()
        rows = list(reversed(rows))
    items = [_comment_to_dict(item) for item in rows]
    latest_id = max([int(item["id"]) for item in items], default=int(after_id or 0))
    return {"items": items, "latest_id": latest_id}


@public_router.post("/{slug}/comments")
async def create_public_live_comment(
    slug: str,
    payload: LiveInteractionPayload,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    room = await _get_public_room_or_404(db, slug)
    if not bool(room.allow_comment):
        raise HTTPException(status_code=400, detail="该直播未开启评论。")
    content = (payload.content or "").strip()
    if not content:
        raise HTTPException(status_code=400, detail="评论内容不能为空。")
    _ensure_comment_allowed(content, await _comment_block_words(db))
    visitor_id = _visitor_id(payload)
    nickname = _nickname(payload)
    ip_hash = _ip_hash(request)
    await _ensure_interaction_rate_limit(
        db,
        live_id=int(room.id),
        interaction_type="comment",
        visitor_id=visitor_id,
        ip_hash=ip_hash,
        seconds=COMMENT_RATE_LIMIT_SECONDS,
    )
    row = LiveInteraction(
        live_id=int(room.id),
        visitor_id=visitor_id,
        nickname=nickname,
        type="comment",
        content=content,
        status="visible",
        ip_hash=ip_hash,
        user_agent=(request.headers.get("user-agent") or "")[:500],
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return _comment_to_dict(row)


async def get_public_live_meta(db: AsyncSession, slug: str, request: Request | None = None) -> dict[str, str] | None:
    room = (
        await db.execute(
            select(LiveRoom).where(
                LiveRoom.slug == slug,
                LiveRoom.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if not room or _effective_status(room) not in PUBLIC_STATUSES:
        return None
    return _share_payload(room, request)


__all__ = ["admin_router", "public_router", "get_public_live_meta"]
