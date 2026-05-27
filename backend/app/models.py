"""ORM：用户、配置项、训练/考试 session 行、考试任务、考试尝试、训练记录。

字段对齐 backend/sql/init.sql。建表只走 sql 文件，本模块只做 ORM 映射。
"""
from __future__ import annotations

from datetime import date, datetime, time

from sqlalchemy import (
    BigInteger,
    Boolean,
    Date,
    DateTime,
    Float,
    Index,
    Integer,
    String,
    Text,
    Time,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.mysql import LONGTEXT
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    password_md5: Mapped[str] = mapped_column(String(64), nullable=False)
    display_name: Mapped[str] = mapped_column(String(128), default="")
    real_name: Mapped[str] = mapped_column(String(128), default="")
    department: Mapped[str] = mapped_column(String(128), default="")
    position: Mapped[str] = mapped_column(String(128), default="")
    role: Mapped[str] = mapped_column(String(16), default="user")
    is_newcomer: Mapped[bool] = mapped_column(Boolean, default=False)
    status: Mapped[str] = mapped_column(String(16), default="active")
    disabled: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )


class ConfigOption(Base):
    __tablename__ = "config_options"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    category: Mapped[str] = mapped_column(String(32), nullable=False)
    value: Mapped[str] = mapped_column(String(64), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        Index("idx_config_options_cat", "category", "enabled", "sort_order"),
    )


class MagicAudioMakeupSetting(Base):
    __tablename__ = "magic_audio_makeup_settings"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    make_up_days: Mapped[int] = mapped_column(Integer, default=0)
    audio_random_window_minutes: Mapped[int] = mapped_column(Integer, default=0)
    video_random_window_minutes: Mapped[int] = mapped_column(Integer, default=0)
    updated_by: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )


class MagicReadingSeries(Base):
    __tablename__ = "magic_reading_series"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="")
    start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    end_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="draft")
    created_by: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        Index("idx_magic_reading_series_status", "status", "created_at"),
        Index("idx_magic_reading_series_date", "start_date", "end_date"),
    )


class MagicReadingSeriesTarget(Base):
    __tablename__ = "magic_reading_series_targets"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    series_id: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)
    target_type: Mapped[str] = mapped_column(String(32), nullable=False)
    target_id: Mapped[str] = mapped_column(String(255), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    __table_args__ = (
        Index("idx_magic_reading_series_targets_series", "series_id"),
        Index("idx_magic_reading_series_targets_lookup", "series_id", "target_type", "target_id"),
        Index("idx_magic_reading_series_targets_type_target", "target_type", "target_id"),
    )


class MagicReadingContent(Base):
    __tablename__ = "magic_reading_contents"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    series_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, index=True)
    reading_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    push_time: Mapped[time | None] = mapped_column(Time, nullable=True)
    push_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    makeup_deadline_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="")
    source_type: Mapped[str] = mapped_column(String(32), default="upload")
    material_asset_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, index=True)
    image_object_key: Mapped[str] = mapped_column(String(1024), nullable=False)
    image_url: Mapped[str] = mapped_column(String(2048), default="")
    image_file_name: Mapped[str] = mapped_column(String(255), default="")
    image_mime_type: Mapped[str] = mapped_column(String(128), default="")
    image_size: Mapped[int] = mapped_column(BigInteger, default=0)
    status: Mapped[str] = mapped_column(String(16), default="active")
    created_by: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class MagicReadingContentTarget(Base):
    __tablename__ = "magic_reading_content_targets"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    content_id: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)
    target_type: Mapped[str] = mapped_column(String(32), nullable=False)
    target_id: Mapped[str] = mapped_column(String(255), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    __table_args__ = (
        Index("idx_magic_reading_content_targets_lookup", "content_id", "target_type", "target_id"),
    )


class MaterialProject(Base):
    __tablename__ = "material_projects"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="")
    oss_prefix: Mapped[str] = mapped_column(String(255), default="")
    visibility: Mapped[str] = mapped_column(String(16), default="admin")
    parent_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, index=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_by: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class MaterialAsset(Base):
    __tablename__ = "material_assets"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    project_id: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    asset_type: Mapped[str] = mapped_column(String(32), default="other")
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    object_key: Mapped[str] = mapped_column(String(1024), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(128), default="")
    file_size: Mapped[int] = mapped_column(BigInteger, default=0)
    duration_seconds: Mapped[int] = mapped_column(Integer, default=0)
    remark: Mapped[str] = mapped_column(Text, default="")
    tags: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(16), default="active")
    created_by: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    __table_args__ = (
        Index("idx_material_assets_project_type", "project_id", "asset_type", "is_deleted"),
        Index("idx_material_assets_project_sort", "project_id", "sort_order", "is_deleted"),
    )


