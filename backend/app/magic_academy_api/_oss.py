from __future__ import annotations

import logging
import math
import mimetypes
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import quote

import oss2
from oss2.models import PartInfo
from fastapi import HTTPException

from ..config import get_settings
from ._utils import _strip_slashes

logger = logging.getLogger("app.magic_academy_api.oss")
settings = get_settings()

VIDEO_EXTENSIONS = {".mp4", ".mov", ".webm", ".m4v"}
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
MAX_READING_IMAGE_SIZE = 10 * 1024 * 1024
MULTIPART_URL_EXPIRE_SECONDS = 3600
STREAM_URL_EXPIRE_SECONDS = 600
MIN_MULTIPART_PART_SIZE = 8 * 1024 * 1024
MAX_MULTIPART_PARTS = 1000


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
    prefix = _strip_slashes(settings.oss_upload_prefix)
    if not prefix:
        raise HTTPException(status_code=500, detail="OSS_UPLOAD_PREFIX 未配置。")
    public_base_url = _build_public_base_url(bucket, endpoint, settings.oss_public_base_url)
    return {
        "access_key_id": settings.oss_access_key_id,
        "access_key_secret": settings.oss_access_key_secret,
        "endpoint": endpoint,
        "bucket": bucket,
        "prefix": prefix,
        "public_base_url": public_base_url,
    }


def _build_oss_bucket() -> oss2.Bucket:
    oss_settings = _ensure_oss_settings()
    auth = oss2.Auth(oss_settings["access_key_id"], oss_settings["access_key_secret"])
    return oss2.Bucket(auth, oss_settings["endpoint"], oss_settings["bucket"])


def _guess_video_extension(original_filename: str, mime_type: str | None = None) -> str:
    suffix = Path(original_filename or "").suffix.lower()
    if suffix in VIDEO_EXTENSIONS:
        return suffix
    guessed = mimetypes.guess_extension((mime_type or "").split(";", 1)[0].strip() or "")
    if guessed in VIDEO_EXTENSIONS:
        return guessed
    raise HTTPException(status_code=400, detail="仅支持 mp4、mov、webm、m4v 等视频格式。")


def _guess_image_extension(original_filename: str, mime_type: str | None = None) -> str:
    suffix = Path(original_filename or "").suffix.lower()
    if suffix in IMAGE_EXTENSIONS:
        return suffix
    guessed = mimetypes.guess_extension((mime_type or "").split(";", 1)[0].strip() or "")
    guessed = ".jpg" if guessed == ".jpe" else guessed
    if guessed in IMAGE_EXTENSIONS:
        return guessed
    raise HTTPException(status_code=400, detail="仅支持 jpg、jpeg、png、webp 图片格式。")


def _validate_reading_image_payload(original_filename: str, file_size: int, mime_type: str | None = None) -> str:
    if int(file_size or 0) <= 0:
        raise HTTPException(status_code=400, detail="图片大小必须大于 0。")
    if int(file_size or 0) > MAX_READING_IMAGE_SIZE:
        raise HTTPException(status_code=400, detail="图片大小不能超过 10MB。")
    return _guess_image_extension(original_filename, mime_type)


def _validate_video_payload(original_filename: str, file_size: int, mime_type: str | None = None) -> str:
    if int(file_size or 0) <= 0:
        raise HTTPException(status_code=400, detail="文件大小必须大于 0。")
    max_bytes = int(settings.magic_video_max_size_mb or 10240) * 1024 * 1024
    if int(file_size or 0) > max_bytes:
        raise HTTPException(
            status_code=400,
            detail=f"视频大小不能超过 {int(settings.magic_video_max_size_mb or 10240)}MB。",
        )
    return _guess_video_extension(original_filename, mime_type)


def _build_object_key_and_name(original_filename: str, extension: str) -> tuple[str, str]:
    oss_settings = _ensure_oss_settings()
    today = datetime.now()
    stored_filename = f"{uuid.uuid4().hex}{extension}"
    date_path = today.strftime("%Y/%m/%d")
    object_key = f"{oss_settings['prefix']}/{date_path}/{stored_filename}"
    return object_key, stored_filename


def _choose_multipart_part_size(file_size: int) -> int:
    part_size = MIN_MULTIPART_PART_SIZE
    while math.ceil(file_size / part_size) > MAX_MULTIPART_PARTS:
        part_size *= 2
    return part_size


def _build_oss_object_url(public_base_url: str, object_key: str) -> str:
    return f"{public_base_url.rstrip('/')}/{quote(object_key, safe='/')}"


