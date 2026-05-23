from __future__ import annotations

import asyncio
import json
import logging
import math
import mimetypes
import uuid
from calendar import monthrange
from datetime import date, datetime, timedelta
from io import BytesIO
from pathlib import Path
from typing import Any
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, RedirectResponse, StreamingResponse
import oss2
from oss2.models import PartInfo
from sqlalchemy import and_, delete as sql_delete, desc, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import update

from .access import get_user_whitelist_permissions, is_super_admin
from .auth import get_current_user, require_admin, require_super_admin
from .config import get_settings
from .db import get_db
from .magic_academy_schemas import (
    AudioMakeupPayload,
    AudioMakeupSettingPayload,
    MagicAudioUploadPayload,
    MagicVideoPayload,
    MagicVideoReplaceCompletePayload,
    MagicVideoReplaceFailPayload,
    MagicVideoReplaceInitPayload,
    MagicVideoUploadCompletePayload,
    MagicVideoUploadFailPayload,
    MagicVideoUploadInitPayload,
    MagicVideoUploadPartPayload,
    ProgressPayload,
    QuestionPayload,
    QuizPointPayload,
    QuizSubmitPayload,
    VideoSeriesAddItemPayload,
    VideoSeriesPayload,
    VideoSeriesReorderPayload,
    VideoTargetInput,
    VideoWhitelistCreatePayload,
    WatchConfirmLogPayload,
    WatchConfirmSettingPayload,
)
from .models import (
    MagicAudioMakeupSetting,
    MagicAudioUpload,
    MagicQuestion,
    MagicQuizAnswer,
    MagicQuizPointPassRecord,
    MagicReadingContent,
    MagicReadingContentTarget,
    MagicVideo,
    MagicVideoProgress,
    MagicVideoQuizPoint,
    MagicVideoSeries,
    MagicVideoSeriesItem,
    MagicVideoTarget,
    MagicVideoWatchConfirmLog,
    MagicVideoWatchConfirmSetting,
    MagicVideoWhitelist,
    MaterialAsset,
    MaterialProject,
    UserWhitelist,
    User,
)

router = APIRouter(prefix="/api/magic-academy", tags=["magic-academy"])
magic_video_router = APIRouter(prefix="/api/magic", tags=["magic-videos"])

BASE_DIR = Path(__file__).resolve().parents[1]
UPLOAD_ROOT = BASE_DIR / "uploads" / "magic_academy"
VIDEO_DIR = UPLOAD_ROOT / "videos"
MAX_AUDIO_SIZE = 50 * 1024 * 1024
AUDIO_EXTENSIONS = {".mp3", ".m4a", ".wav", ".aac", ".amr", ".webm", ".ogg"}
VIDEO_EXTENSIONS = {".mp4", ".mov", ".webm", ".m4v"}
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
VIDEO_STATUSES = {"draft", "published", "disabled"}
VIDEO_UPLOAD_STATUSES = {"pending", "uploading", "completed", "failed", "deleted"}
TRANSCODE_STATUSES = {"none", "pending", "processing", "completed", "failed"}
TARGET_TYPES = {"all_users", "all_newcomers", "department", "position", "role", "user"}
VIDEO_SOURCE_TYPES = {"upload", "material"}
IMAGE_SOURCE_TYPES = {"upload", "material"}
READING_TARGET_TYPES = {"all", "all_newcomers", "department", "position", "user"}
QUESTION_TYPES = {"single", "multiple", "judge", "blank", "short_answer"}
QUESTION_TYPE_ALIASES = {
    "fill": "blank",
    "short": "short_answer",
}
MULTIPART_URL_EXPIRE_SECONDS = 3600
STREAM_URL_EXPIRE_SECONDS = 600
MIN_MULTIPART_PART_SIZE = 8 * 1024 * 1024
MAX_MULTIPART_PARTS = 1000
UNASSIGNED_DEPARTMENT_FILTER = "__UNASSIGNED__"
settings = get_settings()
logger = logging.getLogger(__name__)

SOURCE_MANUAL = "manual"
SOURCE_AUDIO_USER_UPLOAD = "user_upload"
SOURCE_AUDIO_MAKEUP = "makeup"
SOURCE_WHITELIST_AUTO = "whitelist_auto"
SOURCE_WHITELIST_EXEMPT = "whitelist_exempt"
SOURCE_WHITELIST_AUTO_CORRECT = "whitelist_auto_correct"
WATCH_CONFIRM_DEFAULT_MESSAGE = "请确认你正在观看视频"
WATCH_CONFIRM_DEFAULT_BUTTON = "继续学习"
DEFAULT_AUDIO_MAKEUP_DAYS = 0
MAX_READING_IMAGE_SIZE = 10 * 1024 * 1024
READING_CONTENT_ACTIVE = "active"

VIDEO_DIR.mkdir(parents=True, exist_ok=True)


def _now() -> datetime:
    return datetime.now()


def _iso(dt: datetime | date | None) -> str | None:
    if not dt:
        return None
    if isinstance(dt, date) and not isinstance(dt, datetime):
        return dt.isoformat()
    return dt.isoformat()


def _json_loads(raw: str | None, default: Any) -> Any:
    if not raw:
        return default
    try:
        return json.loads(raw)
    except (TypeError, ValueError):
        return default


def _json_dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False)


def _user_name(user: User) -> str:
    return (user.real_name or user.display_name or user.username or "").strip()


def _user_department(user: User) -> str:
    return (user.department or "").strip()


def _user_position(user: User) -> str:
    return (user.position or "").strip()


def _department_matches_filter(user: User, department: str) -> bool:
    if department == UNASSIGNED_DEPARTMENT_FILTER:
        return not _user_department(user)
    return _user_department(user) == department


def _normalize_target_type(value: str) -> str:
    value = (value or "").strip().lower()
    if value not in TARGET_TYPES:
        raise ValueError("不支持的适用对象类型。")
    return value


def _normalize_reading_target_type(value: str) -> str:
    value = (value or "").strip().lower()
    if value not in READING_TARGET_TYPES:
        raise ValueError("不支持的推送对象类型。")
    return value


def _normalize_question_type(value: str) -> str:
    value = (value or "").strip().lower()
    value = QUESTION_TYPE_ALIASES.get(value, value)
    if value not in QUESTION_TYPES:
        raise ValueError("不支持的题型。")
    return value


def _normalize_video_source(value: str) -> str:
    value = (value or "upload").strip().lower()
    if value not in VIDEO_SOURCE_TYPES:
        raise ValueError("不支持的视频来源类型。")
    return value


def _normalize_image_source(value: str) -> str:
    value = (value or "upload").strip().lower()
    if value not in IMAGE_SOURCE_TYPES:
        raise ValueError("不支持的图片来源类型。")
    return value


def _ensure_status(value: str) -> str:
    value = (value or "draft").strip().lower()
    if value not in VIDEO_STATUSES:
        raise ValueError("不支持的视频状态。")
    return value


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


def _upload_binary_to_oss(object_key: str, content: bytes, mime_type: str) -> None:
    bucket = _build_oss_bucket()
    bucket.put_object(object_key, content, headers={"Content-Type": mime_type})


def _abort_multipart_upload(object_key: str, upload_id: str) -> None:
    bucket = _build_oss_bucket()
    bucket.abort_multipart_upload(object_key, upload_id)


def _delete_oss_object(object_key: str) -> None:
    bucket = _build_oss_bucket()
    bucket.delete_object(object_key)


def _normalize_upload_status(value: str) -> str:
    status = (value or "pending").strip().lower()
    if status not in VIDEO_UPLOAD_STATUSES:
        raise ValueError("不支持的上传状态。")
    return status


def _is_video_upload_ready(video: MagicVideo) -> bool:
    upload_status = (video.upload_status or "completed").strip().lower()
    if upload_status != "completed":
        return False
    if (video.storage_type or "local").strip().lower() == "oss":
        return bool((video.oss_object_key or "").strip())
    return bool((video.file_path or "").strip())


def _video_status_label(video: MagicVideo) -> str:
    status = (video.status or "draft").strip().lower()
    upload_status = (video.upload_status or "completed").strip().lower()
    if upload_status == "failed":
        return "上传失败"
    if upload_status in {"pending", "uploading"}:
        return "上传中"
    if status == "published":
        return "已发布"
    if status == "disabled":
        return "已下架"
    if upload_status == "completed":
        return "已上传未发布"
    return "草稿"


def _normalize_transcode_status(value: str) -> str:
    status = (value or "none").strip().lower()
    if status not in TRANSCODE_STATUSES:
        raise ValueError("不支持的转码状态。")
    return status


def _parse_answer(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, (list, tuple, set)):
        return [str(item).strip() for item in value if str(item).strip()]
    text = str(value).strip()
    if not text:
        return []
    parsed = _json_loads(text, None)
    if isinstance(parsed, (list, tuple, set)):
        return _parse_answer(parsed)
    if isinstance(parsed, str) and parsed != text:
        return _parse_answer(parsed)
    if parsed is not None and not isinstance(parsed, str):
        normalized = str(parsed).strip()
        return [normalized] if normalized else []
    if "\n" in text:
        return [item.strip() for item in text.splitlines() if item.strip()]
    if "," in text or "，" in text:
        normalized = text.replace("，", ",")
        return [item.strip() for item in normalized.split(",") if item.strip()]
    return [text]


def _question_options(question: MagicQuestion) -> list[str]:
    return _parse_answer(_json_loads(question.options_json, question.options_json))


def _question_correct_answers(question: MagicQuestion) -> list[str]:
    return _parse_answer(_json_loads(question.correct_answer_json, question.correct_answer_json))


def _normalize_multi(values: list[str]) -> list[str]:
    return sorted({(v or "").strip().lower() for v in values if (v or "").strip()})


def _score_answer(question: MagicQuestion, user_answer: Any) -> tuple[bool, float, list[str], list[str]]:
    qtype = (question.question_type or "").lower()
    correct = _question_correct_answers(question)
    answer = _parse_answer(user_answer)
    full_score = float(question.score or 100)

    if qtype in {"short", "short_answer"}:
        return True, full_score, answer, correct
    if qtype == "multiple":
        ok = _normalize_multi(answer) == _normalize_multi(correct)
        return ok, full_score if ok else 0.0, answer, correct
    if qtype in {"single", "judge"}:
        ok = ((answer[0] if answer else "").strip().lower() == (correct[0] if correct else "").strip().lower())
        return ok, full_score if ok else 0.0, answer, correct
    if qtype in {"blank", "fill"}:
        if not correct:
            return True, full_score, answer, correct
        normalized_answer = _normalize_multi(answer)
        normalized_correct = _normalize_multi(correct)
        ok = bool(normalized_answer) and bool(set(normalized_answer) & set(normalized_correct))
        return ok, full_score if ok else 0.0, answer, correct
    return False, 0.0, answer, correct