class TrainingSessionRow(Base):
    """训练 / 考试运行时 session 状态。和 V1 的 .sessions/*.json 对应。"""

    __tablename__ = "training_sessions"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)
    mode: Mapped[str] = mapped_column(String(16), default="training")
    exam_attempt_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, index=True)
    state_json: Mapped[str] = mapped_column(LONGTEXT, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )


class Exam(Base):
    __tablename__ = "exams"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(255), default="陪练考试")
    pass_score: Mapped[int] = mapped_column(Integer, default=60)
    status: Mapped[str] = mapped_column(String(16), default="pending")
    attempt_count: Mapped[int] = mapped_column(Integer, default=0)
    max_attempts: Mapped[int] = mapped_column(Integer, default=2)
    fixed_training_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    fixed_difficulty: Mapped[str | None] = mapped_column(String(32), nullable=True)
    fixed_customer_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    ai_weight: Mapped[float] = mapped_column(Float, default=0.5)
    created_by: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class ExamAttempt(Base):
    __tablename__ = "exam_attempts"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    exam_id: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)
    attempt_no: Mapped[int] = mapped_column(Integer, nullable=False)
    training_type: Mapped[str] = mapped_column(String(64), nullable=False)
    difficulty: Mapped[str] = mapped_column(String(32), default="中等")
    customer_type: Mapped[str] = mapped_column(String(64), nullable=False)
    session_id: Mapped[str | None] = mapped_column(String(64), unique=True, nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="in_progress")
    score: Mapped[float | None] = mapped_column(Float, nullable=True)
    is_pass: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    result: Mapped[str | None] = mapped_column(String(16), nullable=True)
    review_json: Mapped[str | None] = mapped_column(LONGTEXT, nullable=True)
    chat_history_json: Mapped[str | None] = mapped_column(LONGTEXT, nullable=True)
    admin_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    admin_comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    final_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    final_is_pass: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    reviewed_by: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    started_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class TrainingRecord(Base):
    __tablename__ = "training_records"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)
    training_type: Mapped[str] = mapped_column(String(64), nullable=False)
    difficulty: Mapped[str] = mapped_column(String(32), nullable=False)
    customer_type: Mapped[str] = mapped_column(String(64), nullable=False)
    score: Mapped[float | None] = mapped_column(Float, nullable=True)
    is_pass: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    result: Mapped[str | None] = mapped_column(String(16), nullable=True)
    review_json: Mapped[str | None] = mapped_column(LONGTEXT, nullable=True)
    chat_history_json: Mapped[str | None] = mapped_column(LONGTEXT, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), index=True)


class MagicVideo(Base):
    __tablename__ = "magic_videos"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="")
    category: Mapped[str] = mapped_column(String(128), default="")
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    file_path: Mapped[str] = mapped_column(String(512), nullable=False)
    original_filename: Mapped[str] = mapped_column(String(255), default="")
    stored_filename: Mapped[str] = mapped_column(String(255), default="")
    storage_type: Mapped[str] = mapped_column(String(32), default="local")
    oss_bucket: Mapped[str] = mapped_column(String(255), default="")
    oss_endpoint: Mapped[str] = mapped_column(String(255), default="")
    oss_object_key: Mapped[str] = mapped_column(String(1024), default="")
    oss_url: Mapped[str] = mapped_column(String(2048), default="")
    cdn_url: Mapped[str] = mapped_column(String(2048), default="")
    play_url: Mapped[str] = mapped_column(String(2048), default="")
    hls_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    cover_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    mime_type: Mapped[str] = mapped_column(String(128), default="video/mp4")
    file_size: Mapped[int] = mapped_column(BigInteger, default=0)
    duration_seconds: Mapped[int] = mapped_column(Integer, default=0)
    duration: Mapped[int] = mapped_column(Integer, default=0)
    is_required: Mapped[bool] = mapped_column(Boolean, default=False)
    is_newcomer_required: Mapped[bool] = mapped_column(Boolean, default=False)
    deadline_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="draft")
    upload_status: Mapped[str] = mapped_column(String(16), default="completed")
    upload_id: Mapped[str] = mapped_column(String(255), default="")
    quiz_version: Mapped[int] = mapped_column(Integer, default=1)
    upload_error: Mapped[str] = mapped_column(Text, default="")
    transcode_status: Mapped[str] = mapped_column(String(16), default="none")
    material_asset_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, index=True)
    replacement_upload_id: Mapped[str] = mapped_column(String(255), default="")
    replacement_object_key: Mapped[str] = mapped_column(String(1024), default="")
    replacement_original_filename: Mapped[str] = mapped_column(String(255), default="")
    replacement_mime_type: Mapped[str] = mapped_column(String(128), default="")
    replacement_file_size: Mapped[int] = mapped_column(BigInteger, default=0)
    replacement_duration_seconds: Mapped[int] = mapped_column(Integer, default=0)
    created_by: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class MagicVideoSeries(Base):
    __tablename__ = "magic_video_series"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="")
    sequential_unlock_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    created_by: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class MagicVideoSeriesItem(Base):
    __tablename__ = "magic_video_series_items"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    series_id: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)
    video_id: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        UniqueConstraint("video_id", name="uk_magic_video_series_items_video"),
        UniqueConstraint("series_id", "video_id", name="uk_magic_video_series_items_series_video"),
        Index("idx_magic_video_series_items_order", "series_id", "sort_order"),
    )


