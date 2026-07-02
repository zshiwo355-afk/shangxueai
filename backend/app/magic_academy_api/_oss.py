from __future__ import annotations

import logging
import math
import mimetypes
import secrets
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import quote

import oss2
from oss2.models import PartInfo
from fastapi import HTTPException

from ..config import DEFAULT_MAGIC_VIDEO_MAX_SIZE_MB, get_settings
from ._utils import _strip_slashes

logger = logging.getLogger("app.magic_academy_api.oss")
settings = get_settings()

VIDEO_EXTENSIONS = {".mp4", ".mov", ".webm", ".m4v"}
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
MAX_READING_IMAGE_SIZE = 10 * 1024 * 1024
MULTIPART_URL_EXPIRE_SECONDS = max(int(settings.oss_signed_url_expire_seconds or 21600), 21600)
STREAM_URL_EXPIRE_SECONDS = 600
MIN_MULTIPART_PART_SIZE = 8 * 1024 * 1024
MAX_MULTIPART_PARTS = 1000
# 小于此值的 mp4 直接下载到内存做 faststart；更大的走流式 OSS 服务端拼接，避免 OOM。
FASTSTART_INLINE_MAX_BYTES = 64 * 1024 * 1024


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


def _cname_endpoint() -> str:
    """已绑定的自有域名（带协议），未配置则返回空串。"""
    domain = (settings.oss_cname_domain or "").strip().rstrip("/")
    if not domain:
        return ""
    if domain.startswith("http://") or domain.startswith("https://"):
        return domain
    return f"https://{domain}"


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
    cname_endpoint = _cname_endpoint()
    # 绑定自有域名后：签名走 CNAME（endpoint 用自有域名 + is_cname），
    # 公网直链也用自有域名，规避默认域名的强制 attachment。
    public_base_url = cname_endpoint or _build_public_base_url(
        bucket, endpoint, settings.oss_public_base_url
    )
    return {
        "access_key_id": settings.oss_access_key_id,
        "access_key_secret": settings.oss_access_key_secret,
        "endpoint": endpoint,
        "cname_endpoint": cname_endpoint,
        "bucket": bucket,
        "prefix": prefix,
        "public_base_url": public_base_url,
    }


