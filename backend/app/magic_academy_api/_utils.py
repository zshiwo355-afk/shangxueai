from __future__ import annotations

import json
from calendar import monthrange
from datetime import date, datetime, timedelta
from io import BytesIO
from pathlib import Path
from typing import Any
from urllib.parse import quote

from fastapi import HTTPException
from fastapi.responses import StreamingResponse

from ..models import MagicQuestion, User

BASE_DIR = Path(__file__).resolve().parents[2]
UPLOAD_ROOT = BASE_DIR / "uploads" / "magic_academy"
VIDEO_DIR = UPLOAD_ROOT / "videos"
VIDEO_DIR.mkdir(parents=True, exist_ok=True)

MAX_AUDIO_SIZE = 50 * 1024 * 1024
AUDIO_EXTENSIONS = {".mp3", ".m4a", ".wav", ".aac", ".amr", ".webm", ".ogg"}
VIDEO_STATUSES = {"draft", "published", "disabled"}
VIDEO_UPLOAD_STATUSES = {"pending", "uploading", "completed", "failed", "deleted"}
TRANSCODE_STATUSES = {"none", "pending", "processing", "completed", "failed"}
TARGET_TYPES = {"all_users", "all_newcomers", "department", "position", "employment_status", "role", "user"}
VIDEO_SOURCE_TYPES = {"upload", "material"}
IMAGE_SOURCE_TYPES = {"upload", "material", "url"}
READING_TARGET_TYPES = {"all", "all_newcomers", "department", "position", "employment_status", "user"}
QUESTION_TYPES = {"single", "multiple", "judge", "blank", "short_answer"}
QUESTION_TYPE_ALIASES = {
    "fill": "blank",
    "short": "short_answer",
}
UNASSIGNED_DEPARTMENT_FILTER = "__UNASSIGNED__"

SOURCE_MANUAL = "manual"
SOURCE_AUDIO_USER_UPLOAD = "user_upload"
SOURCE_AUDIO_MAKEUP = "makeup"
SOURCE_WHITELIST_AUTO = "whitelist_auto"
SOURCE_WHITELIST_EXEMPT = "whitelist_exempt"
SOURCE_WHITELIST_AUTO_CORRECT = "whitelist_auto_correct"

WATCH_CONFIRM_DEFAULT_MESSAGE = "请确认你正在观看视频"
WATCH_CONFIRM_DEFAULT_BUTTON = "继续学习"
DEFAULT_AUDIO_MAKEUP_DAYS = 0
READING_CONTENT_ACTIVE = "active"


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


def _normalize_upload_status(value: str) -> str:
    status = (value or "pending").strip().lower()
    if status not in VIDEO_UPLOAD_STATUSES:
        raise ValueError("不支持的上传状态。")
    return status


def _normalize_transcode_status(value: str) -> str:
    status = (value or "none").strip().lower()
    if status not in TRANSCODE_STATUSES:
        raise ValueError("不支持的转码状态。")
    return status


def _safe_filename(name: str) -> str:
    return Path((name or "file").replace("\\", "/")).name or "file"


def _attachment_disposition(filename: str | None) -> str:
    name = (filename or "").strip() or "export.xlsx"
    try:
        ascii_name = name.encode("ascii").decode("ascii")
        return f'attachment; filename="{ascii_name}"'
    except UnicodeEncodeError:
        fallback = _safe_filename(name.encode("ascii", "ignore").decode("ascii")) or "export.xlsx"
        return f'attachment; filename="{fallback}"; filename*=UTF-8\'\'{quote(name)}'


def _strip_slashes(value: str) -> str:
    return (value or "").strip().strip("/")


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
    return month_start, month_end


def _expected_days(month_start: date, month_end: date) -> int:
    return max((month_end - month_start).days + 1, 0)


def _month_last_day(month_start: date) -> date:
    return date(month_start.year, month_start.month, monthrange(month_start.year, month_start.month)[1])


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
    response.headers["Content-Disposition"] = _attachment_disposition(filename)
    return response


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


def _build_export_filename(
    prefix: str,
    video_title: str,
    department: str | None = None,
    user_name: str | None = None,
) -> str:
    parts = [prefix, video_title]
    if department:
        parts.append("未分配部门" if department == UNASSIGNED_DEPARTMENT_FILTER else department)
    if user_name:
        parts.append(user_name)
    parts.append(date.today().isoformat())
    return _safe_filename("_".join(part.strip() for part in parts if (part or "").strip())) + ".xlsx"


__all__ = [
    "BASE_DIR",
    "UPLOAD_ROOT",
    "VIDEO_DIR",
    "MAX_AUDIO_SIZE",
    "AUDIO_EXTENSIONS",
    "VIDEO_STATUSES",
    "VIDEO_UPLOAD_STATUSES",
    "TRANSCODE_STATUSES",
    "TARGET_TYPES",
    "VIDEO_SOURCE_TYPES",
    "IMAGE_SOURCE_TYPES",
    "READING_TARGET_TYPES",
    "QUESTION_TYPES",
    "QUESTION_TYPE_ALIASES",
    "UNASSIGNED_DEPARTMENT_FILTER",
    "SOURCE_MANUAL",
    "SOURCE_AUDIO_USER_UPLOAD",
    "SOURCE_AUDIO_MAKEUP",
    "SOURCE_WHITELIST_AUTO",
    "SOURCE_WHITELIST_EXEMPT",
    "SOURCE_WHITELIST_AUTO_CORRECT",
    "WATCH_CONFIRM_DEFAULT_MESSAGE",
    "WATCH_CONFIRM_DEFAULT_BUTTON",
    "DEFAULT_AUDIO_MAKEUP_DAYS",
    "READING_CONTENT_ACTIVE",
    "_now",
    "_iso",
    "_json_loads",
    "_json_dumps",
    "_user_name",
    "_user_department",
    "_user_position",
    "_department_matches_filter",
    "_normalize_target_type",
    "_normalize_reading_target_type",
    "_normalize_question_type",
    "_normalize_video_source",
    "_normalize_image_source",
    "_ensure_status",
    "_normalize_upload_status",
    "_normalize_transcode_status",
    "_safe_filename",
    "_strip_slashes",
    "_parse_month",
    "_expected_days",
    "_month_last_day",
    "_parse_form_id_list",
    "_xlsx_response",
    "_parse_answer",
    "_question_options",
    "_question_correct_answers",
    "_normalize_multi",
    "_score_answer",
    "_build_export_filename",
    "timedelta",
]