def _parse_month(month_text: str | None) -> tuple[date, date]:
    today = date.today()
    if month_text:
        try:
            year, month = [int(part) for part in month_text.split("-", 1)]
            month_start = date(year, month, 1)
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=400, detail="月份格式应为 YYYY-MM。") from exc
    else:
        month_start = date(today.year, today.month, 1)
    last_day = monthrange(month_start.year, month_start.month)[1]
    month_end = date(month_start.year, month_start.month, last_day)
    if month_start.year == today.year and month_start.month == today.month:
        month_end = min(month_end, today)
    return month_start, month_end


def _expected_days(month_start: date, month_end: date) -> int:
    return max((month_end - month_start).days + 1, 0)


def _month_last_day(month_start: date) -> date:
    return date(month_start.year, month_start.month, monthrange(month_start.year, month_start.month)[1])


def _serialize_audio_record(item: MagicAudioUpload, user_map: dict[int, User] | None = None) -> dict[str, Any]:
    owner = user_map.get(item.user_id) if user_map else None
    source = item.source or SOURCE_AUDIO_USER_UPLOAD
    source_label = (
        "补卡" if source == SOURCE_AUDIO_MAKEUP
        else "白名单自动打卡" if source == SOURCE_WHITELIST_AUTO
        else "用户上传"
    )
    return {
        "id": item.id,
        "user_id": item.user_id,
        "user_name": _user_name(owner) if owner else "",
        "department": (owner.department or "") if owner else "",
        "file_name": item.file_name or "",
        "file_size": int(item.file_size or 0),
        "file_type": item.mime_type or "",
        "remark": item.remark or "",
        "uploaded_date": _iso(item.uploaded_date),
        "uploaded_time": _iso(item.uploaded_on),
        "status": "已上传",
        "source": source,
        "source_label": source_label,
        "is_makeup": source == SOURCE_AUDIO_MAKEUP,
        "auto_checkin_by_whitelist": bool(item.auto_checkin_by_whitelist),
    }


def _build_audio_calendar_payload(
    month_start: date,
    month_last_day: date,
    uploads: list[MagicAudioUpload],
    user_map: dict[int, User] | None = None,
    aggregate_users: bool = False,
) -> list[dict[str, Any]]:
    grouped: dict[str, list[MagicAudioUpload]] = {}
    for item in uploads:
        key = item.uploaded_date.isoformat() if item.uploaded_date else None
        if not key:
            continue
        grouped.setdefault(key, []).append(item)
    today = date.today().isoformat()
    days: list[dict[str, Any]] = []
    cursor = month_start
    while cursor <= month_last_day:
        key = cursor.isoformat()
        items = grouped.get(key, [])
        uploaded_users = sorted({item.user_id for item in items})
        days.append({
            "date": key,
            "is_today": key == today,
            "is_future": key > today,
            "uploaded": bool(items),
            "count": len(items),
            "uploaded_user_count": len(uploaded_users),
            "records": [_serialize_audio_record(item, user_map) for item in items],
            "user_ids": uploaded_users if aggregate_users else [],
        })
        cursor += timedelta(days=1)
    return days


def _serialize_audio_makeup_setting(row: MagicAudioMakeupSetting | None) -> dict[str, Any]:
    return {
        "enabled": bool(row.enabled) if row else False,
        "make_up_days": int(row.make_up_days or 0) if row else DEFAULT_AUDIO_MAKEUP_DAYS,
        "description": (
            f"仅允许补最近 {int(row.make_up_days or 0)} 天内未完成的读书打卡"
            if row and bool(row.enabled) and int(row.make_up_days or 0) > 0
            else "当前未开启补卡"
        ),
    }


def _parse_form_id_list(value: str | None) -> list[int]:
    text = (value or "").strip()
    if not text:
        return []
    parsed = _json_loads(text, None)
    if isinstance(parsed, list):
        values = parsed
    else:
        values = [item.strip() for item in text.split(",") if item.strip()]
    ids: list[int] = []
    for item in values:
        try:
            number = int(item)
        except (TypeError, ValueError) as exc:
            raise HTTPException(status_code=400, detail="推送对象 ID 格式不正确。") from exc
        if number > 0:
            ids.append(number)
    return sorted(set(ids))


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


async def _get_audio_makeup_setting(
    db: AsyncSession,
    *,
    create: bool = False,
) -> MagicAudioMakeupSetting | None:
    result = await db.execute(
        select(MagicAudioMakeupSetting).order_by(MagicAudioMakeupSetting.id.asc()).limit(1)
    )
    row = result.scalar_one_or_none()
    if row or not create:
        return row
    row = MagicAudioMakeupSetting(enabled=False, make_up_days=DEFAULT_AUDIO_MAKEUP_DAYS)
    db.add(row)
    await db.flush()
    await db.refresh(row)
    return row


async def _has_audio_checkin_on_date(
    db: AsyncSession,
    user_id: int,
    target_date: date,
) -> bool:
    result = await db.execute(
        select(MagicAudioUpload.id).where(
            MagicAudioUpload.user_id == user_id,
            MagicAudioUpload.is_deleted.is_(False),
            MagicAudioUpload.uploaded_date == target_date,
        )
    )
    return result.scalar_one_or_none() is not None


def _evaluate_audio_makeup_date(
    target_date: date,
    *,
    today: date,
    setting: MagicAudioMakeupSetting | None,
    has_record: bool,
) -> tuple[bool, str]:
    if target_date > today:
        return False, "不能补未来日期。"
    if target_date == today:
        return False, "今日打卡请直接走正常打卡流程。"
    if not setting or not setting.enabled or int(setting.make_up_days or 0) <= 0:
        return False, "当前未开启补卡。"
    if has_record:
        return False, "该日期已完成打卡。"
    delta_days = (today - target_date).days
    if delta_days <= 0:
        return False, "不能补未来日期。"
    if delta_days > int(setting.make_up_days or 0):
        return False, "补卡时间已过期。"
    return True, ""


def _xlsx_response(filename: str, headers: list[str], rows: list[list[Any]]) -> StreamingResponse:
    try:
        from openpyxl import Workbook
    except ImportError as exc:
        raise HTTPException(status_code=500, detail="未安装 openpyxl，暂时无法导出 Excel。") from exc
    workbook = Workbook()
    sheet = workbook.active
    sheet.append(headers)
    for row in rows:
        sheet.append(row)
    output = BytesIO()
    workbook.save(output)
    output.seek(0)
    response = StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )
    response.headers["Content-Disposition"] = f'attachment; filename="{filename}"'
    return response


async def _get_video_or_404(db: AsyncSession, video_id: int) -> MagicVideo:
    video = await db.get(MagicVideo, video_id)
    if not video or video.deleted_at:
        raise HTTPException(status_code=404, detail="视频不存在。")
    return video


async def _get_progress(
    db: AsyncSession,
    user_id: int,
    video_id: int,
    create: bool = True,
) -> MagicVideoProgress | None:
    result = await db.execute(
        select(MagicVideoProgress).where(
            MagicVideoProgress.user_id == user_id,
            MagicVideoProgress.video_id == video_id,
        )
    )
    progress = result.scalar_one_or_none()
    if progress or not create:
        return progress
    progress = MagicVideoProgress(user_id=user_id, video_id=video_id)
    db.add(progress)
    await db.flush()
    return progress


def _reset_progress_for_quiz_version(progress: MagicVideoProgress, video: MagicVideo) -> None:
    progress.current_position = 0
    progress.max_watched_position = 0
    progress.progress_percent = 0
    progress.is_completed = False
    progress.completed_at = None
    progress.last_watched_at = None
    progress.total_duration = float(video.duration_seconds or progress.total_duration or 0)
    progress.quiz_passed = False
    progress.answered_point_ids_json = "[]"
    progress.quiz_version = int(video.quiz_version or 1)
    progress.answer_attempt_count = 0


async def _ensure_progress_quiz_version(
    db: AsyncSession,
    progress: MagicVideoProgress | None,
    video: MagicVideo,
) -> MagicVideoProgress | None:
    if not progress:
        return None
    current_version = int(video.quiz_version or 1)
    if int(progress.quiz_version or 0) <= 0:
        progress.quiz_version = current_version
        await db.flush()
        return progress
    if int(progress.quiz_version or 1) != current_version:
        _reset_progress_for_quiz_version(progress, video)
        await db.flush()
    return progress


async def _bump_video_quiz_version(db: AsyncSession, video_id: int) -> MagicVideo:
    video = await _get_video_or_404(db, video_id)
    video.quiz_version = int(video.quiz_version or 1) + 1
    await db.flush()
    return video


async def _get_video_targets(db: AsyncSession, video_ids: list[int]) -> dict[int, list[MagicVideoTarget]]:
    if not video_ids:
        return {}
    result = await db.execute(
        select(MagicVideoTarget).where(MagicVideoTarget.video_id.in_(video_ids)).order_by(MagicVideoTarget.id.asc())
    )
    mapping: dict[int, list[MagicVideoTarget]] = {}
    for item in result.scalars().all():
        mapping.setdefault(item.video_id, []).append(item)
    return mapping


async def _get_quiz_points_map(db: AsyncSession, video_ids: list[int]) -> dict[int, list[MagicVideoQuizPoint]]:
    if not video_ids:
        return {}
    result = await db.execute(
        select(MagicVideoQuizPoint)
        .where(MagicVideoQuizPoint.video_id.in_(video_ids))
        .order_by(MagicVideoQuizPoint.trigger_second.asc(), MagicVideoQuizPoint.id.asc())
    )
    mapping: dict[int, list[MagicVideoQuizPoint]] = {}
    for item in result.scalars().all():
        mapping.setdefault(item.video_id, []).append(item)
    return mapping


async def _get_questions_map(db: AsyncSession, point_ids: list[int]) -> dict[int, list[MagicQuestion]]:
    if not point_ids:
        return {}
    result = await db.execute(
        select(MagicQuestion)
        .where(MagicQuestion.quiz_point_id.in_(point_ids))
        .order_by(MagicQuestion.sort_order.asc(), MagicQuestion.id.asc())
    )
    mapping: dict[int, list[MagicQuestion]] = {}
    for item in result.scalars().all():
        mapping.setdefault(item.quiz_point_id, []).append(item)
    return mapping


async def _is_whitelisted(db: AsyncSession, video_id: int, user_id: int) -> bool:
    result = await db.execute(
        select(MagicVideoWhitelist.id).where(
            MagicVideoWhitelist.video_id == video_id,
            MagicVideoWhitelist.user_id == user_id,
        )
    )
    return result.scalar_one_or_none() is not None


def _can_seek_freely(video_whitelisted: bool, permissions: dict[str, Any]) -> bool:
    return bool(
        video_whitelisted
        or permissions.get("allow_video_seek")
        or permissions.get("course_exempt_enabled")
    )