def _start_multipart_upload(object_key: str, mime_type: str, file_size: int) -> dict[str, Any]:
    bucket = _build_oss_bucket()
    init_result = bucket.init_multipart_upload(object_key, headers={"Content-Type": mime_type})
    part_size = _choose_multipart_part_size(file_size)
    part_count = max(1, math.ceil(file_size / part_size))
    part_urls = []
    for part_number in range(1, part_count + 1):
        signed_url = bucket.sign_url(
            "PUT",
            object_key,
            MULTIPART_URL_EXPIRE_SECONDS,
            params={"uploadId": init_result.upload_id, "partNumber": str(part_number)},
            slash_safe=True,
        )
        part_urls.append({"part_number": part_number, "url": signed_url})
    return {
        "upload_id": init_result.upload_id,
        "part_size": part_size,
        "part_count": part_count,
        "part_urls": part_urls,
    }


def _list_uploaded_parts(object_key: str, upload_id: str) -> dict[int, str]:
    bucket = _build_oss_bucket()
    marker = "0"
    collected: dict[int, str] = {}
    while True:
        result = bucket.list_parts(object_key, upload_id, marker=marker, max_parts=1000)
        for item in result.parts:
            collected[int(item.part_number)] = str(item.etag or "").strip('"')
        if not result.is_truncated:
            break
        marker = str(result.next_marker)
    return collected


def _complete_multipart_upload(object_key: str, upload_id: str, parts: list[dict[str, Any]]) -> int:
    bucket = _build_oss_bucket()
    remote_parts = _list_uploaded_parts(object_key, upload_id)
    if not remote_parts:
        raise HTTPException(status_code=400, detail="OSS 中未找到已上传的分片。")
    normalized_parts: list[PartInfo] = []
    for item in sorted(parts, key=lambda value: int(value["part_number"])):
        part_number = int(item["part_number"])
        etag = str(item["etag"] or "").strip().strip('"')
        if remote_parts.get(part_number) != etag:
            raise HTTPException(status_code=400, detail=f"第 {part_number} 片 ETag 校验失败。")
        normalized_parts.append(PartInfo(part_number, etag))
    if not normalized_parts:
        raise HTTPException(status_code=400, detail="缺少分片信息，无法完成上传。")
    bucket.complete_multipart_upload(object_key, upload_id, normalized_parts)
    head = bucket.head_object(object_key)
    return int(head.content_length or 0)


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


def _build_signed_inline_url(
    object_key: str,
    *,
    mime_type: str | None = None,
    filename: str | None = None,
) -> str:
    del mime_type
    bucket = _build_oss_bucket()
    expire_seconds = max(int(settings.oss_signed_url_expire_seconds or 3600), 60)
    disposition = _format_content_disposition(filename, attachment=False)
    return bucket.sign_url(
        "GET",
        object_key,
        expire_seconds,
        params={"response-content-disposition": disposition},
        slash_safe=True,
    )


def _upload_binary_to_oss(object_key: str, content: bytes, mime_type: str) -> None:
    bucket = _build_oss_bucket()
    bucket.put_object(object_key, content, headers={"Content-Type": mime_type})


def _abort_multipart_upload(object_key: str, upload_id: str) -> None:
    bucket = _build_oss_bucket()
    bucket.abort_multipart_upload(object_key, upload_id)


def _delete_oss_object(object_key: str) -> None:
    bucket = _build_oss_bucket()
    bucket.delete_object(object_key)


__all__ = [
    "logger",
    "settings",
    "VIDEO_EXTENSIONS",
    "IMAGE_EXTENSIONS",
    "MAX_READING_IMAGE_SIZE",
    "MULTIPART_URL_EXPIRE_SECONDS",
    "STREAM_URL_EXPIRE_SECONDS",
    "MIN_MULTIPART_PART_SIZE",
    "MAX_MULTIPART_PARTS",
    "_normalize_oss_endpoint",
    "_build_public_base_url",
    "_ensure_oss_settings",
    "_build_oss_bucket",
    "_guess_video_extension",
    "_guess_image_extension",
    "_validate_reading_image_payload",
    "_validate_video_payload",
    "_build_object_key_and_name",
    "_choose_multipart_part_size",
    "_build_oss_object_url",
    "_start_multipart_upload",
    "_list_uploaded_parts",
    "_complete_multipart_upload",
    "_build_signed_stream_url",
    "_build_signed_inline_url",
    "_upload_binary_to_oss",
    "_abort_multipart_upload",
    "_delete_oss_object",
]
