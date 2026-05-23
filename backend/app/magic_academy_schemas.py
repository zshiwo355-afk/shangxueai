from __future__ import annotations

from datetime import date, datetime
from typing import Any

from pydantic import BaseModel, Field, field_validator

TARGET_TYPES = {"all_users", "all_newcomers", "department", "position", "role", "user"}
VIDEO_STATUSES = {"draft", "published", "disabled"}
VIDEO_SOURCE_TYPES = {"upload", "material"}
QUESTION_TYPES = {"single", "multiple", "judge", "blank", "short_answer"}
QUESTION_TYPE_ALIASES = {
    "fill": "blank",
    "short": "short_answer",
}
WATCH_CONFIRM_DEFAULT_MESSAGE = "请确认你正在观看视频"
WATCH_CONFIRM_DEFAULT_BUTTON = "继续学习"


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


def _normalize_video_source(value: str) -> str:
    value = (value or "upload").strip().lower()
    if value not in VIDEO_SOURCE_TYPES:
        raise ValueError("不支持的视频来源类型。")
    return value


def _ensure_status(value: str) -> str:
    value = (value or "draft").strip().lower()
    if value not in VIDEO_STATUSES:
        raise ValueError("不支持的视频状态。")
    return value


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
    file_name: str = Field(default="", max_length=255)
    file_path: str = Field(default="", max_length=512)
    mime_type: str = Field(default="video/mp4", max_length=128)
    file_size: int = Field(default=0, ge=0)
    duration_seconds: int = Field(default=0, ge=0)
    is_required: bool = False
    is_newcomer_required: bool = False
    deadline_at: datetime | None = None
    status: str = "draft"
    video_source: str = "upload"
    material_asset_id: int | None = Field(default=None, ge=1)
    targets: list[VideoTargetInput] = Field(default_factory=list)

    @field_validator("status")
    @classmethod
    def _status(cls, value: str) -> str:
        return _ensure_status(value)

    @field_validator("video_source")
    @classmethod
    def _video_source(cls, value: str) -> str:
        return _normalize_video_source(value)


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


class AudioMakeupSettingPayload(BaseModel):
    enabled: bool = False
    make_up_days: int = Field(default=0, ge=0, le=365)


class AudioMakeupPayload(BaseModel):
    makeup_date: date
    file_name: str = Field(..., min_length=1, max_length=255)
    file_size: int = Field(default=0, ge=0)
    mime_type: str = Field(default="", max_length=128)
    remark: str = Field(default="", max_length=255)


class VideoSeriesPayload(BaseModel):
    title: str = Field(..., min_length=1, max_length=255)
    description: str = Field(default="", max_length=5000)
    sequential_unlock_enabled: bool = True
    enabled: bool = True


class VideoSeriesAddItemPayload(BaseModel):
    video_id: int = Field(..., ge=1)
    sort_order: int | None = Field(default=None, ge=0)


class VideoSeriesReorderPayload(BaseModel):
    video_ids: list[int] = Field(default_factory=list)


class WatchConfirmSettingPayload(BaseModel):
    enabled: bool = False
    interval_seconds: int = Field(default=300, ge=30, le=86400)
    message: str = Field(default=WATCH_CONFIRM_DEFAULT_MESSAGE, max_length=255)
    button_text: str = Field(default=WATCH_CONFIRM_DEFAULT_BUTTON, max_length=64)


class WatchConfirmLogPayload(BaseModel):
    progress_seconds: float = Field(default=0, ge=0)
    confirm_round: int = Field(default=1, ge=1)