def _build_progress_payload(
    video: MagicVideo,
    progress: MagicVideoProgress | None,
    permissions: dict[str, Any],
    *,
    video_whitelisted: bool = False,
) -> dict[str, Any] | None:
    if not progress and not permissions.get("course_exempt_enabled"):
        return None
    answered = _json_loads(progress.answered_point_ids_json, []) if progress else []
    current_position = float(progress.current_position or 0) if progress else 0.0
    max_watched_position = float(progress.max_watched_position or 0) if progress else 0.0
    total_duration = float(progress.total_duration or video.duration_seconds or 0) if progress else float(video.duration_seconds or 0)
    payload = {
        "current_position": current_position,
        "max_watched_position": max_watched_position,
        "progress_percent": float(progress.progress_percent or 0) if progress else 0.0,
        "is_completed": bool(progress.is_completed) if progress else False,
        "completed_at": _iso(progress.completed_at) if progress else None,
        "last_watched_at": _iso(progress.last_watched_at) if progress else None,
        "answered_point_ids": answered,
        "quiz_passed": bool(progress.quiz_passed) if progress else False,
        "answer_attempt_count": int(progress.answer_attempt_count or 0) if progress else 0,
        "source": (progress.progress_source or SOURCE_MANUAL) if progress else SOURCE_MANUAL,
        "completed_by_whitelist": bool(progress.completed_by_whitelist) if progress else False,
        "total_duration": total_duration,
    }
    if permissions.get("course_exempt_enabled"):
        payload["progress_percent"] = max(float(payload["progress_percent"] or 0), 100.0)
        payload["is_completed"] = True
        payload["quiz_passed"] = True
        payload["completed_by_whitelist"] = True
        payload["source"] = SOURCE_WHITELIST_EXEMPT
        if not payload["completed_at"]:
            payload["completed_at"] = _iso(_now())
    payload["can_seek_freely"] = _can_seek_freely(video_whitelisted, permissions) or payload["is_completed"]
    return payload


def _apply_whitelist_quiz_points(
    payload: dict[str, Any],
    permissions: dict[str, Any],
) -> None:
    if not permissions.get("course_exempt_enabled"):
        return
    quiz_points = payload.get("quiz_points") or []
    payload.setdefault("progress", {})
    payload["progress"]["answered_point_ids"] = [int(item["id"]) for item in quiz_points]
    payload["progress"]["quiz_passed"] = True


async def _ensure_auto_audio_checkin(
    db: AsyncSession,
    user: User,
    permissions: dict[str, Any],
) -> None:
    if not permissions.get("auto_checkin_enabled"):
        return
    today = date.today()
    existing = await db.execute(
        select(MagicAudioUpload.id).where(
            MagicAudioUpload.user_id == user.id,
            MagicAudioUpload.is_deleted.is_(False),
            MagicAudioUpload.uploaded_date == today,
        )
    )
    if existing.scalar_one_or_none() is not None:
        return
    row = MagicAudioUpload(
        user_id=user.id,
        file_name="whitelist_auto_checkin",
        file_path="",
        file_size=0,
        mime_type="",
        remark="白名单自动打卡",
        source=SOURCE_WHITELIST_AUTO,
        auto_checkin_by_whitelist=True,
        uploaded_on=_now(),
        uploaded_date=today,
        is_deleted=False,
    )
    db.add(row)
    await db.flush()


def _serialize_watch_confirm_setting(
    setting: MagicVideoWatchConfirmSetting | None,
    video_id: int | None = None,
) -> dict[str, Any]:
    return {
        "video_id": int(setting.video_id if setting else video_id or 0),
        "enabled": bool(setting.enabled) if setting else False,
        "interval_seconds": int(setting.interval_seconds or 300) if setting else 300,
        "message": (setting.message or WATCH_CONFIRM_DEFAULT_MESSAGE) if setting else WATCH_CONFIRM_DEFAULT_MESSAGE,
        "button_text": (setting.button_text or WATCH_CONFIRM_DEFAULT_BUTTON) if setting else WATCH_CONFIRM_DEFAULT_BUTTON,
    }


async def _get_watch_confirm_settings_map(
    db: AsyncSession,
    video_ids: list[int],
) -> dict[int, MagicVideoWatchConfirmSetting]:
    if not video_ids:
        return {}
    result = await db.execute(
        select(MagicVideoWatchConfirmSetting).where(MagicVideoWatchConfirmSetting.video_id.in_(video_ids))
    )
    return {item.video_id: item for item in result.scalars().all()}


def _is_effectively_completed(
    progress: MagicVideoProgress | None,
    permissions: dict[str, Any] | None = None,
) -> bool:
    if permissions and permissions.get("course_exempt_enabled"):
        return True
    return bool(progress and progress.is_completed)


async def _get_series_context_map(
    db: AsyncSession,
    video_ids: list[int],
    *,
    progress_map: dict[int, MagicVideoProgress] | None = None,
    whitelist_permissions: dict[str, Any] | None = None,
) -> dict[int, dict[str, Any]]:
    if not video_ids:
        return {}
    result = await db.execute(
        select(MagicVideoSeriesItem, MagicVideoSeries)
        .join(MagicVideoSeries, MagicVideoSeries.id == MagicVideoSeriesItem.series_id)
        .where(
            MagicVideoSeriesItem.video_id.in_(video_ids),
            MagicVideoSeries.is_deleted.is_(False),
        )
        .order_by(MagicVideoSeriesItem.sort_order.asc(), MagicVideoSeriesItem.id.asc())
    )
    rows = result.all()
    by_video: dict[int, dict[str, Any]] = {}
    series_items_map: dict[int, list[dict[str, Any]]] = {}
    for item, series in rows:
        payload = {
            "series_id": int(series.id),
            "series_title": series.title,
            "series_description": series.description or "",
            "series_enabled": bool(series.enabled),
            "series_order": int(item.sort_order or 0),
            "series_item_id": int(item.id),
            "sequential_unlock_enabled": bool(series.sequential_unlock_enabled),
            "video_id": int(item.video_id),
        }
        by_video[item.video_id] = payload
        series_items_map.setdefault(series.id, []).append(payload)

    permissions = whitelist_permissions or {}
    for video_id, payload in by_video.items():
        payload["previous_video_id"] = None
        payload["previous_video_completed"] = True
        payload["is_locked"] = False
        payload["locked_reason"] = ""
        if not payload["series_enabled"] or not payload["sequential_unlock_enabled"]:
            continue
        items = series_items_map.get(payload["series_id"], [])
        current_index = next((index for index, item in enumerate(items) if item["video_id"] == video_id), -1)
        if current_index <= 0:
            continue
        previous = items[current_index - 1]
        payload["previous_video_id"] = previous["video_id"]
        previous_completed = bool(progress_map is None) or _is_effectively_completed(
            (progress_map or {}).get(previous["video_id"]),
            permissions,
        )
        payload["previous_video_completed"] = previous_completed
        if permissions.get("course_exempt_enabled"):
            continue
        if not previous_completed:
            payload["is_locked"] = True
            payload["locked_reason"] = "请先完成上一节视频后再学习本节"
    return by_video


def _apply_series_payload(payload: dict[str, Any], series_meta: dict[str, Any] | None) -> dict[str, Any]:
    if not series_meta:
        payload.setdefault("series_id", None)
        payload.setdefault("series_title", "")
        payload.setdefault("series_description", "")
        payload.setdefault("series_order", None)
        payload.setdefault("series_enabled", False)
        payload.setdefault("sequential_unlock_enabled", False)
        payload.setdefault("previous_video_id", None)
        payload.setdefault("previous_video_completed", True)
        payload.setdefault("is_locked", False)
        payload.setdefault("locked_reason", "")
        return payload
    payload.update({
        "series_id": series_meta["series_id"],
        "series_title": series_meta["series_title"],
        "series_description": series_meta["series_description"],
        "series_order": series_meta["series_order"],
        "series_enabled": series_meta["series_enabled"],
        "sequential_unlock_enabled": series_meta["sequential_unlock_enabled"],
        "previous_video_id": series_meta["previous_video_id"],
        "previous_video_completed": series_meta["previous_video_completed"],
        "is_locked": series_meta["is_locked"],
        "locked_reason": series_meta["locked_reason"],
    })
    return payload


def _user_matches_target(user: User, target: MagicVideoTarget) -> bool:
    ttype = (target.target_type or "").lower()
    tvalue = (target.target_value or "").strip()
    if ttype == "all_users":
        return True
    if ttype == "all_newcomers":
        return bool(user.is_newcomer)
    if ttype == "department":
        return (user.department or "").strip() == tvalue
    if ttype == "position":
        return (user.position or "").strip() == tvalue
    if ttype == "role":
        return (user.role or "").strip() == tvalue
    if ttype == "user":
        return str(user.id) == tvalue
    return False


def _video_visible_to_user(video: MagicVideo, user: User, targets: list[MagicVideoTarget], whitelisted: bool) -> bool:
    if whitelisted:
        return True
    if (user.role or "").lower() == "admin":
        return True
    if (video.upload_status or "completed") != "completed":
        return False
    if video.status != "published":
        return False
    if video.is_newcomer_required and user.is_newcomer:
        return True
    if not targets:
        return True
    return any(_user_matches_target(user, target) for target in targets)


def _video_to_dict(
    video: MagicVideo,
    targets: list[MagicVideoTarget],
    progress: MagicVideoProgress | None = None,
    whitelisted: bool = False,
    whitelist_permissions: dict[str, Any] | None = None,
    series_meta: dict[str, Any] | None = None,
    watch_confirm_setting: MagicVideoWatchConfirmSetting | None = None,
) -> dict[str, Any]:
    permissions = whitelist_permissions or {}
    status = (video.status or "draft").strip().lower()
    upload_status = (video.upload_status or "completed").strip().lower()
    progress_payload = _build_progress_payload(video, progress, permissions, video_whitelisted=whitelisted)
    payload = {
        "id": video.id,
        "title": video.title,
        "description": video.description or "",
        "category": video.category or "",
        "file_name": video.file_name,
        "file_path": video.file_path,
        "original_filename": video.original_filename or video.file_name,
        "stored_filename": video.stored_filename or "",
        "storage_type": video.storage_type or "local",
        "oss_bucket": video.oss_bucket or "",
        "oss_endpoint": video.oss_endpoint or "",
        "oss_object_key": video.oss_object_key or "",
        "oss_url": video.oss_url or "",
        "cdn_url": video.cdn_url or "",
        "play_url": video.play_url or "",
        "hls_url": video.hls_url,
        "cover_url": video.cover_url,
        "mime_type": video.mime_type,
        "file_size": int(video.file_size or 0),
        "duration_seconds": int(video.duration_seconds or 0),
        "duration": int(video.duration or video.duration_seconds or 0),
        "is_required": bool(video.is_required),
        "is_newcomer_required": bool(video.is_newcomer_required),
        "deadline_at": _iso(video.deadline_at),
        "status": status,
        "status_label": _video_status_label(video),
        "upload_status": upload_status,
        "upload_error": video.upload_error or "",
        "transcode_status": video.transcode_status or "none",
        "material_asset_id": int(video.material_asset_id) if video.material_asset_id else None,
        "can_publish": status != "published" and _is_video_upload_ready(video),
        "can_disable": status == "published",
        "created_by": video.created_by,
        "created_at": _iso(video.created_at),
        "updated_at": _iso(video.updated_at),
        "deleted_at": _iso(video.deleted_at),
        "targets": [
            {"id": item.id, "target_type": item.target_type, "target_value": item.target_value}
            for item in targets
        ],
        "progress": progress_payload,
        "is_whitelisted": whitelisted,
        "whitelist_permissions": permissions,
        "can_seek_freely": bool(progress_payload["can_seek_freely"]) if progress_payload else _can_seek_freely(whitelisted, permissions),
        "watch_confirm_setting": _serialize_watch_confirm_setting(watch_confirm_setting, video.id),
    }
    return _apply_series_payload(payload, series_meta)