class MagicVideoTarget(Base):
    __tablename__ = "magic_video_targets"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    video_id: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)
    target_type: Mapped[str] = mapped_column(String(32), nullable=False)
    target_value: Mapped[str] = mapped_column(String(255), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    __table_args__ = (
        Index("idx_magic_video_targets_video", "video_id", "target_type"),
    )


class MagicVideoQuizPoint(Base):
    __tablename__ = "magic_video_quiz_points"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    video_id: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)
    trigger_second: Mapped[int] = mapped_column(Integer, nullable=False)
    question_count: Mapped[int] = mapped_column(Integer, default=0)
    pass_score: Mapped[int] = mapped_column(Integer, default=60)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        Index("idx_magic_video_quiz_points_video", "video_id", "trigger_second"),
    )


class MagicQuestion(Base):
    __tablename__ = "magic_questions"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    quiz_point_id: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)
    question_type: Mapped[str] = mapped_column(String(16), nullable=False)
    stem: Mapped[str] = mapped_column(Text, nullable=False)
    options_json: Mapped[str] = mapped_column(LONGTEXT, default="[]")
    correct_answer_json: Mapped[str] = mapped_column(LONGTEXT, default="[]")
    score: Mapped[float] = mapped_column(Float, default=100.0)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    is_required: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        Index("idx_magic_questions_point", "quiz_point_id", "sort_order"),
    )


class MagicVideoProgress(Base):
    __tablename__ = "magic_video_progress"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)
    video_id: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)
    current_position: Mapped[float] = mapped_column(Float, default=0)
    max_watched_position: Mapped[float] = mapped_column(Float, default=0)
    progress_percent: Mapped[float] = mapped_column(Float, default=0)
    is_completed: Mapped[bool] = mapped_column(Boolean, default=False)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_watched_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    total_duration: Mapped[float] = mapped_column(Float, default=0)
    answered_point_ids_json: Mapped[str] = mapped_column(LONGTEXT, default="[]")
    quiz_passed: Mapped[bool] = mapped_column(Boolean, default=False)
    quiz_version: Mapped[int] = mapped_column(Integer, default=1)
    answer_attempt_count: Mapped[int] = mapped_column(Integer, default=0)
    progress_source: Mapped[str] = mapped_column(String(32), default="manual")
    completed_by_whitelist: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        UniqueConstraint("user_id", "video_id", name="uk_magic_video_progress_user_video"),
    )


class MagicQuizAnswer(Base):
    __tablename__ = "magic_quiz_answers"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)
    video_id: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)
    quiz_point_id: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)
    question_id: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)
    attempt_no: Mapped[int] = mapped_column(Integer, default=1)
    answer_json: Mapped[str] = mapped_column(LONGTEXT, default="[]")
    correct_answer_json: Mapped[str] = mapped_column(LONGTEXT, default="[]")
    is_correct: Mapped[bool] = mapped_column(Boolean, default=False)
    score: Mapped[float] = mapped_column(Float, default=0)
    answer_source: Mapped[str] = mapped_column(String(32), default="manual")
    auto_correct_by_whitelist: Mapped[bool] = mapped_column(Boolean, default=False)
    submitted_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), index=True)

    __table_args__ = (
        Index("idx_magic_quiz_answers_export", "video_id", "quiz_point_id", "submitted_at"),
    )


class MagicQuizPointPassRecord(Base):
    __tablename__ = "magic_quiz_point_pass_records"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)
    video_id: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)
    quiz_point_id: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)
    attempt_no: Mapped[int] = mapped_column(Integer, default=1)
    score: Mapped[float] = mapped_column(Float, default=0)
    passed: Mapped[bool] = mapped_column(Boolean, default=False)
    source: Mapped[str] = mapped_column(String(32), default="manual")
    passed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    __table_args__ = (
        Index("idx_magic_quiz_point_pass_records", "video_id", "quiz_point_id", "user_id"),
    )