def _build_oss_bucket(*, connect_timeout: int | None = None) -> oss2.Bucket:
    oss_settings = _ensure_oss_settings()
    auth = oss2.Auth(oss_settings["access_key_id"], oss_settings["access_key_secret"])
    cname_endpoint = oss_settings.get("cname_endpoint") or ""
    kwargs: dict[str, Any] = {}
    if connect_timeout:
        kwargs["connect_timeout"] = connect_timeout
    if cname_endpoint:
        return oss2.Bucket(auth, cname_endpoint, oss_settings["bucket"], is_cname=True, **kwargs)
    return oss2.Bucket(auth, oss_settings["endpoint"], oss_settings["bucket"], **kwargs)


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
    max_size_mb = int(settings.magic_video_max_size_mb or DEFAULT_MAGIC_VIDEO_MAX_SIZE_MB)
    max_bytes = max_size_mb * 1024 * 1024
    if int(file_size or 0) > max_bytes:
        raise HTTPException(
            status_code=400,
            detail=f"视频大小不能超过 {max_size_mb}MB。",
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
    expire_seconds = max(int(settings.oss_signed_url_expire_seconds or 21600), 21600)
    return bucket.sign_url("GET", object_key, expire_seconds, slash_safe=True)


def ensure_mp4_faststart(object_key: str, mime_type: str | None = None) -> bool:
    """确保 OSS 上的 mp4 把 moov 索引放在文件头部（faststart）。

    QQ 录屏等工具导出的 mp4 常把 moov 放在文件末尾，导致播放器（尤其微信 X5）
    必须下完整个文件才能拿到索引开始播放——小文件还好，GB 级大文件会“加载半天/超时”。
    本函数把 moov 前移：
      - 小文件（< FASTSTART_INLINE_MAX_BYTES）：下载到内存重排后覆盖上传；
      - 大文件：流式处理——只下载头部探测 + moov 段（通常几 MB），其余用 OSS
        服务端分片拷贝（upload_part_copy）拼接，绝不把整个大文件读进内存。
    仅对 .mp4/.m4v 生效；非 mp4、已前置、或结构异常时安全跳过，返回是否实际改写。
    """
    from ..mp4_faststart import (
        FaststartError,
        faststart_bytes,
        needs_faststart,
        plan_faststart_streaming,
    )

    key = (object_key or "").strip()
    if not key:
        return False
    suffix = Path(key).suffix.lower()
    if suffix not in {".mp4", ".m4v"}:
        return False
    bucket = _build_oss_bucket()
    content_type = (mime_type or "").strip() or "video/mp4"

    try:
        head = bucket.head_object(key)
        file_size = int(head.content_length or 0)
    except Exception as exc:  # noqa: BLE001
        logger.warning("faststart head 失败 key=%s err=%s", key, exc)
        return False
    if file_size <= 0:
        return False

    # --- 小文件：内存版 ---
    if file_size < FASTSTART_INLINE_MAX_BYTES:
        try:
            data = bucket.get_object(key).read()
            if not needs_faststart(data):
                return False
            fixed = faststart_bytes(data)
        except FaststartError as exc:
            logger.info("faststart 跳过 key=%s reason=%s", key, exc)
            return False
        except Exception as exc:  # noqa: BLE001
            logger.warning("faststart 处理异常 key=%s err=%s", key, exc)
            return False
        if fixed is data or len(fixed) != len(data):
            return False
        try:
            bucket.put_object(key, fixed, headers={"Content-Type": content_type})
        except Exception as exc:  # noqa: BLE001
            logger.warning("faststart 回传失败 key=%s err=%s", key, exc)
            return False
        logger.info("faststart 已处理(内存) key=%s size=%d", key, len(fixed))
        return True

    # --- 大文件：流式 OSS 服务端拼接 ---
    # 服务端分片拷贝（upload_part_copy）GB 级耗时久，默认 60s 超时不够，用长超时实例。
    big_bucket = _build_oss_bucket(connect_timeout=600)

    def _read_range(start: int, length: int) -> bytes:
        end = min(start + length - 1, file_size - 1)
        return big_bucket.get_object(key, byte_range=(start, end)).read()

    try:
        plan = plan_faststart_streaming(_read_range, file_size)
    except FaststartError as exc:
        logger.info("faststart 流式跳过 key=%s reason=%s", key, exc)
        return False
    except Exception as exc:  # noqa: BLE001
        logger.warning("faststart 流式探测异常 key=%s err=%s", key, exc)
        return False
    if plan is None:
        return False

    return _apply_faststart_plan_via_oss(big_bucket, key, plan, content_type)


def _apply_faststart_plan_via_oss(bucket, key: str, plan, content_type: str) -> bool:
    """用 multipart + upload_part_copy 在 OSS 服务端拼出 faststart 后的新对象，覆盖原对象。

    写到临时 key，成功后再 copy 回原 key，避免中途失败破坏原视频。
    """
    bucket_name = bucket.bucket_name
    tmp_key = f"{key}.faststart-{secrets.token_hex(6)}.tmp"
    # 分片拷贝按 1GB 分块：单片越大服务端拷贝越久、越易超时；1GB 兼顾速度与分片数
    # （8GB 仅 8 片，远低于 OSS 10000 上限）。单片硬上限是 5GB。
    max_copy_part = 1 * 1024 * 1024 * 1024
    min_part = 100 * 1024

    # 预检：OSS 要求除最后一片外每片 ≥100KB。展开所有片的大小，若有非末片违规则放弃
    # 流式（不破坏原文件）。真实大视频不会触发此分支；仅防御极端/异常结构。
    sizes: list[int] = []
    for seg in plan.segments:
        if seg[0] == "data":
            sizes.append(len(seg[1]))
        else:
            total = seg[2] - seg[1]
            while total > 0:
                chunk = min(total, max_copy_part)
                sizes.append(chunk)
                total -= chunk
    for idx, sz in enumerate(sizes):
        if idx < len(sizes) - 1 and sz < min_part:
            logger.info("faststart 流式放弃 key=%s：第%d片仅%d字节(<100KB)", key, idx + 1, sz)
            return False

    init = bucket.init_multipart_upload(tmp_key, headers={"Content-Type": content_type})
    upload_id = init.upload_id
    parts: list[PartInfo] = []
    part_number = 1
    try:
        for seg in plan.segments:
            if seg[0] == "data":
                payload = seg[1]
                result = bucket.upload_part(tmp_key, upload_id, part_number, payload)
                parts.append(PartInfo(part_number, result.etag))
                part_number += 1
            else:
                _, src_start, src_end = seg  # [src_start, src_end)
                offset = src_start
                while offset < src_end:
                    chunk_end = min(offset + max_copy_part, src_end)  # exclusive
                    result = bucket.upload_part_copy(
                        bucket_name,
                        key,
                        (offset, chunk_end - 1),  # oss byte_range 闭区间
                        tmp_key,
                        upload_id,
                        part_number,
                    )
                    parts.append(PartInfo(part_number, result.etag))
                    part_number += 1
                    offset = chunk_end
        parts.sort(key=lambda p: p.part_number)
        bucket.complete_multipart_upload(tmp_key, upload_id, parts)
    except Exception as exc:  # noqa: BLE001
        logger.warning("faststart 流式拼接失败 key=%s err=%s", key, exc)
        try:
            bucket.abort_multipart_upload(tmp_key, upload_id)
        except Exception:  # noqa: BLE001
            pass
        return False

    # 校验临时对象大小，再覆盖原 key，最后删临时对象。
    try:
        tmp_head = bucket.head_object(tmp_key)
        if int(tmp_head.content_length or 0) != int(plan.total_size):
            logger.warning(
                "faststart 临时对象大小不符 key=%s expect=%d got=%s",
                key, plan.total_size, tmp_head.content_length,
            )
            bucket.delete_object(tmp_key)
            return False
        bucket.copy_object(bucket_name, tmp_key, key, headers={"Content-Type": content_type})
        bucket.delete_object(tmp_key)
    except Exception as exc:  # noqa: BLE001
        logger.warning("faststart 覆盖原对象失败 key=%s err=%s", key, exc)
        try:
            bucket.delete_object(tmp_key)
        except Exception:  # noqa: BLE001
            pass
        return False
    logger.info("faststart 已处理(流式) key=%s size=%d", key, plan.total_size)
    return True



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


def _download_oss_object(object_key: str) -> bytes:
    bucket = _build_oss_bucket()
    return bucket.get_object(object_key).read()


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
    "ensure_mp4_faststart",
    "_build_signed_inline_url",
    "_upload_binary_to_oss",
    "_download_oss_object",
    "_abort_multipart_upload",
    "_delete_oss_object",
]