def _material_project_visible_to_admin(project: MaterialProject, user: User) -> bool:
    if is_super_admin(user):
        return True
    if int(project.created_by) == int(user.id):
        return True
    visibility = (project.visibility or "admin").strip().lower()
    return visibility in {"admin", "shared"}


async def _get_material_asset_or_403(
    db: AsyncSession,
    asset_id: int,
    admin: User,
    *,
    expected_type: str,
) -> MaterialAsset:
    result = await db.execute(
        select(MaterialAsset, MaterialProject)
        .join(MaterialProject, MaterialProject.id == MaterialAsset.project_id)
        .where(
            MaterialAsset.id == asset_id,
            MaterialAsset.is_deleted.is_(False),
            MaterialProject.is_deleted.is_(False),
        )
    )
    row = result.first()
    if not row:
        raise HTTPException(status_code=404, detail="素材不存在。")
    asset, project = row
    if asset.asset_type != expected_type:
        raise HTTPException(status_code=400, detail=f"所选素材不是{expected_type}类型。")
    if not _material_project_visible_to_admin(project, admin):
        raise HTTPException(status_code=403, detail="无权访问该素材。")
    return asset


async def _collect_target_users(db: AsyncSession, video: MagicVideo, targets: list[MagicVideoTarget]) -> list[User]:
    result = await db.execute(
        select(User).where(User.role == "user", User.disabled.is_(False)).order_by(User.id.asc())
    )
    users = result.scalars().all()
    if not targets and not video.is_newcomer_required:
        return users
    visible_users = []
    for user in users:
        if video.is_newcomer_required and user.is_newcomer:
            visible_users.append(user)
            continue
        if any(_user_matches_target(user, target) for target in targets):
            visible_users.append(user)
    unique: dict[int, User] = {}
    for item in visible_users:
        unique[item.id] = item
    return list(unique.values())


def _filter_stats_users(users: list[User], department: str | None = None, user_id: int | None = None) -> list[User]:
    filtered = users
    if department:
        filtered = [item for item in filtered if _department_matches_filter(item, department)]
    if user_id:
        filtered = [item for item in filtered if item.id == user_id]
    return filtered


def _build_export_filename(prefix: str, video_title: str, department: str | None = None, user_name: str | None = None) -> str:
    parts = [prefix, video_title]
    if department:
        parts.append("未分配部门" if department == UNASSIGNED_DEPARTMENT_FILTER else department)
    if user_name:
        parts.append(user_name)
    parts.append(date.today().isoformat())
    return _safe_filename("_".join(part.strip() for part in parts if (part or "").strip())) + ".xlsx"


async def _ensure_video_access(
    db: AsyncSession,
    video: MagicVideo,
    user: User,
    allow_admin: bool = True,
) -> tuple[list[MagicVideoTarget], bool]:
    targets_map = await _get_video_targets(db, [video.id])
    targets = targets_map.get(video.id, [])
    whitelisted = await _is_whitelisted(db, video.id, user.id)
    if allow_admin and (user.role or "").lower() == "admin":
        return targets, whitelisted
    if not _video_visible_to_user(video, user, targets, whitelisted):
        raise HTTPException(status_code=403, detail="无权访问该视频。")
    whitelist_permissions = await get_user_whitelist_permissions(db, user.id)
    series_context_map = await _get_series_context_map(
        db,
        [video.id],
        progress_map={
            item.video_id: item
            for item in (
                await db.execute(select(MagicVideoProgress).where(MagicVideoProgress.user_id == user.id))
            ).scalars().all()
        },
        whitelist_permissions=whitelist_permissions,
    )
    series_meta = series_context_map.get(video.id)
    if series_meta and series_meta.get("is_locked"):
        raise HTTPException(status_code=403, detail=series_meta.get("locked_reason") or "请先完成上一节视频。")
    return targets, whitelisted


