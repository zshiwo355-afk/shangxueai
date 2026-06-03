"""考试 / 通关模块的 Pydantic DTO。

仅做契约定义，不引用 ORM / 业务逻辑，保证可被 helpers、admin_routes、
user_routes 安全 import。
"""
from __future__ import annotations

from pydantic import BaseModel, Field, field_validator

from ..schemas import StateView


class ExamCreateRequest(BaseModel):
    user_id: int = Field(..., gt=0)
    title: str = Field(default="陪练考试", max_length=255)
    fixed_training_type: str | None = Field(default=None, max_length=64)
    fixed_difficulty: str | None = Field(default=None, max_length=32)
    fixed_customer_type: str | None = Field(default=None, max_length=64)
    ai_weight: float = Field(default=0.5, ge=0.0, le=1.0)
    pass_score: int = Field(default=60, ge=0, le=100)
    max_attempts: int = Field(default=2, ge=1, le=10)
    deadline_at: str | None = None

    @field_validator("fixed_training_type", "fixed_difficulty", "fixed_customer_type", mode="before")
    @classmethod
    def _empty_to_none(cls, v):
        if v is None:
            return None
        s = str(v).strip()
        return s or None


class ExamBatchCreateRequest(BaseModel):
    user_ids: list[int] = Field(..., min_length=1)
    title: str = Field(default="陪练通关", max_length=255)
    fixed_training_type: str | None = Field(default=None, max_length=64)
    fixed_difficulty: str | None = Field(default=None, max_length=32)
    fixed_customer_type: str | None = Field(default=None, max_length=64)
    ai_weight: float = Field(default=0.5, ge=0.0, le=1.0)
    pass_score: int = Field(default=60, ge=0, le=100)
    max_attempts: int = Field(default=2, ge=1, le=10)
    deadline_at: str | None = None

    @field_validator("fixed_training_type", "fixed_difficulty", "fixed_customer_type", mode="before")
    @classmethod
    def _empty_to_none(cls, v):
        if v is None:
            return None
        s = str(v).strip()
        return s or None


class ExamReviewRequest(BaseModel):
    admin_score: float = Field(..., ge=0.0, le=100.0)
    admin_comment: str = Field(default="", max_length=4000)


class ExamDTO(BaseModel):
    id: int
    user_id: int
    user_username: str | None = None
    user_display_name: str | None = None
    title: str
    pass_score: int
    status: str
    attempt_count: int
    max_attempts: int
    fixed_training_type: str | None = None
    fixed_difficulty: str | None = None
    fixed_customer_type: str | None = None
    ai_weight: float = 0.5
    deadline_at: str | None = None
    created_by: int
    created_at: str = ""
    updated_at: str = ""
    completed_at: str | None = None


class ExamAttemptDTO(BaseModel):
    id: int
    exam_id: int
    attempt_no: int
    training_type: str
    difficulty: str
    customer_type: str
    session_id: str | None = None
    status: str
    score: float | None = None
    is_pass: bool | None = None
    result: str | None = None
    review_json: dict | None = None
    chat_history: list[dict] = []
    admin_score: float | None = None
    admin_comment: str | None = None
    final_score: float | None = None
    final_is_pass: bool | None = None
    reviewed_at: str | None = None
    review_pending: bool = False  # 计算字段：completed && !reviewed_at
    started_at: str = ""
    completed_at: str | None = None


class ExamStartResponse(BaseModel):
    session_id: str
    attempt_no: int
    training_type: str
    difficulty: str
    customer_type: str
    visible_brief: dict
    first_customer_message: str
    state: StateView


class ExamFinishResponse(BaseModel):
    attempt: ExamAttemptDTO
    exam_status: str
    can_retry: bool        # 是否还有重考机会（要等管理员复核完才知道，提交时不能立即返回 true）
    attempts_used: int
    max_attempts: int
    pending_review: bool   # 提交后必为 True：等管理员复核


class BulkExamIdsPayload(BaseModel):
    ids: list[int] = Field(..., min_length=1)
    force: bool = False


__all__ = [
    "ExamCreateRequest",
    "ExamBatchCreateRequest",
    "ExamReviewRequest",
    "ExamDTO",
    "ExamAttemptDTO",
    "ExamStartResponse",
    "ExamFinishResponse",
    "BulkExamIdsPayload",
]
