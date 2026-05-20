"""ORM：用户、配置项、训练/考试 session 行、考试任务、考试尝试、训练记录。

字段对齐 backend/sql/init.sql。建表只走 sql 文件，本模块只做 ORM 映射。
"""
from __future__ import annotations

from datetime import datetime

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
    passed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    __table_args__ = (
        Index("idx_magic_quiz_point_pass_records", "video_id", "quiz_point_id", "user_id"),
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
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    file_path: Mapped[str] = mapped_column(String(512), nullable=False)
    file_size: Mapped[int] = mapped_column(BigInteger, default=0)
    mime_type: Mapped[str] = mapped_column(String(128), default="")
    remark: Mapped[str] = mapped_column(String(255), default="")
    uploaded_on: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), index=True)
    uploaded_date: Mapped[datetime] = mapped_column(Date, server_default=func.current_date(), index=True)
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index("idx_magic_audio_uploads_user_month", "user_id", "uploaded_date", "is_deleted"),
    )