def _series_to_dict(
    series: MagicVideoSeries,
    items: list[dict[str, Any]],
) -> dict[str, Any]:
    return {
        "id": int(series.id),
        "title": series.title,
        "description": series.description or "",
        "sequential_unlock_enabled": bool(series.sequential_unlock_enabled),
        "enabled": bool(series.enabled),
        "created_by": int(series.created_by),
        "created_at": _iso(series.created_at),
        "updated_at": _iso(series.updated_at),
        "items": items,
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
    await db.commit()
    await db.refresh(video)
    targets_map = await _get_video_targets(db, [video.id])
    return _video_to_dict(video, targets_map.get(video.id, []))


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
    targets_map = await _get_video_targets(db, [video.id])
    return _video_to_dict(video, targets_map.get(video.id, []))


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
    del admin
    video = await _get_video_or_404(db, video_id)
    next_file_name = payload.file_name.strip() or video.file_name
    next_file_path = payload.file_path.strip() or video.file_path
    video.title = payload.title.strip()
    video.description = payload.description.strip()
    video.category = payload.category.strip()
    video.file_name = next_file_name
    video.file_path = next_file_path
    video.original_filename = next_file_name
    video.stored_filename = Path(next_file_path).name if next_file_path else video.stored_filename
    video.storage_type = video.storage_type or "local"
    video.mime_type = payload.mime_type.strip() or video.mime_type
    video.file_size = int(payload.file_size or video.file_size or 0)
    video.duration_seconds = int(payload.duration_seconds or video.duration_seconds or 0)
    video.duration = int(payload.duration_seconds or video.duration or video.duration_seconds or 0)
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
    targets_map = await _get_video_targets(db, [video.id])
    return _video_to_dict(video, targets_map.get(video.id, []))


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
    await db.commit()
    await db.refresh(video)
    targets_map = await _get_video_targets(db, [video.id])
    return _video_to_dict(video, targets_map.get(video.id, []))


@router.post("/videos/{video_id}/disable")
async def disable_video(
    video_id: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    del admin
    video = await _get_video_or_404(db, video_id)
    video.status = "disabled"
    await db.commit()
    await db.refresh(video)
    targets_map = await _get_video_targets(db, [video.id])
    return _video_to_dict(video, targets_map.get(video.id, []))


async def _build_series_list(db: AsyncSession) -> list[dict[str, Any]]:
    result = await db.execute(
        select(MagicVideoSeries)
        .where(MagicVideoSeries.is_deleted.is_(False))
        .order_by(MagicVideoSeries.created_at.desc(), MagicVideoSeries.id.desc())
    )
    series_rows = result.scalars().all()
    if not series_rows:
        return []
    series_ids = [item.id for item in series_rows]
    items_result = await db.execute(
        select(MagicVideoSeriesItem, MagicVideo)
        .join(MagicVideo, MagicVideo.id == MagicVideoSeriesItem.video_id)
        .where(
            MagicVideoSeriesItem.series_id.in_(series_ids),
            MagicVideo.deleted_at.is_(None),
        )
        .order_by(MagicVideoSeriesItem.sort_order.asc(), MagicVideoSeriesItem.id.asc())
    )
    items_map: dict[int, list[dict[str, Any]]] = {}
    for item, video in items_result.all():
        items_map.setdefault(item.series_id, []).append({
            "id": int(item.id),
            "video_id": int(video.id),
            "title": video.title,
            "category": video.category or "",
            "sort_order": int(item.sort_order or 0),
            "status": video.status,
        })
    return [_series_to_dict(item, items_map.get(item.id, [])) for item in series_rows]


async def _get_series_detail(db: AsyncSession, series_id: int) -> dict[str, Any]:
    rows = await _build_series_list(db)
    row = next((item for item in rows if item["id"] == series_id), None)
    if not row:
        raise HTTPException(status_code=404, detail="系列不存在。")
    return row


@router.get("/admin/video-series")
async def list_video_series(
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> list[dict[str, Any]]:
    del admin
    return await _build_series_list(db)


@router.post("/admin/video-series")
async def create_video_series(
    payload: VideoSeriesPayload,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    row = MagicVideoSeries(
        title=payload.title.strip(),
        description=payload.description.strip(),
        sequential_unlock_enabled=payload.sequential_unlock_enabled,
        enabled=payload.enabled,
        created_by=admin.id,
        is_deleted=False,
    )
    db.add(row)
    await db.flush()
    await db.refresh(row)
    return await _get_series_detail(db, row.id)


@router.put("/admin/video-series/{series_id}")
async def update_video_series(
    series_id: int,
    payload: VideoSeriesPayload,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    del admin
    row = await db.get(MagicVideoSeries, series_id)
    if not row or row.is_deleted:
        raise HTTPException(status_code=404, detail="系列不存在。")
    row.title = payload.title.strip()
    row.description = payload.description.strip()
    row.sequential_unlock_enabled = payload.sequential_unlock_enabled
    row.enabled = payload.enabled
    await db.flush()
    await db.refresh(row)
    return await _get_series_detail(db, series_id)


@router.delete("/admin/video-series/{series_id}")
async def delete_video_series(
    series_id: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, bool]:
    del admin
    row = await db.get(MagicVideoSeries, series_id)
    if not row or row.is_deleted:
        raise HTTPException(status_code=404, detail="系列不存在。")
    await db.execute(sql_delete(MagicVideoSeriesItem).where(MagicVideoSeriesItem.series_id == series_id))
    row.is_deleted = True
    row.deleted_at = _now()
    await db.flush()
    return {"success": True}


@router.post("/admin/video-series/{series_id}/items")
async def add_video_series_item(
    series_id: int,
    payload: VideoSeriesAddItemPayload,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    del admin
    series = await db.get(MagicVideoSeries, series_id)
    if not series or series.is_deleted:
        raise HTTPException(status_code=404, detail="系列不存在。")
    video = await _get_video_or_404(db, payload.video_id)
    if video.deleted_at is not None:
        raise HTTPException(status_code=400, detail="视频已删除，不能加入系列。")
    exists = await db.execute(
        select(MagicVideoSeriesItem).where(MagicVideoSeriesItem.video_id == payload.video_id)
    )
    existing = exists.scalar_one_or_none()
    if existing and existing.series_id != series_id:
        raise HTTPException(status_code=400, detail="该视频已加入其他系列。")
    if existing:
        raise HTTPException(status_code=400, detail="该视频已在当前系列中。")
    current_max = await db.execute(
        select(func.max(MagicVideoSeriesItem.sort_order)).where(MagicVideoSeriesItem.series_id == series_id)
    )
    next_sort = int(current_max.scalar_one() or 0) + 10
    row = MagicVideoSeriesItem(
        series_id=series_id,
        video_id=payload.video_id,
        sort_order=int(payload.sort_order if payload.sort_order is not None else next_sort),
    )
    db.add(row)
    await db.flush()
    await db.refresh(row)
    return await _get_series_detail(db, series_id)


@router.put("/admin/video-series/{series_id}/items/reorder")
async def reorder_video_series_items(
    series_id: int,
    payload: VideoSeriesReorderPayload,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    del admin
    series = await db.get(MagicVideoSeries, series_id)
    if not series or series.is_deleted:
        raise HTTPException(status_code=404, detail="系列不存在。")
    result = await db.execute(
        select(MagicVideoSeriesItem)
        .where(MagicVideoSeriesItem.series_id == series_id)
        .order_by(MagicVideoSeriesItem.sort_order.asc(), MagicVideoSeriesItem.id.asc())
    )
    items = result.scalars().all()
    item_map = {item.video_id: item for item in items}
    if set(payload.video_ids) != set(item_map):
        raise HTTPException(status_code=400, detail="排序数据不完整。")
    for index, video_id in enumerate(payload.video_ids, start=1):
        item_map[video_id].sort_order = index * 10
    await db.flush()
    return await _get_series_detail(db, series_id)


@router.delete("/admin/video-series/{series_id}/items/{video_id}")
async def remove_video_series_item(
    series_id: int,
    video_id: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, bool]:
    del admin
    result = await db.execute(
        select(MagicVideoSeriesItem).where(
            MagicVideoSeriesItem.series_id == series_id,
            MagicVideoSeriesItem.video_id == video_id,
        )
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="系列视频关系不存在。")
    await db.delete(row)
    await db.flush()
    return {"success": True}


@router.get("/admin/videos/{video_id}/watch-confirm-setting")
async def get_watch_confirm_setting(
    video_id: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    del admin
    await _get_video_or_404(db, video_id)
    result = await db.execute(
        select(MagicVideoWatchConfirmSetting).where(MagicVideoWatchConfirmSetting.video_id == video_id)
    )
    row = result.scalar_one_or_none()
    return _serialize_watch_confirm_setting(row, video_id)


@router.put("/admin/videos/{video_id}/watch-confirm-setting")
async def update_watch_confirm_setting(
    video_id: int,
    payload: WatchConfirmSettingPayload,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    del admin
    await _get_video_or_404(db, video_id)
    result = await db.execute(
        select(MagicVideoWatchConfirmSetting).where(MagicVideoWatchConfirmSetting.video_id == video_id)
    )
    row = result.scalar_one_or_none()
    if not row:
        row = MagicVideoWatchConfirmSetting(video_id=video_id)
        db.add(row)
    row.enabled = payload.enabled
    row.interval_seconds = int(payload.interval_seconds or 300)
    row.message = (payload.message or WATCH_CONFIRM_DEFAULT_MESSAGE).strip() or WATCH_CONFIRM_DEFAULT_MESSAGE
    row.button_text = (payload.button_text or WATCH_CONFIRM_DEFAULT_BUTTON).strip() or WATCH_CONFIRM_DEFAULT_BUTTON
    await db.flush()
    await db.refresh(row)
    return _serialize_watch_confirm_setting(row, video_id)


@router.get("/videos/{video_id}/quiz-points")
async def list_quiz_points(
    video_id: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> list[dict[str, Any]]:
    del admin
    await _get_video_or_404(db, video_id)
    points_map = await _get_quiz_points_map(db, [video_id])
    points = points_map.get(video_id, [])
    questions_map = await _get_questions_map(db, [item.id for item in points])
    return [
        {
            "id": item.id,
            "video_id": item.video_id,
            "trigger_second": item.trigger_second,
            "question_count": item.question_count,
            "pass_score": item.pass_score,
            "enabled": bool(item.enabled),
            "questions": [
                {
                    "id": q.id,
                    "quiz_point_id": q.quiz_point_id,
                    "question_type": q.question_type,
                    "stem": q.stem,
                    "options": _question_options(q),
                    "correct_answers": _question_correct_answers(q),
                    "score": float(q.score or 0),
                    "sort_order": q.sort_order,
                    "is_required": bool(q.is_required),
                }
                for q in questions_map.get(item.id, [])
            ],
        }
        for item in points
    ]


@router.post("/videos/{video_id}/quiz-points")
async def create_quiz_point(
    video_id: int,
    payload: QuizPointPayload,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    del admin
    await _get_video_or_404(db, video_id)
    point = MagicVideoQuizPoint(
        video_id=video_id,
        trigger_second=payload.trigger_second,
        question_count=payload.question_count,
        pass_score=payload.pass_score,
        enabled=payload.enabled,
    )
    db.add(point)
    await db.flush()
    await _bump_video_quiz_version(db, video_id)
    return {
        "id": point.id,
        "video_id": point.video_id,
        "trigger_second": point.trigger_second,
        "question_count": point.question_count,
        "pass_score": point.pass_score,
        "enabled": bool(point.enabled),
    }


@router.put("/quiz-points/{point_id}")
async def update_quiz_point(
    point_id: int,
    payload: QuizPointPayload,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    del admin
    point = await db.get(MagicVideoQuizPoint, point_id)
    if not point:
        raise HTTPException(status_code=404, detail="答题节点不存在。")
    point.trigger_second = payload.trigger_second
    point.question_count = payload.question_count
    point.pass_score = payload.pass_score
    point.enabled = payload.enabled
    await db.flush()
    await _bump_video_quiz_version(db, point.video_id)
    return {
        "id": point.id,
        "video_id": point.video_id,
        "trigger_second": point.trigger_second,
        "question_count": point.question_count,
        "pass_score": point.pass_score,
        "enabled": bool(point.enabled),
    }


@router.delete("/quiz-points/{point_id}")
async def delete_quiz_point(
    point_id: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, bool]:
    del admin
    point = await db.get(MagicVideoQuizPoint, point_id)
    if not point:
        raise HTTPException(status_code=404, detail="答题节点不存在。")
    video_id = point.video_id
    await db.execute(sql_delete(MagicQuestion).where(MagicQuestion.quiz_point_id == point_id))
    await db.execute(sql_delete(MagicQuizAnswer).where(MagicQuizAnswer.quiz_point_id == point_id))
    await db.execute(sql_delete(MagicQuizPointPassRecord).where(MagicQuizPointPassRecord.quiz_point_id == point_id))
    await db.delete(point)
    await db.flush()
    await _bump_video_quiz_version(db, video_id)
    return {"success": True}


@router.get("/quiz-points/{point_id}/questions")
async def list_questions(
    point_id: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> list[dict[str, Any]]:
    del admin
    point = await db.get(MagicVideoQuizPoint, point_id)
    if not point:
        raise HTTPException(status_code=404, detail="答题节点不存在。")
    questions_map = await _get_questions_map(db, [point_id])
    return [
        {
            "id": q.id,
            "quiz_point_id": q.quiz_point_id,
            "question_type": q.question_type,
            "stem": q.stem,
            "options": _question_options(q),
            "correct_answers": _question_correct_answers(q),
            "score": float(q.score or 0),
            "sort_order": q.sort_order,
            "is_required": bool(q.is_required),
        }
        for q in questions_map.get(point_id, [])
    ]


@router.post("/quiz-points/{point_id}/questions")
async def create_question(
    point_id: int,
    payload: QuestionPayload,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    del admin
    point = await db.get(MagicVideoQuizPoint, point_id)
    if not point:
        raise HTTPException(status_code=404, detail="答题节点不存在。")
    count_result = await db.execute(
        select(func.count(MagicQuestion.id)).where(MagicQuestion.quiz_point_id == point_id)
    )
    next_sort_order = int(count_result.scalar_one() or 0)
    question = MagicQuestion(
        quiz_point_id=point_id,
        question_type=payload.question_type,
        stem=payload.stem.strip(),
        options_json=_json_dumps(payload.options),
        correct_answer_json=_json_dumps(payload.correct_answers),
        score=payload.score,
        sort_order=payload.sort_order or next_sort_order,
        is_required=payload.is_required,
    )
    db.add(question)
    await db.flush()
    result = await db.execute(select(func.count(MagicQuestion.id)).where(MagicQuestion.quiz_point_id == point_id))
    point.question_count = int(result.scalar_one() or 0)
    await db.flush()
    await _bump_video_quiz_version(db, point.video_id)
    return {
        "id": question.id,
        "quiz_point_id": question.quiz_point_id,
        "question_type": question.question_type,
        "stem": question.stem,
        "options": payload.options,
        "correct_answers": payload.correct_answers,
        "score": float(question.score or 0),
        "sort_order": question.sort_order,
        "is_required": bool(question.is_required),
    }


@router.put("/questions/{question_id}")
async def update_question(
    question_id: int,
    payload: QuestionPayload,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    del admin
    question = await db.get(MagicQuestion, question_id)
    if not question:
        raise HTTPException(status_code=404, detail="题目不存在。")
    question.question_type = payload.question_type
    question.stem = payload.stem.strip()
    question.options_json = _json_dumps(payload.options)
    question.correct_answer_json = _json_dumps(payload.correct_answers)
    question.score = payload.score
    question.sort_order = payload.sort_order or question.sort_order or 0
    question.is_required = payload.is_required
    await db.flush()
    point = await db.get(MagicVideoQuizPoint, question.quiz_point_id)
    if point:
        await _bump_video_quiz_version(db, point.video_id)
    return {
        "id": question.id,
        "quiz_point_id": question.quiz_point_id,
        "question_type": question.question_type,
        "stem": question.stem,
        "options": payload.options,
        "correct_answers": payload.correct_answers,
        "score": float(question.score or 0),
        "sort_order": question.sort_order,
        "is_required": bool(question.is_required),
    }


@router.delete("/questions/{question_id}")
async def delete_question(
    question_id: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, bool]:
    del admin
    question = await db.get(MagicQuestion, question_id)
    if not question:
        raise HTTPException(status_code=404, detail="题目不存在。")
    point = await db.get(MagicVideoQuizPoint, question.quiz_point_id)
    await db.execute(sql_delete(MagicQuizAnswer).where(MagicQuizAnswer.question_id == question_id))
    await db.delete(question)
    await db.flush()
    if point:
        result = await db.execute(
            select(func.count(MagicQuestion.id)).where(MagicQuestion.quiz_point_id == point.id)
        )
        point.question_count = int(result.scalar_one() or 0)
        await db.flush()
        await _bump_video_quiz_version(db, point.video_id)
    return {"success": True}


@router.get("/my/videos")
async def list_my_videos(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[dict[str, Any]]:
    whitelist_permissions = await get_user_whitelist_permissions(db, user.id)
    result = await db.execute(
        select(MagicVideo).where(MagicVideo.deleted_at.is_(None)).order_by(desc(MagicVideo.created_at))
    )
    videos = result.scalars().all()
    video_ids = [item.id for item in videos]
    targets_map = await _get_video_targets(db, [item.id for item in videos])
    progress_result = await db.execute(
        select(MagicVideoProgress).where(MagicVideoProgress.user_id == user.id)
    )
    progress_map = {item.video_id: item for item in progress_result.scalars().all()}
    series_context_map = await _get_series_context_map(
        db,
        video_ids,
        progress_map=progress_map,
        whitelist_permissions=whitelist_permissions,
    )
    watch_confirm_settings = await _get_watch_confirm_settings_map(db, video_ids)
    output = []
    for video in videos:
        targets = targets_map.get(video.id, [])
        whitelisted = await _is_whitelisted(db, video.id, user.id)
        if not _video_visible_to_user(video, user, targets, whitelisted):
            continue
        output.append(
            _video_to_dict(
                video,
                targets,
                progress_map.get(video.id),
                whitelisted,
                whitelist_permissions,
                series_context_map.get(video.id),
                watch_confirm_settings.get(video.id),
            )
        )
    return output


@router.get("/my/videos/{video_id}")
async def get_my_video_detail(
    video_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    whitelist_permissions = await get_user_whitelist_permissions(db, user.id)
    video = await _get_video_or_404(db, video_id)
    targets, whitelisted = await _ensure_video_access(db, video, user)
    progress = await _get_progress(db, user.id, video_id, create=False)
    progress = await _ensure_progress_quiz_version(db, progress, video)
    all_progress_result = await db.execute(
        select(MagicVideoProgress).where(MagicVideoProgress.user_id == user.id)
    )
    all_progress_map = {item.video_id: item for item in all_progress_result.scalars().all()}
    points_map = await _get_quiz_points_map(db, [video_id])
    points = points_map.get(video_id, [])
    questions_map = await _get_questions_map(db, [item.id for item in points])
    series_context_map = await _get_series_context_map(
        db,
        [video_id],
        progress_map=all_progress_map,
        whitelist_permissions=whitelist_permissions,
    )
    watch_confirm_settings = await _get_watch_confirm_settings_map(db, [video_id])
    payload = _video_to_dict(
        video,
        targets,
        progress,
        whitelisted,
        whitelist_permissions,
        series_context_map.get(video_id),
        watch_confirm_settings.get(video_id),
    )
    payload["stream_url"] = f"/api/magic-academy/videos/{video_id}/stream"
    payload["quiz_points"] = [
        {
            "id": point.id,
            "trigger_second": point.trigger_second,
            "question_count": point.question_count,
            "pass_score": point.pass_score,
            "enabled": bool(point.enabled),
            "questions": [
                {
                    "id": q.id,
                    "question_type": q.question_type,
                    "stem": q.stem,
                    "options": _question_options(q),
                    "score": float(q.score or 0),
                    "sort_order": q.sort_order,
                    "is_required": bool(q.is_required),
                }
                for q in questions_map.get(point.id, [])
            ],
        }
        for point in points
    ]
    _apply_whitelist_quiz_points(payload, whitelist_permissions)
    return payload


@router.get("/videos/{video_id}/stream", response_model=None)
async def stream_video(
    video_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> FileResponse | RedirectResponse:
    video = await _get_video_or_404(db, video_id)
    await _ensure_video_access(db, video, user)
    if (video.storage_type or "local") == "oss" and video.oss_object_key:
        signed_url = await asyncio.to_thread(_build_signed_stream_url, video.oss_object_key)
        return RedirectResponse(signed_url, status_code=307)
    path = UPLOAD_ROOT / video.file_path
    if not path.exists():
        raise HTTPException(status_code=404, detail="视频文件不存在。")
    return FileResponse(path, media_type=video.mime_type or "video/mp4", filename=video.file_name)


@router.post("/my/videos/{video_id}/progress")
async def save_my_video_progress(
    video_id: int,
    payload: ProgressPayload,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    whitelist_permissions = await get_user_whitelist_permissions(db, user.id)
    video = await _get_video_or_404(db, video_id)
    targets, whitelisted = await _ensure_video_access(db, video, user)
    progress = await _get_progress(db, user.id, video_id, create=True)
    progress = await _ensure_progress_quiz_version(db, progress, video)
    all_progress_result = await db.execute(
        select(MagicVideoProgress).where(MagicVideoProgress.user_id == user.id)
    )
    all_progress_map = {item.video_id: item for item in all_progress_result.scalars().all()}
    duration = max(float(payload.duration_seconds or video.duration_seconds or progress.total_duration or 0), 0)
    progress.total_duration = duration
    progress.current_position = min(max(float(payload.current_position or 0), 0), duration or float(payload.current_position or 0))
    allowed_max = max(float(progress.max_watched_position or 0), float(payload.max_watched_position or 0))
    if not _can_seek_freely(whitelisted, whitelist_permissions) and duration > 0:
        allowed_max = min(allowed_max, duration)
    progress.max_watched_position = allowed_max
    progress.progress_percent = round((allowed_max / duration) * 100, 2) if duration > 0 else 0
    progress.progress_source = progress.progress_source or SOURCE_MANUAL
    if payload.page_visible:
        progress.last_watched_at = _now()
    answered = set(_json_loads(progress.answered_point_ids_json, []))
    point_result = await db.execute(
        select(MagicVideoQuizPoint.id)
        .where(MagicVideoQuizPoint.video_id == video_id, MagicVideoQuizPoint.enabled.is_(True))
    )
    required_point_ids = {int(item[0]) for item in point_result.all()}
    progress.quiz_passed = answered.issuperset(required_point_ids)
    if whitelist_permissions.get("course_exempt_enabled"):
        progress.quiz_passed = True
    near_end = duration > 0 and allowed_max >= max(duration - 1.5, duration * 0.98)
    if _can_seek_freely(whitelisted, whitelist_permissions):
        near_end = duration > 0 and progress.current_position >= 0
    if whitelist_permissions.get("course_exempt_enabled"):
        progress.is_completed = True
        progress.completed_by_whitelist = True
        progress.progress_source = SOURCE_WHITELIST_EXEMPT
        if not progress.completed_at:
            progress.completed_at = _now()
    elif near_end and progress.quiz_passed and video.status == "published":
        progress.is_completed = True
        if not progress.completed_at:
            progress.completed_at = _now()
    await db.flush()
    series_context_map = await _get_series_context_map(
        db,
        [video_id],
        progress_map=all_progress_map,
        whitelist_permissions=whitelist_permissions,
    )
    watch_confirm_settings = await _get_watch_confirm_settings_map(db, [video_id])
    return _video_to_dict(
        video,
        targets,
        progress,
        whitelisted,
        whitelist_permissions,
        series_context_map.get(video_id),
        watch_confirm_settings.get(video_id),
    )


@router.post("/my/videos/{video_id}/submit-quiz")
async def submit_my_video_quiz(
    video_id: int,
    payload: QuizSubmitPayload,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    whitelist_permissions = await get_user_whitelist_permissions(db, user.id)
    video = await _get_video_or_404(db, video_id)
    _, whitelisted = await _ensure_video_access(db, video, user)
    point = await db.get(MagicVideoQuizPoint, payload.quiz_point_id)
    if not point or point.video_id != video_id:
        raise HTTPException(status_code=404, detail="答题节点不存在。")
    questions_map = await _get_questions_map(db, [point.id])
    questions = questions_map.get(point.id, [])
    progress = await _get_progress(db, user.id, video_id, create=True)
    progress = await _ensure_progress_quiz_version(db, progress, video)
    attempt_result = await db.execute(
        select(func.count(MagicQuizPointPassRecord.id)).where(
            MagicQuizPointPassRecord.user_id == user.id,
            MagicQuizPointPassRecord.video_id == video_id,
            MagicQuizPointPassRecord.quiz_point_id == point.id,
        )
    )
    attempt_no = int(attempt_result.scalar_one() or 0) + 1

    answer_map = {item.question_id: item.answer for item in payload.answers}
    rows = []
    auto_correct = bool(whitelist_permissions.get("auto_answer_correct") or (whitelisted and payload.skip_by_whitelist))
    if auto_correct:
        for question in questions:
            rows.append({
                "question_id": question.id,
                "stem": question.stem,
                "user_answer": [],
                "correct_answer": _question_correct_answers(question),
                "is_correct": True,
                "score": float(question.score or 100),
            })
    else:
        for question in questions:
            is_correct, score, answer, correct = _score_answer(question, answer_map.get(question.id))
            rows.append({
                "question_id": question.id,
                "stem": question.stem,
                "user_answer": answer,
                "correct_answer": correct,
                "is_correct": is_correct,
                "score": float(score),
            })

    total_score = 0.0
    total_possible = 0.0
    for item, question in zip(rows, questions, strict=False):
        score = float(item["score"])
        total_score += score
        total_possible += float(question.score or 100)
        db.add(
            MagicQuizAnswer(
                user_id=user.id,
                video_id=video_id,
                quiz_point_id=point.id,
                question_id=question.id,
                attempt_no=attempt_no,
                answer_json=_json_dumps(item["user_answer"]),
                correct_answer_json=_json_dumps(item["correct_answer"]),
                is_correct=item["is_correct"],
                score=score,
                answer_source=SOURCE_WHITELIST_AUTO_CORRECT if auto_correct else SOURCE_MANUAL,
                auto_correct_by_whitelist=auto_correct,
            )
        )
    final_score = round((total_score / total_possible) * 100, 2) if total_possible > 0 else 100.0
    all_correct = bool(rows) and all(bool(item["is_correct"]) for item in rows)
    passed = auto_correct or all_correct
    db.add(
        MagicQuizPointPassRecord(
            user_id=user.id,
            video_id=video_id,
            quiz_point_id=point.id,
            attempt_no=attempt_no,
            score=final_score,
            passed=passed,
            source=SOURCE_WHITELIST_AUTO_CORRECT if auto_correct else SOURCE_MANUAL,
            passed_at=_now() if passed else None,
        )
    )
    answered = set(_json_loads(progress.answered_point_ids_json, []))
    if passed:
        answered.add(point.id)
    progress.answered_point_ids_json = _json_dumps(sorted(answered))
    progress.answer_attempt_count = int(progress.answer_attempt_count or 0) + 1
    point_result = await db.execute(
        select(MagicVideoQuizPoint.id).where(
            MagicVideoQuizPoint.video_id == video_id,
            MagicVideoQuizPoint.enabled.is_(True),
        )
    )
    required_point_ids = {int(item[0]) for item in point_result.all()}
    progress.quiz_passed = answered.issuperset(required_point_ids) or whitelist_permissions.get("course_exempt_enabled")
    if progress.total_duration > 0 and progress.max_watched_position >= max(progress.total_duration - 1.5, progress.total_duration * 0.98) and progress.quiz_passed:
        progress.is_completed = True
        progress.completed_at = progress.completed_at or _now()
    await db.flush()
    return {
        "quiz_point_id": point.id,
        "attempt_no": attempt_no,
        "score": final_score,
        "passed": passed,
        "required_score": 100,
        "details": rows,
    }


@router.post("/my/videos/{video_id}/watch-confirm")
async def create_watch_confirm_log(
    video_id: int,
    payload: WatchConfirmLogPayload,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    video = await _get_video_or_404(db, video_id)
    await _ensure_video_access(db, video, user)
    row = MagicVideoWatchConfirmLog(
        user_id=user.id,
        video_id=video_id,
        progress_seconds=float(payload.progress_seconds or 0),
        confirm_round=int(payload.confirm_round or 1),
        confirmed_at=_now(),
    )
    db.add(row)
    await db.flush()
    return {
        "id": int(row.id),
        "video_id": int(video_id),
        "progress_seconds": float(row.progress_seconds or 0),
        "confirm_round": int(row.confirm_round or 1),
        "confirmed_at": _iso(row.confirmed_at),
    }


@router.get("/videos/{video_id}/stats")
async def get_video_stats(
    video_id: int,
    department: str | None = None,
    user_id: int | None = None,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> list[dict[str, Any]]:
    del admin
    video = await _get_video_or_404(db, video_id)
    targets_map = await _get_video_targets(db, [video_id])
    targets = targets_map.get(video_id, [])
    users = _filter_stats_users(await _collect_target_users(db, video, targets), department, user_id)
    if not users:
        return []
    user_ids = [item.id for item in users]
    progress_result = await db.execute(
        select(MagicVideoProgress).where(
            MagicVideoProgress.video_id == video_id,
            MagicVideoProgress.user_id.in_(user_ids),
        )
    )
    progress_map = {item.user_id: item for item in progress_result.scalars().all()}
    whitelist_result = await db.execute(
        select(MagicVideoWhitelist).where(
            MagicVideoWhitelist.video_id == video_id,
            MagicVideoWhitelist.user_id.in_(user_ids),
        )
    )
    whitelist_user_ids = {item.user_id for item in whitelist_result.scalars().all()}
    user_whitelist_result = await db.execute(
        select(UserWhitelist).where(UserWhitelist.user_id.in_(user_ids), UserWhitelist.enabled.is_(True))
    )
    user_whitelist_map = {item.user_id: item for item in user_whitelist_result.scalars().all()}
    rows = []
    for item in users:
        progress = progress_map.get(item.id)
        whitelist_entry = user_whitelist_map.get(item.id)
        course_exempt_enabled = bool(whitelist_entry and whitelist_entry.course_exempt_enabled)
        watched = min(float(progress.max_watched_position or 0), float(video.duration_seconds or progress.total_duration or 0)) if progress else 0
        rows.append({
            "user_id": item.id,
            "name": _user_name(item),
            "department": _user_department(item),
            "position": item.position or "",
            "video_name": video.title,
            "video_duration_seconds": int(video.duration_seconds or 0),
            "watched_seconds": round(watched, 2),
            "progress_percent": 100.0 if course_exempt_enabled else float(progress.progress_percent or 0) if progress else 0,
            "is_completed": True if course_exempt_enabled else bool(progress.is_completed) if progress else False,
            "completed_at": _iso(progress.completed_at) if progress else (_iso(_now()) if course_exempt_enabled else None),
            "quiz_passed": True if course_exempt_enabled else bool(progress.quiz_passed) if progress else False,
            "answer_attempt_count": int(progress.answer_attempt_count or 0) if progress else 0,
            "last_watched_at": _iso(progress.last_watched_at) if progress else None,
            "is_whitelist_user": item.id in whitelist_user_ids,
            "completed_by_whitelist": course_exempt_enabled,
            "progress_source": SOURCE_WHITELIST_EXEMPT if course_exempt_enabled else (progress.progress_source if progress else SOURCE_MANUAL),
        })
    return rows


@router.get("/videos/{video_id}/answers")
async def get_video_answer_details(
    video_id: int,
    department: str | None = None,
    user_id: int | None = None,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> list[dict[str, Any]]:
    del admin
    video = await _get_video_or_404(db, video_id)
    targets_map = await _get_video_targets(db, [video_id])
    targets = targets_map.get(video_id, [])
    users = _filter_stats_users(await _collect_target_users(db, video, targets), department, user_id)
    if not users:
        return []
    user_ids = [item.id for item in users]
    answer_result = await db.execute(
        select(MagicQuizAnswer, User, MagicVideoQuizPoint, MagicQuestion, MagicVideo)
        .join(User, User.id == MagicQuizAnswer.user_id)
        .join(MagicVideoQuizPoint, MagicVideoQuizPoint.id == MagicQuizAnswer.quiz_point_id)
        .join(MagicQuestion, MagicQuestion.id == MagicQuizAnswer.question_id)
        .join(MagicVideo, MagicVideo.id == MagicQuizAnswer.video_id)
        .where(MagicQuizAnswer.video_id == video_id, MagicQuizAnswer.user_id.in_(user_ids))
        .order_by(MagicQuizAnswer.submitted_at.desc())
    )
    rows = []
    for answer, user, point, question, video in answer_result.all():
        rows.append({
            "name": _user_name(user),
            "department": _user_department(user),
            "video_name": video.title,
            "quiz_point": point.trigger_second,
            "question": question.stem,
            "user_answer": _json_loads(answer.answer_json, []),
            "correct_answer": _parse_answer(_json_loads(answer.correct_answer_json, answer.correct_answer_json)),
            "is_correct": bool(answer.is_correct),
            "score": float(answer.score or 0),
            "submitted_at": _iso(answer.submitted_at),
            "attempt_no": answer.attempt_no,
            "answer_source": answer.answer_source or SOURCE_MANUAL,
            "auto_correct_by_whitelist": bool(answer.auto_correct_by_whitelist),
        })
    return rows


@router.get("/videos/{video_id}/export-progress")
async def export_video_progress(
    video_id: int,
    department: str | None = None,
    user_id: int | None = None,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> StreamingResponse:
    rows = await get_video_stats(video_id, department, user_id, db, admin)
    video = await _get_video_or_404(db, video_id)
    user_name = None
    if user_id:
        target = await db.get(User, user_id)
        user_name = _user_name(target) if target and target.role == "user" else None
    export_rows = [
        [
            item["name"],
            item["department"],
            item["video_name"],
            item["video_duration_seconds"],
            item["watched_seconds"],
            item["progress_percent"],
            "是" if item["is_completed"] else "否",
            item["completed_at"] or "",
            "是" if item["quiz_passed"] else "否",
            item["answer_attempt_count"],
            item["last_watched_at"] or "",
            "是" if item["is_whitelist_user"] else "否",
        ]
        for item in rows
    ]
    return _xlsx_response(
        _build_export_filename("视频学习统计", video.title, department, user_name),
        ["姓名", "部门", "视频名称", "视频总时长", "已观看时长", "观看进度百分比", "是否完成", "完成时间", "答题是否通过", "答题次数", "最后观看时间", "是否白名单"],
        export_rows,
    )


@router.get("/videos/{video_id}/export-answers")
async def export_video_answers(
    video_id: int,
    department: str | None = None,
    user_id: int | None = None,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> StreamingResponse:
    rows = await get_video_answer_details(video_id, department, user_id, db, admin)
    video = await _get_video_or_404(db, video_id)
    user_name = None
    if user_id:
        target = await db.get(User, user_id)
        user_name = _user_name(target) if target and target.role == "user" else None
    export_rows = [
        [
            item["name"],
            item["department"],
            item["video_name"],
            item["quiz_point"],
            item["question"],
            " / ".join(item["user_answer"]),
            " / ".join(item["correct_answer"]),
            "是" if item["is_correct"] else "否",
            item["score"],
            item["submitted_at"] or "",
            item["attempt_no"],
        ]
        for item in rows
    ]
    return _xlsx_response(
        _build_export_filename("答题详情", video.title, department, user_name),
        ["姓名", "部门", "视频名称", "答题节点", "题目", "用户答案", "正确答案", "是否正确", "得分", "提交时间", "第几次提交"],
        export_rows,
    )


@router.get("/video-whitelist")
async def list_video_whitelist(
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_super_admin),
) -> list[dict[str, Any]]:
    del admin
    result = await db.execute(
        select(MagicVideoWhitelist, MagicVideo, User)
        .join(MagicVideo, MagicVideo.id == MagicVideoWhitelist.video_id)
        .join(User, User.id == MagicVideoWhitelist.user_id)
        .order_by(desc(MagicVideoWhitelist.created_at))
    )
    return [
        {
            "id": whitelist.id,
            "video_id": whitelist.video_id,
            "video_title": video.title,
            "user_id": target.id,
            "user_name": _user_name(target),
            "department": target.department or "",
            "note": whitelist.note or "",
            "created_at": _iso(whitelist.created_at),
        }
        for whitelist, video, target in result.all()
    ]


@router.post("/video-whitelist")
async def create_video_whitelist(
    payload: VideoWhitelistCreatePayload,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_super_admin),
) -> dict[str, Any]:
    await _get_video_or_404(db, payload.video_id)
    target = await db.get(User, payload.user_id)
    if not target:
        raise HTTPException(status_code=404, detail="用户不存在。")
    row = MagicVideoWhitelist(
        video_id=payload.video_id,
        user_id=payload.user_id,
        note=payload.note.strip(),
        created_by=admin.id,
    )
    db.add(row)
    try:
        await db.flush()
    except IntegrityError as exc:
        raise HTTPException(status_code=409, detail="该用户已在白名单中。") from exc
    video = await _get_video_or_404(db, payload.video_id)
    return {
        "id": row.id,
        "video_id": row.video_id,
        "video_title": video.title,
        "user_id": target.id,
        "user_name": _user_name(target),
        "department": target.department or "",
        "note": row.note or "",
        "created_at": _iso(row.created_at),
    }


@router.delete("/video-whitelist/{whitelist_id}")
async def delete_video_whitelist(
    whitelist_id: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_super_admin),
) -> dict[str, bool]:
    del admin
    row = await db.get(MagicVideoWhitelist, whitelist_id)
    if not row:
        raise HTTPException(status_code=404, detail="白名单记录不存在。")
    await db.delete(row)
    await db.flush()
    return {"success": True}


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


@router.get("/my/audios")
async def list_my_audios(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[dict[str, Any]]:
    whitelist_permissions = await get_user_whitelist_permissions(db, user.id)
    await _ensure_auto_audio_checkin(db, user, whitelist_permissions)
    result = await db.execute(
        select(MagicAudioUpload)
        .where(MagicAudioUpload.user_id == user.id, MagicAudioUpload.is_deleted.is_(False))
        .order_by(desc(MagicAudioUpload.uploaded_on))
    )
    return [_serialize_audio_record(item) for item in result.scalars().all()]


@router.get("/admin/audio-makeup-setting")
async def get_audio_makeup_setting(
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    del admin
    row = await _get_audio_makeup_setting(db)
    return _serialize_audio_makeup_setting(row)


@router.put("/admin/audio-makeup-setting")
async def update_audio_makeup_setting(
    payload: AudioMakeupSettingPayload,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    row = await _get_audio_makeup_setting(db, create=True)
    if not row:
        raise HTTPException(status_code=500, detail="补卡设置初始化失败。")
    row.enabled = payload.enabled
    row.make_up_days = int(payload.make_up_days or 0)
    row.updated_by = admin.id
    await db.flush()
    await db.refresh(row)
    return _serialize_audio_makeup_setting(row)


@router.get("/my/audios/makeup-options")
async def get_my_audio_makeup_options(
    month: str | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    whitelist_permissions = await get_user_whitelist_permissions(db, user.id)
    await _ensure_auto_audio_checkin(db, user, whitelist_permissions)
    setting = await _get_audio_makeup_setting(db)
    month_start, _ = _parse_month(month)
    month_last_day = _month_last_day(month_start)
    result = await db.execute(
        select(MagicAudioUpload)
        .where(
            MagicAudioUpload.user_id == user.id,
            MagicAudioUpload.is_deleted.is_(False),
            MagicAudioUpload.uploaded_date >= month_start,
            MagicAudioUpload.uploaded_date <= month_last_day,
        )
        .order_by(MagicAudioUpload.uploaded_on.asc())
    )
    uploads = result.scalars().all()
    uploaded_dates = {item.uploaded_date for item in uploads if item.uploaded_date}
    today = date.today()
    days = []
    cursor = month_start
    while cursor <= month_last_day:
        can_makeup, reason = _evaluate_audio_makeup_date(
            cursor,
            today=today,
            setting=setting,
            has_record=cursor in uploaded_dates,
        )
        days.append({
            "date": cursor.isoformat(),
            "can_makeup": can_makeup,
            "reason": reason,
            "has_record": cursor in uploaded_dates,
            "is_future": cursor > today,
            "is_expired": bool(reason == "补卡时间已过期。"),
        })
        cursor += timedelta(days=1)
    return {
        "month": month_start.strftime("%Y-%m"),
        "setting": _serialize_audio_makeup_setting(setting),
        "days": days,
    }


@router.post("/my/audios")
async def upload_my_audio(
    payload: MagicAudioUploadPayload,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    suffix = Path(payload.file_name or "").suffix.lower()
    if suffix not in AUDIO_EXTENSIONS:
        raise HTTPException(status_code=400, detail="音频格式不支持。")
    if int(payload.file_size or 0) > MAX_AUDIO_SIZE:
        raise HTTPException(status_code=400, detail="单个录音文件不能超过 50MB。")
    safe_name = _safe_filename(payload.file_name or f"audio{suffix}")
    now = _now()
    row = MagicAudioUpload(
        user_id=user.id,
        file_name=safe_name,
        file_path="",
        file_size=int(payload.file_size or 0),
        mime_type=(payload.mime_type or mimetypes.guess_type(safe_name)[0] or suffix.lstrip(".")).strip(),
        remark=(payload.remark or "").strip(),
        source=SOURCE_AUDIO_USER_UPLOAD,
        auto_checkin_by_whitelist=False,
        uploaded_on=now,
        uploaded_date=now.date(),
        is_deleted=False,
    )
    db.add(row)
    await db.flush()
    return {
        "id": row.id,
        "file_name": row.file_name,
        "file_size": int(row.file_size or 0),
        "file_type": row.mime_type,
        "remark": row.remark or "",
        "uploaded_date": _iso(row.uploaded_date),
        "uploaded_time": _iso(row.uploaded_on),
        "status": "已上传",
        "source": SOURCE_AUDIO_USER_UPLOAD,
        "source_label": "用户上传",
    }


@router.post("/my/audios/makeup")
async def submit_my_audio_makeup(
    payload: AudioMakeupPayload,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    suffix = Path(payload.file_name or "").suffix.lower()
    if suffix not in AUDIO_EXTENSIONS:
        raise HTTPException(status_code=400, detail="音频格式不支持。")
    if int(payload.file_size or 0) > MAX_AUDIO_SIZE:
        raise HTTPException(status_code=400, detail="单个录音文件不能超过 50MB。")
    whitelist_permissions = await get_user_whitelist_permissions(db, user.id)
    await _ensure_auto_audio_checkin(db, user, whitelist_permissions)
    today = date.today()
    target_date = payload.makeup_date
    setting = await _get_audio_makeup_setting(db)
    has_record = await _has_audio_checkin_on_date(db, user.id, target_date)
    can_makeup, reason = _evaluate_audio_makeup_date(
        target_date,
        today=today,
        setting=setting,
        has_record=has_record,
    )
    if not can_makeup:
        raise HTTPException(status_code=400, detail=reason)
    safe_name = _safe_filename(payload.file_name or f"audio{suffix}")
    row = MagicAudioUpload(
        user_id=user.id,
        file_name=safe_name,
        file_path="",
        file_size=int(payload.file_size or 0),
        mime_type=(payload.mime_type or mimetypes.guess_type(safe_name)[0] or suffix.lstrip(".")).strip(),
        remark=(payload.remark or "").strip(),
        source=SOURCE_AUDIO_MAKEUP,
        auto_checkin_by_whitelist=False,
        uploaded_on=_now(),
        uploaded_date=target_date,
        is_deleted=False,
    )
    db.add(row)
    await db.flush()
    await db.refresh(row)
    return _serialize_audio_record(row)


@router.delete("/my/audios/{audio_id}")
async def delete_my_audio(
    audio_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, bool]:
    row = await db.get(MagicAudioUpload, audio_id)
    if not row or row.user_id != user.id:
        raise HTTPException(status_code=404, detail="录音不存在。")
    row.is_deleted = True
    row.deleted_at = _now()
    await db.flush()
    return {"success": True}


@router.get("/my/audios/calendar")
async def get_my_audio_calendar(
    month: str | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    whitelist_permissions = await get_user_whitelist_permissions(db, user.id)
    await _ensure_auto_audio_checkin(db, user, whitelist_permissions)
    month_start, _ = _parse_month(month)
    month_last_day = _month_last_day(month_start)
    result = await db.execute(
        select(MagicAudioUpload)
        .where(
            MagicAudioUpload.user_id == user.id,
            MagicAudioUpload.is_deleted.is_(False),
            MagicAudioUpload.uploaded_date >= month_start,
            MagicAudioUpload.uploaded_date <= month_last_day,
        )
        .order_by(MagicAudioUpload.uploaded_on.asc())
    )
    uploads = result.scalars().all()
    return {
        "month": month_start.strftime("%Y-%m"),
        "days": _build_audio_calendar_payload(month_start, month_last_day, uploads),
    }


async def _build_audio_stats(
    db: AsyncSession,
    month_text: str | None,
    department: str | None,
    user_id: int | None,
) -> list[dict[str, Any]]:
    month_start, month_end = _parse_month(month_text)
    expected = _expected_days(month_start, month_end)
    user_stmt = select(User).where(User.role == "user", User.disabled.is_(False))
    if department:
        user_stmt = user_stmt.where(User.department == department)
    if user_id:
        user_stmt = user_stmt.where(User.id == user_id)
    user_stmt = user_stmt.order_by(User.id.asc())
    user_result = await db.execute(user_stmt)
    users = user_result.scalars().all()
    if not users:
        return []
    user_ids = [item.id for item in users]
    upload_result = await db.execute(
        select(MagicAudioUpload)
        .where(
            MagicAudioUpload.user_id.in_(user_ids),
            MagicAudioUpload.is_deleted.is_(False),
            MagicAudioUpload.uploaded_date >= month_start,
            MagicAudioUpload.uploaded_date <= month_end,
        )
        .order_by(MagicAudioUpload.uploaded_on.asc())
    )
    uploads = upload_result.scalars().all()
    grouped: dict[int, list[MagicAudioUpload]] = {}
    for item in uploads:
        grouped.setdefault(item.user_id, []).append(item)
    rows = []
    for target in users:
        items = grouped.get(target.id, [])
        upload_days = {item.uploaded_date.isoformat() for item in items if item.uploaded_date}
        upload_count = len(items)
        makeup_count = sum(1 for item in items if (item.source or "") == SOURCE_AUDIO_MAKEUP)
        missing = max(expected - len(upload_days), 0)
        rows.append({
            "user_id": target.id,
            "name": _user_name(target),
            "department": target.department or "",
            "month": month_start.strftime("%Y-%m"),
            "expected_upload_days": expected,
            "actual_upload_days": len(upload_days),
            "actual_upload_count": upload_count,
            "makeup_count": makeup_count,
            "missing_count": missing,
            "upload_rate": round((len(upload_days) / expected) * 100, 2) if expected > 0 else 0,
            "last_upload_time": _iso(items[-1].uploaded_on) if items else None,
        })
    return rows


@router.get("/admin/audio-stats")
async def get_audio_stats(
    month: str | None = None,
    department: str | None = None,
    user_id: int | None = None,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> list[dict[str, Any]]:
    del admin
    return await _build_audio_stats(db, month, department, user_id)


@router.get("/admin/audios/calendar")
async def get_admin_audio_calendar(
    month: str | None = None,
    department: str | None = None,
    user_id: int | None = None,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    del admin
    month_start, _ = _parse_month(month)
    month_last_day = _month_last_day(month_start)
    user_stmt = select(User).where(User.role == "user", User.disabled.is_(False))
    if department:
        user_stmt = user_stmt.where(User.department == department)
    if user_id:
        user_stmt = user_stmt.where(User.id == user_id)
    user_stmt = user_stmt.order_by(User.id.asc())
    user_result = await db.execute(user_stmt)
    users = user_result.scalars().all()
    user_map = {item.id: item for item in users}
    user_ids = list(user_map)
    uploads: list[MagicAudioUpload] = []
    if user_ids:
        upload_result = await db.execute(
            select(MagicAudioUpload)
            .where(
                MagicAudioUpload.user_id.in_(user_ids),
                MagicAudioUpload.is_deleted.is_(False),
                MagicAudioUpload.uploaded_date >= month_start,
                MagicAudioUpload.uploaded_date <= month_last_day,
            )
            .order_by(MagicAudioUpload.uploaded_on.asc())
        )
        uploads = upload_result.scalars().all()
    return {
        "month": month_start.strftime("%Y-%m"),
        "user_id": user_id,
        "department": department or "",
        "scope": "user" if user_id else "all",
        "days": _build_audio_calendar_payload(month_start, month_last_day, uploads, user_map, aggregate_users=not user_id),
    }


@router.get("/admin/audio-stats/export")
async def export_audio_stats(
    month: str | None = None,
    department: str | None = None,
    user_id: int | None = None,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> StreamingResponse:
    del admin
    rows = await _build_audio_stats(db, month, department, user_id)
    export_rows = [
        [
            item["name"],
            item["department"],
            item["month"],
            item["expected_upload_days"],
            item["actual_upload_days"],
            item["actual_upload_count"],
            item["missing_count"],
            item["upload_rate"],
            item["last_upload_time"] or "",
        ]
        for item in rows
    ]
    return _xlsx_response(
        f"magic_audio_stats_{month or date.today().strftime('%Y-%m')}.xlsx",
        ["姓名", "部门", "月份", "应上传天数", "实际上传天数", "实际上传次数", "缺少次数", "上传率", "最后上传时间"],
        export_rows,
    )
