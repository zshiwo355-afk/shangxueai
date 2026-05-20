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

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, RedirectResponse, StreamingResponse
import oss2
from oss2.models import PartInfo
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import and_, delete as sql_delete, desc, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import update

from .auth import get_current_user, require_admin
from .config import get_settings
from .db import get_db
from .models import (
    MagicAudioUpload,
    MagicQuestion,
    MagicQuizAnswer,
    MagicQuizPointPassRecord,
    MagicVideo,
    MagicVideoProgress,
    MagicVideoQuizPoint,
    MagicVideoTarget,
    MagicVideoWhitelist,
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
VIDEO_STATUSES = {"draft", "published", "disabled"}
VIDEO_UPLOAD_STATUSES = {"pending", "uploading", "completed", "failed", "deleted"}
TRANSCODE_STATUSES = {"none", "pending", "processing", "completed", "failed"}
TARGET_TYPES = {"all_users", "all_newcomers", "department", "position", "role", "user"}
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


def _department_matches_filter(user: User, department: str) -> bool:
    if department == UNASSIGNED_DEPARTMENT_FILTER:
        return not _user_department(user)
    return _user_department(user) == department


def _normalize_target_type(value: str) -> str:
    value = (value or "").strip().lower()
    if value not in TARGET_TYPES:
        raise ValueError("不支持的适用对象类型。")
    return value


def _normalize_question_type(value: str) -> str:
    value = (value or "").strip().lower()
    value = QUESTION_TYPE_ALIASES.get(value, value)
    if value not in QUESTION_TYPES:
        raise ValueError("不支持的题型。")
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
) -> dict[str, Any]:
    answered = _json_loads(progress.answered_point_ids_json, []) if progress else []
    status = (video.status or "draft").strip().lower()
    upload_status = (video.upload_status or "completed").strip().lower()
    return {
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
        "progress": {
            "current_position": float(progress.current_position or 0),
            "max_watched_position": float(progress.max_watched_position or 0),
            "progress_percent": float(progress.progress_percent or 0),
            "is_completed": bool(progress.is_completed),
            "completed_at": _iso(progress.completed_at),
            "last_watched_at": _iso(progress.last_watched_at),
            "answered_point_ids": answered,
            "quiz_passed": bool(progress.quiz_passed),
            "answer_attempt_count": int(progress.answer_attempt_count or 0),
        } if progress else None,
        "is_whitelisted": whitelisted,
    }


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
    return targets, whitelisted


class VideoTargetInput(BaseModel):
    target_type: str
    target_value: str = ""

    @field_validator("target_type")
    @classmethod
    def _validate_type(cls, value: str) -> str:
        return _normalize_target_type(value)

    @field_validator("target_value", mode="before")
    @classmethod
    def _strip_value(cls, value: Any) -> str:
        return str(value or "").strip()


class MagicVideoPayload(BaseModel):
    title: str = Field(..., min_length=1, max_length=255)
    description: str = Field(default="", max_length=5000)
    category: str = Field(default="", max_length=128)
    file_name: str = Field(..., min_length=1, max_length=255)
    file_path: str = Field(..., min_length=1, max_length=512)
    mime_type: str = Field(default="video/mp4", max_length=128)
    file_size: int = Field(default=0, ge=0)
    duration_seconds: int = Field(default=0, ge=0)
    is_required: bool = False
    is_newcomer_required: bool = False
    deadline_at: datetime | None = None
    status: str = "draft"
    targets: list[VideoTargetInput] = Field(default_factory=list)

    @field_validator("status")
    @classmethod
    def _status(cls, value: str) -> str:
        return _ensure_status(value)


class MagicVideoUploadInitPayload(BaseModel):
    title: str = Field(..., min_length=1, max_length=255)
    description: str = Field(default="", max_length=5000)
    category: str = Field(default="", max_length=128)
    original_filename: str = Field(..., min_length=1, max_length=255)
    file_size: int = Field(..., gt=0)
    mime_type: str = Field(default="video/mp4", max_length=128)
    duration_seconds: int = Field(default=0, ge=0)
    is_required: bool = False
    is_newcomer_required: bool = False
    deadline_at: datetime | None = None
    status: str = "draft"
    targets: list[VideoTargetInput] = Field(default_factory=list)

    @field_validator("status")
    @classmethod
    def _upload_init_status(cls, value: str) -> str:
        return _ensure_status(value)