class MagicVideoWatchConfirmSetting(Base):
    __tablename__ = "magic_video_watch_confirm_settings"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    video_id: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    interval_seconds: Mapped[int] = mapped_column(Integer, default=300)
    message: Mapped[str] = mapped_column(String(255), default="请确认你正在观看视频")
    button_text: Mapped[str] = mapped_column(String(64), default="继续学习")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        UniqueConstraint("video_id", name="uk_magic_video_watch_confirm_settings_video"),
    )


class MagicVideoWatchConfirmLog(Base):
    __tablename__ = "magic_video_watch_confirm_logs"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)
    video_id: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)
    progress_seconds: Mapped[float] = mapped_column(Float, default=0)
    confirm_round: Mapped[int] = mapped_column(Integer, default=1)
    confirmed_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    __table_args__ = (
        Index("idx_magic_video_watch_confirm_logs_video_user", "video_id", "user_id", "confirmed_at"),
    )


class MagicVideoWhitelist(Base):
    __tablename__ = "magic_video_whitelist"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    video_id: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)
    user_id: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)
    note: Mapped[str] = mapped_column(String(255), default="")
    created_by: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    __table_args__ = (
        UniqueConstraint("video_id", "user_id", name="uk_magic_video_whitelist_video_user"),
    )


class MagicAudioUpload(Base):
    __tablename__ = "magic_audio_uploads"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)
    reading_content_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, index=True)
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    file_path: Mapped[str] = mapped_column(String(512), nullable=False)
    file_size: Mapped[int] = mapped_column(BigInteger, default=0)
    mime_type: Mapped[str] = mapped_column(String(128), default="")
    remark: Mapped[str] = mapped_column(String(255), default="")
    source: Mapped[str] = mapped_column(String(32), default="manual")
    auto_checkin_by_whitelist: Mapped[bool] = mapped_column(Boolean, default=False)
    uploaded_on: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), index=True)
    uploaded_date: Mapped[datetime] = mapped_column(Date, server_default=func.current_date(), index=True)
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index("idx_magic_audio_uploads_user_month", "user_id", "uploaded_date", "is_deleted"),
        Index("idx_magic_audio_uploads_reading_content_id", "reading_content_id"),
        Index("idx_magic_audio_uploads_user_content", "user_id", "reading_content_id", "is_deleted"),
    )


class MagicAutoAction(Base):
    __tablename__ = "magic_auto_actions"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    action_type: Mapped[str] = mapped_column(String(32), nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="pending")
    target_user_id: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)
    target_date: Mapped[date | None] = mapped_column(Date, nullable=True, index=True)
    video_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, index=True)
    reading_content_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, index=True)
    trigger_source: Mapped[str] = mapped_column(String(32), default="")
    trigger_ref_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, index=True)
    dedupe_key: Mapped[str] = mapped_column(String(255), nullable=False)
    window_start_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    window_end_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    scheduled_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    executed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    attempt_count: Mapped[int] = mapped_column(Integer, default=0)
    last_error: Mapped[str] = mapped_column(Text, default="")
    created_by: Mapped[int | None] = mapped_column(BigInteger, nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        UniqueConstraint("dedupe_key", name="uk_magic_auto_actions_dedupe"),
        Index("idx_magic_auto_actions_due", "status", "scheduled_at", "window_end_at"),
        Index("idx_magic_auto_actions_target", "action_type", "target_user_id", "target_date"),
    )


class UserWhitelist(Base):
    __tablename__ = "user_whitelist"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    auto_checkin_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    course_exempt_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    allow_video_seek: Mapped[bool] = mapped_column(Boolean, default=False)
    auto_answer_correct: Mapped[bool] = mapped_column(Boolean, default=False)
    remark: Mapped[str] = mapped_column(String(255), default="")
    created_by: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        UniqueConstraint("user_id", name="uk_user_whitelist_user"),
    )


# =========================================================================
# 考试管理（独立卷库式）：题库 / 试卷 / 派发 / 提交 / 单题作答 / 导入任务
# =========================================================================


