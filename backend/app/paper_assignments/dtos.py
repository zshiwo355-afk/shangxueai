"""试卷派发 / 提交 / 复核 模块的 Pydantic DTO。

仅做契约定义，不引用 ORM 业务，保证可被 helpers/grading/admin_routes/user_routes
安全 import，避免循环依赖。
"""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


# ---------------- 管理端 ----------------


class AssignmentDTO(BaseModel):
    id: int
    paper_id: int
    paper_title: str
    user_id: int
    user_username: str
    user_display_name: str
    max_attempts: int
    attempt_count: int
    deadline_at: str | None = None
    status: str
    wecom_push_status: str
    wecom_push_error: str | None = None
    wecom_pushed_at: str | None = None
    submission_count: int = 0
    pending_review_count: int = 0
    last_final_score: float | None = None
    last_is_pass: bool | None = None
    created_at: str = ""


class AssignmentListResponse(BaseModel):
    items: list[AssignmentDTO]
    total: int
    page: int
    page_size: int


class CreateAssignmentsPayload(BaseModel):
    paper_id: int
    user_ids: list[int] = Field(..., min_length=1)
    max_attempts: int = 1
    deadline_at: str | None = None  # ISO 字符串


class AnswerDTO(BaseModel):
    id: int
    paper_question_id: int
    question_id: int
    question_type: str
    question_type_label: str
    stem: str
    options: list[str]
    correct_answer: list[str]
    score: float
    user_answer: list[str]
    auto_score: float | None
    manual_score: float | None
    ai_score: float | None = None
    ai_comment: str = ""
    final_score: float | None
    is_correct: bool | None
    comment: str = ""
    is_objective: bool


class SubmissionDTO(BaseModel):
    id: int
    assignment_id: int
    paper_id: int
    user_id: int
    attempt_no: int
    status: str
    auto_score: float | None
    manual_score: float | None
    final_score: float | None
    is_pass: bool | None
    started_at: str | None
    submitted_at: str | None
    graded_at: str | None
    graded_by: int | None
    comment: str = ""


class SubmissionDetailResponse(BaseModel):
    submission: SubmissionDTO
    paper: dict[str, Any]
    answers: list[AnswerDTO]


class GradeAnswerPatch(BaseModel):
    answer_id: int
    manual_score: float
    comment: str = ""


class GradeSubmissionPayload(BaseModel):
    answers: list[GradeAnswerPatch] = Field(default_factory=list)
    overall_comment: str = ""


class PendingSubmissionDTO(BaseModel):
    id: int
    assignment_id: int
    paper_id: int
    paper_title: str
    user_id: int
    user_username: str
    user_display_name: str
    attempt_no: int
    auto_score: float | None
    submitted_at: str | None


class PendingSubmissionListResponse(BaseModel):
    items: list[PendingSubmissionDTO]
    total: int
    page: int
    page_size: int


class BulkAssignmentIdsPayload(BaseModel):
    ids: list[int] = Field(..., min_length=1)
    force: bool = False


class BulkAssignmentPushPayload(BaseModel):
    ids: list[int] = Field(..., min_length=1)


# ---------------- 用户端 ----------------


class UserAssignmentDTO(BaseModel):
    id: int
    paper_id: int
    paper_title: str
    paper_description: str = ""
    total_score: float = 0
    pass_score: float = 0
    duration_minutes: int = 0
    question_count: int = 0
    manual_review_subjective: bool = False
    max_attempts: int = 1
    attempt_count: int = 0
    deadline_at: str | None = None
    status: str = "pending"
    last_submission_id: int | None = None
    last_status: str | None = None
    last_final_score: float | None = None
    last_is_pass: bool | None = None
    last_submitted_at: str | None = None
    is_expired: bool = False


class UserPaperQuestionDTO(BaseModel):
    """给学员答题用的题目结构 —— 不含正确答案 / 解析。"""
    id: int  # paper_question_id（提交时回传的 paper_question_id）
    question_id: int
    question_type: str
    question_type_label: str
    sort_order: int
    section_name: str = ""
    stem: str
    options: list[str] = Field(default_factory=list)
    score: float = 0


class UserAssignmentDetail(BaseModel):
    assignment: UserAssignmentDTO
    questions: list[UserPaperQuestionDTO]
    can_start: bool
    block_reason: str = ""
    started_at: str | None = None  # 当前 in_progress 提交的开始时刻（用于断点续答倒计时）
    remain_sec: int | None = None  # 服务端基于 started_at + duration 算出的剩余秒数


class UserAnswerDTO(BaseModel):
    """给学员看结果的题目结构 —— 是否含正确答案/解析由 paper.show_answer_after 控制。"""
    id: int
    paper_question_id: int
    question_id: int
    question_type: str
    question_type_label: str
    stem: str
    options: list[str] = Field(default_factory=list)
    score: float
    user_answer: list[str]
    is_correct: bool | None
    auto_score: float | None
    manual_score: float | None
    ai_score: float | None = None
    ai_comment: str = ""
    final_score: float | None
    comment: str = ""
    is_objective: bool
    correct_answer: list[str] = Field(default_factory=list)  # 按规则展示
    explanation: str = ""  # 按规则展示


class UserSubmissionResult(BaseModel):
    submission: SubmissionDTO
    paper: dict[str, Any]
    answers: list[UserAnswerDTO]
    show_answer: bool  # 是否对学员展示正确答案 / 解析


class SubmitAnswerItem(BaseModel):
    paper_question_id: int
    answer: list[str] = Field(default_factory=list)


class SubmitPayload(BaseModel):
    answers: list[SubmitAnswerItem]


__all__ = [
    "AssignmentDTO",
    "AssignmentListResponse",
    "CreateAssignmentsPayload",
    "AnswerDTO",
    "SubmissionDTO",
    "SubmissionDetailResponse",
    "GradeAnswerPatch",
    "GradeSubmissionPayload",
    "PendingSubmissionDTO",
    "PendingSubmissionListResponse",
    "BulkAssignmentIdsPayload",
    "BulkAssignmentPushPayload",
    "UserAssignmentDTO",
    "UserPaperQuestionDTO",
    "UserAssignmentDetail",
    "UserAnswerDTO",
    "UserSubmissionResult",
    "SubmitAnswerItem",
    "SubmitPayload",
]