class MagicVideoUploadPartPayload(BaseModel):
    part_number: int = Field(..., ge=1)
    etag: str = Field(..., min_length=1, max_length=255)


class MagicVideoUploadCompletePayload(BaseModel):
    video_id: int = Field(..., ge=1)
    oss_object_key: str = Field(..., min_length=1, max_length=1024)
    file_size: int = Field(..., gt=0)
    upload_id: str = Field(..., min_length=1, max_length=255)
    parts: list[MagicVideoUploadPartPayload] = Field(default_factory=list)


class MagicVideoUploadFailPayload(BaseModel):
    video_id: int = Field(..., ge=1)
    oss_object_key: str = Field(..., min_length=1, max_length=1024)
    upload_id: str = Field(..., min_length=1, max_length=255)
    reason: str = Field(default="上传失败", max_length=5000)


class MagicVideoReplaceInitPayload(BaseModel):
    original_filename: str = Field(..., min_length=1, max_length=255)
    file_size: int = Field(..., gt=0)
    mime_type: str = Field(default="video/mp4", max_length=128)
    duration_seconds: int = Field(default=0, ge=0)


class MagicVideoReplaceCompletePayload(BaseModel):
    oss_object_key: str = Field(..., min_length=1, max_length=1024)
    file_size: int = Field(..., gt=0)
    upload_id: str = Field(..., min_length=1, max_length=255)
    parts: list[MagicVideoUploadPartPayload] = Field(default_factory=list)
    title: str = Field(..., min_length=1, max_length=255)
    description: str = Field(default="", max_length=5000)
    category: str = Field(default="", max_length=128)
    duration_seconds: int = Field(default=0, ge=0)
    is_required: bool = False
    is_newcomer_required: bool = False
    deadline_at: datetime | None = None
    status: str = "draft"
    targets: list[VideoTargetInput] = Field(default_factory=list)

    @field_validator("status")
    @classmethod
    def _replace_complete_status(cls, value: str) -> str:
        return _ensure_status(value)


class MagicVideoReplaceFailPayload(BaseModel):
    oss_object_key: str = Field(..., min_length=1, max_length=1024)
    upload_id: str = Field(..., min_length=1, max_length=255)
    reason: str = Field(default="替换上传失败", max_length=5000)


class QuizPointPayload(BaseModel):
    trigger_second: int = Field(..., ge=0)
    question_count: int = Field(default=0, ge=0)
    pass_score: int = Field(default=60, ge=0, le=100)
    enabled: bool = True


class QuestionPayload(BaseModel):
    question_type: str
    stem: str = Field(..., min_length=1, max_length=5000)
    options: list[str] = Field(default_factory=list)
    correct_answers: list[str] = Field(default_factory=list)
    score: float = Field(default=1.0, ge=0)
    sort_order: int = Field(default=0, ge=0)
    is_required: bool = True

    @field_validator("question_type")
    @classmethod
    def _question_type(cls, value: str) -> str:
        return _normalize_question_type(value)


class ProgressPayload(BaseModel):
    current_position: float = Field(default=0, ge=0)
    max_watched_position: float = Field(default=0, ge=0)
    duration_seconds: float = Field(default=0, ge=0)
    page_visible: bool = True


class QuizSubmitAnswer(BaseModel):
    question_id: int
    answer: Any = None


class QuizSubmitPayload(BaseModel):
    quiz_point_id: int
    answers: list[QuizSubmitAnswer] = Field(default_factory=list)
    skip_by_whitelist: bool = False


class VideoWhitelistCreatePayload(BaseModel):
    video_id: int
    user_id: int
    note: str = Field(default="", max_length=255)


class MagicAudioUploadPayload(BaseModel):
    file_name: str = Field(..., min_length=1, max_length=255)
    file_size: int = Field(default=0, ge=0)
    mime_type: str = Field(default="", max_length=128)
    remark: str = Field(default="", max_length=255)


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
    targets_map = await _get_video_targets(db, [item.id for item in videos])
    return [_video_to_dict(video, targets_map.get(video.id, [])) for video in videos]