class QuestionBank(Base):
    __tablename__ = "question_bank"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    question_type: Mapped[str] = mapped_column(String(16), nullable=False)
    stem: Mapped[str] = mapped_column(Text, nullable=False)
    options_json: Mapped[str | None] = mapped_column(LONGTEXT, nullable=True)
    correct_answer_json: Mapped[str | None] = mapped_column(LONGTEXT, nullable=True)
    default_score: Mapped[float] = mapped_column(Float, default=5.0)
    category: Mapped[str] = mapped_column(String(128), default="")
    tag: Mapped[str] = mapped_column(String(255), default="")
    difficulty: Mapped[str] = mapped_column(String(32), default="")
    explanation: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="active")
    source: Mapped[str] = mapped_column(String(32), default="manual")
    created_by: Mapped[int] = mapped_column(BigInteger, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        Index("idx_question_bank_status_type", "status", "question_type", "created_at"),
        Index("idx_question_bank_category", "category"),
    )


class Paper(Base):
    __tablename__ = "papers"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    total_score: Mapped[float] = mapped_column(Float, default=0)
    pass_score: Mapped[float] = mapped_column(Float, default=60)
    duration_minutes: Mapped[int] = mapped_column(Integer, default=0)
    auto_grade_objective: Mapped[bool] = mapped_column(Boolean, default=True)
    manual_review_subjective: Mapped[bool] = mapped_column(Boolean, default=True)
    shuffle_questions: Mapped[bool] = mapped_column(Boolean, default=False)
    show_answer_after: Mapped[str] = mapped_column(String(16), default="after_submit")
    status: Mapped[str] = mapped_column(String(16), default="draft")
    question_count: Mapped[int] = mapped_column(Integer, default=0)
    created_by: Mapped[int] = mapped_column(BigInteger, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        Index("idx_papers_status_created", "status", "created_at"),
    )


class PaperQuestion(Base):
    __tablename__ = "paper_questions"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    paper_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    question_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    score_override: Mapped[float | None] = mapped_column(Float, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    section_name: Mapped[str] = mapped_column(String(128), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    __table_args__ = (
        UniqueConstraint("paper_id", "question_id", name="uk_paper_questions_paper_q"),
        Index("idx_paper_questions_paper_sort", "paper_id", "sort_order"),
    )


class PaperAssignment(Base):
    __tablename__ = "paper_assignments"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    paper_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    user_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    max_attempts: Mapped[int] = mapped_column(Integer, default=1)
    attempt_count: Mapped[int] = mapped_column(Integer, default=0)
    deadline_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="pending")
    wecom_push_status: Mapped[str] = mapped_column(String(16), default="none")
    wecom_push_payload_json: Mapped[str | None] = mapped_column(LONGTEXT, nullable=True)
    wecom_push_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    wecom_pushed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_by: Mapped[int] = mapped_column(BigInteger, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        UniqueConstraint("paper_id", "user_id", name="uk_paper_assignments_paper_user"),
        Index("idx_paper_assignments_user_status", "user_id", "status"),
        Index("idx_paper_assignments_paper_status", "paper_id", "status"),
    )


class PaperSubmission(Base):
    __tablename__ = "paper_submissions"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    assignment_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    paper_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    user_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    attempt_no: Mapped[int] = mapped_column(Integer, default=1)
    status: Mapped[str] = mapped_column(String(16), default="in_progress")
    auto_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    manual_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    final_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    is_pass: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    started_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    graded_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    graded_by: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (
        Index("idx_paper_submissions_assign", "assignment_id", "attempt_no"),
        Index("idx_paper_submissions_status", "status", "submitted_at"),
        Index("idx_paper_submissions_user", "user_id", "paper_id"),
    )


class PaperAnswer(Base):
    __tablename__ = "paper_answers"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    submission_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    paper_question_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    question_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    question_type: Mapped[str] = mapped_column(String(16), nullable=False)
    answer_json: Mapped[str | None] = mapped_column(LONGTEXT, nullable=True)
    auto_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    manual_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    final_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    is_correct: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    __table_args__ = (
        UniqueConstraint("submission_id", "paper_question_id", name="uk_paper_answers_sub_pq"),
        Index("idx_paper_answers_submission", "submission_id"),
    )


class QuestionImportJob(Base):
    __tablename__ = "question_import_jobs"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    created_by: Mapped[int] = mapped_column(BigInteger, nullable=False)
    source: Mapped[str] = mapped_column(String(16), default="excel")
    original_name: Mapped[str] = mapped_column(String(255), default="")
    total_rows: Mapped[int] = mapped_column(Integer, default=0)
    valid_rows: Mapped[int] = mapped_column(Integer, default=0)
    invalid_rows: Mapped[int] = mapped_column(Integer, default=0)
    rows_json: Mapped[str] = mapped_column(LONGTEXT, default="[]")
    committed: Mapped[bool] = mapped_column(Boolean, default=False)
    committed_count: Mapped[int] = mapped_column(Integer, default=0)
    committed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        Index("idx_question_import_jobs_creator", "created_by", "created_at"),
    )