@router.post("/videos")
async def create_video(
    payload: MagicVideoPayload,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    video = MagicVideo(
        title=payload.title.strip(),
        description=payload.description.strip(),
        category=payload.category.strip(),
        file_name=payload.file_name.strip(),
        file_path=payload.file_path.strip(),
        original_filename=payload.file_name.strip(),
        stored_filename=Path(payload.file_path.strip()).name,
        storage_type="local",
        mime_type=payload.mime_type.strip(),
        file_size=int(payload.file_size or 0),
        duration_seconds=int(payload.duration_seconds or 0),
        duration=int(payload.duration_seconds or 0),
        is_required=payload.is_required,
        is_newcomer_required=payload.is_newcomer_required,
        deadline_at=payload.deadline_at,
        status=payload.status,
        upload_status="completed",
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
    return _video_to_dict(video, targets_map.get(video.id, []))


@router.put("/videos/{video_id}")
async def update_video(
    video_id: int,
    payload: MagicVideoPayload,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    del admin
    video = await _get_video_or_404(db, video_id)
    video.title = payload.title.strip()
    video.description = payload.description.strip()
    video.category = payload.category.strip()
    video.file_name = payload.file_name.strip()
    video.file_path = payload.file_path.strip()
    video.original_filename = payload.file_name.strip()
    video.stored_filename = Path(payload.file_path.strip()).name
    video.storage_type = video.storage_type or "local"
    video.mime_type = payload.mime_type.strip()
    video.file_size = int(payload.file_size or 0)
    video.duration_seconds = int(payload.duration_seconds or 0)
    video.duration = int(payload.duration_seconds or 0)
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
    result = await db.execute(
        select(MagicVideo).where(MagicVideo.deleted_at.is_(None)).order_by(desc(MagicVideo.created_at))
    )
    videos = result.scalars().all()
    targets_map = await _get_video_targets(db, [item.id for item in videos])
    progress_result = await db.execute(
        select(MagicVideoProgress).where(MagicVideoProgress.user_id == user.id)
    )
    progress_map = {item.video_id: item for item in progress_result.scalars().all()}
    output = []
    for video in videos:
        targets = targets_map.get(video.id, [])
        whitelisted = await _is_whitelisted(db, video.id, user.id)
        if not _video_visible_to_user(video, user, targets, whitelisted):
            continue
        output.append(_video_to_dict(video, targets, progress_map.get(video.id), whitelisted))
    return output


@router.get("/my/videos/{video_id}")
async def get_my_video_detail(
    video_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    video = await _get_video_or_404(db, video_id)
    targets, whitelisted = await _ensure_video_access(db, video, user)
    progress = await _get_progress(db, user.id, video_id, create=False)
    progress = await _ensure_progress_quiz_version(db, progress, video)
    points_map = await _get_quiz_points_map(db, [video_id])
    points = points_map.get(video_id, [])
    questions_map = await _get_questions_map(db, [item.id for item in points])
    payload = _video_to_dict(video, targets, progress, whitelisted)
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
    video = await _get_video_or_404(db, video_id)
    targets, whitelisted = await _ensure_video_access(db, video, user)
    progress = await _get_progress(db, user.id, video_id, create=True)
    progress = await _ensure_progress_quiz_version(db, progress, video)
    duration = max(float(payload.duration_seconds or video.duration_seconds or progress.total_duration or 0), 0)
    progress.total_duration = duration
    progress.current_position = min(max(float(payload.current_position or 0), 0), duration or float(payload.current_position or 0))
    allowed_max = max(float(progress.max_watched_position or 0), float(payload.max_watched_position or 0))
    if not whitelisted and duration > 0:
        allowed_max = min(allowed_max, duration)
    progress.max_watched_position = allowed_max
    progress.progress_percent = round((allowed_max / duration) * 100, 2) if duration > 0 else 0
    if payload.page_visible:
        progress.last_watched_at = _now()
    answered = set(_json_loads(progress.answered_point_ids_json, []))
    point_result = await db.execute(
        select(MagicVideoQuizPoint.id)
        .where(MagicVideoQuizPoint.video_id == video_id, MagicVideoQuizPoint.enabled.is_(True))
    )
    required_point_ids = {int(item[0]) for item in point_result.all()}
    progress.quiz_passed = answered.issuperset(required_point_ids)
    near_end = duration > 0 and allowed_max >= max(duration - 1.5, duration * 0.98)
    if whitelisted:
        near_end = duration > 0 and progress.current_position >= 0
    if near_end and progress.quiz_passed and video.status == "published":
        progress.is_completed = True
        if not progress.completed_at:
            progress.completed_at = _now()
    await db.flush()
    return _video_to_dict(video, targets, progress, whitelisted)


@router.post("/my/videos/{video_id}/submit-quiz")
async def submit_my_video_quiz(
    video_id: int,
    payload: QuizSubmitPayload,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
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
    if whitelisted and payload.skip_by_whitelist:
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
            )
        )
    final_score = round((total_score / total_possible) * 100, 2) if total_possible > 0 else 100.0
    passed = bool(whitelisted and payload.skip_by_whitelist) or final_score >= float(point.pass_score or 60)
    db.add(
        MagicQuizPointPassRecord(
            user_id=user.id,
            video_id=video_id,
            quiz_point_id=point.id,
            attempt_no=attempt_no,
            score=final_score,
            passed=passed,
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
    progress.quiz_passed = answered.issuperset(required_point_ids)
    if progress.total_duration > 0 and progress.max_watched_position >= max(progress.total_duration - 1.5, progress.total_duration * 0.98) and progress.quiz_passed:
        progress.is_completed = True
        progress.completed_at = progress.completed_at or _now()
    await db.flush()
    return {
        "quiz_point_id": point.id,
        "attempt_no": attempt_no,
        "score": final_score,
        "passed": passed,
        "required_score": point.pass_score,
        "details": rows,
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
    rows = []
    for item in users:
        progress = progress_map.get(item.id)
        watched = min(float(progress.max_watched_position or 0), float(video.duration_seconds or progress.total_duration or 0)) if progress else 0
        rows.append({
            "user_id": item.id,
            "name": _user_name(item),
            "department": _user_department(item),
            "position": item.position or "",
            "video_name": video.title,
            "video_duration_seconds": int(video.duration_seconds or 0),
            "watched_seconds": round(watched, 2),
            "progress_percent": float(progress.progress_percent or 0) if progress else 0,
            "is_completed": bool(progress.is_completed) if progress else False,
            "completed_at": _iso(progress.completed_at) if progress else None,
            "quiz_passed": bool(progress.quiz_passed) if progress else False,
            "answer_attempt_count": int(progress.answer_attempt_count or 0) if progress else 0,
            "last_watched_at": _iso(progress.last_watched_at) if progress else None,
            "is_whitelist_user": item.id in whitelist_user_ids,
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
    admin: User = Depends(require_admin),
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
    admin: User = Depends(require_admin),
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
    admin: User = Depends(require_admin),
) -> dict[str, bool]:
    del admin
    row = await db.get(MagicVideoWhitelist, whitelist_id)
    if not row:
        raise HTTPException(status_code=404, detail="白名单记录不存在。")
    await db.delete(row)
    await db.flush()
    return {"success": True}


@router.get("/my/audios")
async def list_my_audios(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[dict[str, Any]]:
    result = await db.execute(
        select(MagicAudioUpload)
        .where(MagicAudioUpload.user_id == user.id, MagicAudioUpload.is_deleted.is_(False))
        .order_by(desc(MagicAudioUpload.uploaded_on))
    )
    return [_serialize_audio_record(item) for item in result.scalars().all()]


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
    }


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
        missing = max(expected - len(upload_days), 0)
        rows.append({
            "user_id": target.id,
            "name": _user_name(target),
            "department": target.department or "",
            "month": month_start.strftime("%Y-%m"),
            "expected_upload_days": expected,
            "actual_upload_days": len(upload_days),
            "actual_upload_count": upload_count,
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
