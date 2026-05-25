"""试卷派发 + 提交 + 复核（人工评分）。

派发：管理员选试卷 + 多用户 + 截止/最大次数 → 创建 paper_assignments
推送：调 wecom_push.push_assignment（当前为 stub）
提交：用户端在下一阶段接入；本模块提供占位接口便于联调（status=submitted、可触发判分）
复核：管理员逐题填 manual_score + 评语；服务端合并 final_score
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import delete as sql_delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .auth import get_current_user, require_admin
from .db import get_db
from .models import (
    Paper,
    PaperAnswer,
    PaperAssignment,
    PaperQuestion,
    PaperSubmission,
    QuestionBank,
    User,
)
from .paper_grading import (
    is_objective,
    is_subjective,
    parse_answer,
    parse_options,
    question_type_label,
    score_question,
)
from .wecom_push import push_assignment

router = APIRouter(prefix="/api/admin/paper-assignments", tags=["admin-paper-assignments"])


# ---------------- DTO ----------------


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


# ---------------- helpers ----------------


def _parse_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"日期格式错误：{value}") from exc


def _assignment_to_dto(
    row: PaperAssignment,
    *,
    paper_title: str = "",
    user: User | None = None,
    sub_count: int = 0,
    pending: int = 0,
    last: PaperSubmission | None = None,
) -> AssignmentDTO:
    return AssignmentDTO(
        id=row.id,
        paper_id=row.paper_id,
        paper_title=paper_title,
        user_id=row.user_id,
        user_username=user.username if user else "",
        user_display_name=(user.real_name or user.display_name or user.username) if user else "",
        max_attempts=int(row.max_attempts or 1),
        attempt_count=int(row.attempt_count or 0),
        deadline_at=row.deadline_at.isoformat() if row.deadline_at else None,
        status=row.status or "pending",
        wecom_push_status=row.wecom_push_status or "none",
        wecom_push_error=row.wecom_push_error,
        wecom_pushed_at=row.wecom_pushed_at.isoformat() if row.wecom_pushed_at else None,
        submission_count=int(sub_count),
        pending_review_count=int(pending),
        last_final_score=float(last.final_score) if last and last.final_score is not None else None,
        last_is_pass=bool(last.is_pass) if last and last.is_pass is not None else None,
        created_at=row.created_at.isoformat() if row.created_at else "",
    )


async def _build_assignment_dtos(rows: list[PaperAssignment], db: AsyncSession) -> list[AssignmentDTO]:
    if not rows:
        return []
    assignment_ids = [row.id for row in rows]
    paper_ids = sorted({row.paper_id for row in rows})
    user_ids = sorted({row.user_id for row in rows})

    paper_map: dict[int, str] = {}
    if paper_ids:
        paper_rows = await db.execute(select(Paper.id, Paper.title).where(Paper.id.in_(paper_ids)))
        paper_map = {int(paper_id): title or "" for paper_id, title in paper_rows.all()}

    user_map: dict[int, User] = {}
    if user_ids:
        users = await db.execute(select(User).where(User.id.in_(user_ids)))
        user_map = {int(user.id): user for user in users.scalars().all()}

    count_rows = await db.execute(
        select(PaperSubmission.assignment_id, func.count(PaperSubmission.id))
        .where(PaperSubmission.assignment_id.in_(assignment_ids))
        .group_by(PaperSubmission.assignment_id)
    )
    sub_count_map = {int(assignment_id): int(count) for assignment_id, count in count_rows.all()}

    pending_rows = await db.execute(
        select(PaperSubmission.assignment_id, func.count(PaperSubmission.id))
        .where(
            PaperSubmission.assignment_id.in_(assignment_ids),
            PaperSubmission.status == "submitted",
        )
        .group_by(PaperSubmission.assignment_id)
    )
    pending_map = {int(assignment_id): int(count) for assignment_id, count in pending_rows.all()}

    latest_subq = (
        select(
            PaperSubmission.id.label("id"),
            func.row_number()
            .over(
                partition_by=PaperSubmission.assignment_id,
                order_by=(PaperSubmission.attempt_no.desc(), PaperSubmission.id.desc()),
            )
            .label("rn"),
        )
        .where(PaperSubmission.assignment_id.in_(assignment_ids))
        .subquery()
    )
    last_rows = await db.execute(
        select(PaperSubmission)
        .join(latest_subq, PaperSubmission.id == latest_subq.c.id)
        .where(latest_subq.c.rn == 1)
    )
    last_map: dict[int, PaperSubmission] = {}
    for submission in last_rows.scalars().all():
        last_map.setdefault(int(submission.assignment_id), submission)

    return [
        _assignment_to_dto(
            row,
            paper_title=paper_map.get(int(row.paper_id), ""),
            user=user_map.get(int(row.user_id)),
            sub_count=sub_count_map.get(int(row.id), 0),
            pending=pending_map.get(int(row.id), 0),
            last=last_map.get(int(row.id)),
        )
        for row in rows
    ]


async def _build_assignment_dto(row: PaperAssignment, db: AsyncSession) -> AssignmentDTO:
    return (await _build_assignment_dtos([row], db))[0]


def _submission_to_dto(s: PaperSubmission) -> SubmissionDTO:
    return SubmissionDTO(
        id=s.id,
        assignment_id=s.assignment_id,
        paper_id=s.paper_id,
        user_id=s.user_id,
        attempt_no=int(s.attempt_no or 1),
        status=s.status or "in_progress",
        auto_score=float(s.auto_score) if s.auto_score is not None else None,
        manual_score=float(s.manual_score) if s.manual_score is not None else None,
        final_score=float(s.final_score) if s.final_score is not None else None,
        is_pass=bool(s.is_pass) if s.is_pass is not None else None,
        started_at=s.started_at.isoformat() if s.started_at else None,
        submitted_at=s.submitted_at.isoformat() if s.submitted_at else None,
        graded_at=s.graded_at.isoformat() if s.graded_at else None,
        graded_by=s.graded_by,
        comment=s.comment or "",
    )


async def _recalc_submission(submission: PaperSubmission, db: AsyncSession) -> None:
    """根据 paper_answers 重算 auto/manual/final/is_pass 并更新状态。"""
    answers = (
        await db.execute(
            select(PaperAnswer).where(PaperAnswer.submission_id == submission.id)
        )
    ).scalars().all()
    auto_total = 0.0
    manual_total = 0.0
    has_pending_subjective = False

    # 取试卷的及格分
    paper_res = await db.execute(select(Paper).where(Paper.id == submission.paper_id))
    paper = paper_res.scalar_one_or_none()

    for a in answers:
        if is_objective(a.question_type):
            auto_total += float(a.auto_score or 0)
            a.final_score = float(a.auto_score or 0)
        elif is_subjective(a.question_type):
            if a.manual_score is None:
                has_pending_subjective = True
            else:
                manual_total += float(a.manual_score or 0)
                a.final_score = float(a.manual_score or 0)
        else:
            a.final_score = float(a.auto_score or 0)
            auto_total += float(a.auto_score or 0)

    submission.auto_score = auto_total
    submission.manual_score = manual_total
    if has_pending_subjective:
        submission.status = "submitted"
        submission.final_score = None
        submission.is_pass = None
        submission.graded_at = None
    else:
        submission.final_score = auto_total + manual_total
        submission.status = "graded"
        submission.is_pass = bool(submission.final_score >= float(paper.pass_score)) if paper else None
        submission.graded_at = datetime.now()


async def _ensure_assignment_status(assignment: PaperAssignment, db: AsyncSession) -> None:
    """根据其下提交的状态更新派发任务的 status。"""
    subs = (
        await db.execute(
            select(PaperSubmission).where(PaperSubmission.assignment_id == assignment.id)
        )
    ).scalars().all()
    if not subs:
        if assignment.status not in {"pending", "expired"}:
            assignment.status = "pending"
        return
    if any(s.status == "submitted" for s in subs):
        assignment.status = "pending_review"
        return
    if any(s.status == "in_progress" for s in subs):
        assignment.status = "in_progress"
        return
    if all(s.status == "graded" for s in subs):
        assignment.status = "graded"
        return
    assignment.status = "in_progress"


# ---------------- 派发管理 ----------------


@router.get("")
async def list_assignments(
    page: int | None = Query(None, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    paper_id: int | None = Query(None),
    status_: str | None = Query(None, alias="status"),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> list[AssignmentDTO] | AssignmentListResponse:
    del admin
    stmt = select(PaperAssignment).order_by(PaperAssignment.id.desc())
    count_stmt = select(func.count()).select_from(PaperAssignment)
    if paper_id:
        stmt = stmt.where(PaperAssignment.paper_id == paper_id)
        count_stmt = count_stmt.where(PaperAssignment.paper_id == paper_id)
    if status_:
        stmt = stmt.where(PaperAssignment.status == status_)
        count_stmt = count_stmt.where(PaperAssignment.status == status_)
    total = 0
    if page is not None:
        total = int((await db.execute(count_stmt)).scalar_one() or 0)
        stmt = stmt.limit(page_size).offset((page - 1) * page_size)
    rows = (await db.execute(stmt)).scalars().all()
    items = await _build_assignment_dtos(rows, db)
    if page is None:
        return items
    return AssignmentListResponse(items=items, total=total, page=page, page_size=page_size)


@router.get("/pending-review")
async def list_pending_review(
    page: int | None = Query(None, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> list[AssignmentDTO] | AssignmentListResponse:
    """待复核：包含至少一条 status=submitted 提交的派发。"""
    del admin
    stmt = (
        select(PaperAssignment)
        .join(PaperSubmission, PaperSubmission.assignment_id == PaperAssignment.id)
        .where(PaperSubmission.status == "submitted")
        .group_by(PaperAssignment.id)
        .order_by(PaperAssignment.id.desc())
    )
    total = 0
    if page is not None:
        total = int(
            (
                await db.execute(
                    select(func.count(func.distinct(PaperAssignment.id)))
                    .join(PaperSubmission, PaperSubmission.assignment_id == PaperAssignment.id)
                    .where(PaperSubmission.status == "submitted")
                )
            ).scalar_one()
            or 0
        )
        stmt = stmt.limit(page_size).offset((page - 1) * page_size)
    rows = (await db.execute(stmt)).scalars().all()
    items = await _build_assignment_dtos(rows, db)
    if page is None:
        return items
    return AssignmentListResponse(items=items, total=total, page=page, page_size=page_size)


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


@router.get("/pending-submissions")
async def list_pending_submissions(
    page: int | None = Query(None, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> list[PendingSubmissionDTO] | PendingSubmissionListResponse:
    """待复核 submissions 扁平表（status=submitted）。"""
    del admin
    stmt = select(PaperSubmission).where(PaperSubmission.status == "submitted").order_by(PaperSubmission.submitted_at.desc())
    total = 0
    if page is not None:
        total = int(
            (
                await db.execute(
                    select(func.count()).select_from(PaperSubmission).where(PaperSubmission.status == "submitted")
                )
            ).scalar_one()
            or 0
        )
        stmt = stmt.limit(page_size).offset((page - 1) * page_size)
    rows = (await db.execute(stmt)).scalars().all()

    paper_ids = sorted({row.paper_id for row in rows})
    user_ids = sorted({row.user_id for row in rows})
    paper_map: dict[int, str] = {}
    if paper_ids:
        paper_rows = await db.execute(select(Paper.id, Paper.title).where(Paper.id.in_(paper_ids)))
        paper_map = {int(paper_id): title or "" for paper_id, title in paper_rows.all()}
    user_map: dict[int, User] = {}
    if user_ids:
        user_rows = await db.execute(select(User).where(User.id.in_(user_ids)))
        user_map = {int(user.id): user for user in user_rows.scalars().all()}

    out: list[PendingSubmissionDTO] = []
    for s in rows:
        user = user_map.get(int(s.user_id))
        out.append(
            PendingSubmissionDTO(
                id=s.id,
                assignment_id=s.assignment_id,
                paper_id=s.paper_id,
                paper_title=paper_map.get(int(s.paper_id), ""),
                user_id=s.user_id,
                user_username=user.username if user else "",
                user_display_name=(user.real_name or user.display_name or user.username) if user else "",
                attempt_no=int(s.attempt_no or 1),
                auto_score=float(s.auto_score) if s.auto_score is not None else None,
                submitted_at=s.submitted_at.isoformat() if s.submitted_at else None,
            )
        )
    if page is None:
        return out
    return PendingSubmissionListResponse(items=out, total=total, page=page, page_size=page_size)


@router.post("", response_model=list[AssignmentDTO])
async def create_assignments(
    payload: CreateAssignmentsPayload,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> list[AssignmentDTO]:
    paper_res = await db.execute(select(Paper).where(Paper.id == payload.paper_id))
    paper = paper_res.scalar_one_or_none()
    if not paper:
        raise HTTPException(status_code=404, detail="试卷不存在。")
    if paper.status != "published":
        raise HTTPException(status_code=400, detail="仅已发布的试卷可派发。")
    if (paper.question_count or 0) <= 0:
        raise HTTPException(status_code=400, detail="试卷尚无题目。")

    user_rows = (
        await db.execute(select(User).where(User.id.in_(payload.user_ids)))
    ).scalars().all()
    found_ids = {u.id for u in user_rows}
    missing = [uid for uid in payload.user_ids if uid not in found_ids]
    if missing:
        raise HTTPException(status_code=400, detail=f"用户不存在：{missing}")

    deadline = _parse_datetime(payload.deadline_at)

    # 已存在派发的用户（uniq 冲突避免）
    existing_pairs = (
        await db.execute(
            select(PaperAssignment).where(
                PaperAssignment.paper_id == payload.paper_id,
                PaperAssignment.user_id.in_(payload.user_ids),
            )
        )
    ).scalars().all()
    existing_user_ids = {row.user_id for row in existing_pairs}
    existing_by_user = {row.user_id: row for row in existing_pairs}

    created: list[PaperAssignment] = []
    for uid in payload.user_ids:
        if uid in existing_user_ids:
            created.append(existing_by_user[uid])
            continue
        row = PaperAssignment(
            paper_id=payload.paper_id,
            user_id=uid,
            max_attempts=int(payload.max_attempts or 1),
            deadline_at=deadline,
            status="pending",
            created_by=admin.id,
        )
        db.add(row)
        await db.flush()
        await db.refresh(row)
        created.append(row)

    return await _build_assignment_dtos(created, db)


@router.delete("/{assignment_id}")
async def delete_assignment(
    assignment_id: int,
    force: bool = Query(False, description="为 true 时连同已有提交一起级联删除"),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    del admin
    sub_count = (
        await db.execute(
            select(func.count()).select_from(PaperSubmission).where(
                PaperSubmission.assignment_id == assignment_id
            )
        )
    ).scalar_one()
    if sub_count and not force:
        raise HTTPException(
            status_code=409,
            detail=f"该派发已有 {int(sub_count)} 条提交记录，请确认后强制删除。",
        )

    # 级联清理 paper_answers + paper_submissions
    if sub_count:
        sub_ids = (
            await db.execute(
                select(PaperSubmission.id).where(PaperSubmission.assignment_id == assignment_id)
            )
        ).scalars().all()
        if sub_ids:
            await db.execute(sql_delete(PaperAnswer).where(PaperAnswer.submission_id.in_(sub_ids)))
            await db.execute(sql_delete(PaperSubmission).where(PaperSubmission.id.in_(sub_ids)))

    res = await db.execute(sql_delete(PaperAssignment).where(PaperAssignment.id == assignment_id))
    if res.rowcount == 0:
        raise HTTPException(status_code=404, detail="派发任务不存在。")
    return {"success": True, "deleted_submissions": int(sub_count)}


@router.post("/{assignment_id}/wecom-push", response_model=AssignmentDTO)
async def push_to_wecom(
    assignment_id: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> AssignmentDTO:
    del admin
    res = await db.execute(select(PaperAssignment).where(PaperAssignment.id == assignment_id))
    row = res.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="派发任务不存在。")
    result = await push_assignment(assignment_id, db)
    if not result.ok:
        raise HTTPException(status_code=500, detail=result.message)
    await db.flush()
    await db.refresh(row)
    return await _build_assignment_dto(row, db)


# ---------------- 提交记录 ----------------


@router.get("/{assignment_id}/submissions", response_model=list[SubmissionDTO])
async def list_submissions(
    assignment_id: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> list[SubmissionDTO]:
    del admin
    rows = (
        await db.execute(
            select(PaperSubmission)
            .where(PaperSubmission.assignment_id == assignment_id)
            .order_by(PaperSubmission.attempt_no.desc(), PaperSubmission.id.desc())
        )
    ).scalars().all()
    return [_submission_to_dto(s) for s in rows]


@router.get("/submissions/{submission_id}", response_model=SubmissionDetailResponse)
async def get_submission_detail(
    submission_id: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> SubmissionDetailResponse:
    del admin
    res = await db.execute(select(PaperSubmission).where(PaperSubmission.id == submission_id))
    sub = res.scalar_one_or_none()
    if not sub:
        raise HTTPException(status_code=404, detail="提交不存在。")

    paper_res = await db.execute(select(Paper).where(Paper.id == sub.paper_id))
    paper = paper_res.scalar_one_or_none()

    answer_rows = (
        await db.execute(
            select(PaperAnswer, PaperQuestion, QuestionBank)
            .join(PaperQuestion, PaperQuestion.id == PaperAnswer.paper_question_id)
            .join(QuestionBank, QuestionBank.id == PaperAnswer.question_id)
            .where(PaperAnswer.submission_id == submission_id)
            .order_by(PaperQuestion.sort_order, PaperQuestion.id)
        )
    ).all()

    answers: list[AnswerDTO] = []
    for ans, pq, qb in answer_rows:
        score = float(pq.score_override) if pq.score_override is not None else float(qb.default_score or 0)
        answers.append(
            AnswerDTO(
                id=ans.id,
                paper_question_id=pq.id,
                question_id=qb.id,
                question_type=qb.question_type,
                question_type_label=question_type_label(qb.question_type),
                stem=qb.stem,
                options=parse_options(qb.options_json),
                correct_answer=parse_answer(qb.correct_answer_json),
                score=score,
                user_answer=parse_answer(ans.answer_json),
                auto_score=float(ans.auto_score) if ans.auto_score is not None else None,
                manual_score=float(ans.manual_score) if ans.manual_score is not None else None,
                final_score=float(ans.final_score) if ans.final_score is not None else None,
                is_correct=bool(ans.is_correct) if ans.is_correct is not None else None,
                comment=ans.comment or "",
                is_objective=is_objective(qb.question_type),
            )
        )

    paper_summary = {
        "id": paper.id,
        "title": paper.title,
        "total_score": float(paper.total_score or 0),
        "pass_score": float(paper.pass_score or 0),
        "question_count": int(paper.question_count or 0),
    } if paper else {}

    return SubmissionDetailResponse(
        submission=_submission_to_dto(sub),
        paper=paper_summary,
        answers=answers,
    )


@router.post("/submissions/{submission_id}/grade", response_model=SubmissionDetailResponse)
async def grade_submission(
    submission_id: int,
    payload: GradeSubmissionPayload,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> SubmissionDetailResponse:
    res = await db.execute(select(PaperSubmission).where(PaperSubmission.id == submission_id))
    sub = res.scalar_one_or_none()
    if not sub:
        raise HTTPException(status_code=404, detail="提交不存在。")
    if sub.status == "in_progress":
        raise HTTPException(status_code=400, detail="尚未提交，无法评分。")

    patch_map = {int(patch.answer_id): patch for patch in payload.answers}
    answer_rows = []
    if patch_map:
        answer_rows = (
            await db.execute(
                select(PaperAnswer, PaperQuestion, QuestionBank)
                .join(PaperQuestion, PaperQuestion.id == PaperAnswer.paper_question_id)
                .join(QuestionBank, QuestionBank.id == PaperAnswer.question_id)
                .where(
                    PaperAnswer.submission_id == submission_id,
                    PaperAnswer.id.in_(patch_map.keys()),
                )
            )
        ).all()

    for ans, pq, qb in answer_rows:
        patch = patch_map.get(int(ans.id))
        if not patch:
            continue
        if not pq or not qb:
            continue
        max_score = float(pq.score_override) if pq.score_override is not None else float(qb.default_score or 0)
        if patch.manual_score < 0 or patch.manual_score > max_score:
            raise HTTPException(
                status_code=400,
                detail=f"题目 {ans.paper_question_id} 评分需在 0 ~ {max_score} 之间。",
            )
        ans.manual_score = float(patch.manual_score)
        if patch.comment is not None:
            ans.comment = patch.comment.strip()

    if payload.overall_comment is not None:
        sub.comment = payload.overall_comment.strip()
    sub.graded_by = admin.id
    await _recalc_submission(sub, db)
    await db.flush()

    # 同步派发状态
    assign_res = await db.execute(select(PaperAssignment).where(PaperAssignment.id == sub.assignment_id))
    assign = assign_res.scalar_one_or_none()
    if assign:
        await _ensure_assignment_status(assign, db)

    await db.flush()
    return await get_submission_detail(submission_id, db, admin)


# ---------------- 占位：用户提交（联调用） ----------------


class SubmitAnswerItem(BaseModel):
    paper_question_id: int
    answer: list[str] = Field(default_factory=list)


class SubmitPayload(BaseModel):
    answers: list[SubmitAnswerItem]


submit_router = APIRouter(prefix="/api/papers", tags=["paper-submit"])


# ---------------- 用户端 DTO ----------------


class UserAssignmentDTO(BaseModel):
    id: int
    paper_id: int
    paper_title: str
    paper_description: str = ""
    total_score: float = 0
    pass_score: float = 0
    duration_minutes: int = 0
    question_count: int = 0
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


# ---------------- 用户端帮助函数 ----------------


def _is_assignment_expired(assignment: PaperAssignment) -> bool:
    return bool(assignment.deadline_at and assignment.deadline_at < datetime.now())


def _should_show_answer(paper: Paper | None, submission: PaperSubmission | None) -> bool:
    if not paper or not submission:
        return False
    policy = (paper.show_answer_after or "after_submit").strip()
    if policy == "never":
        return False
    if policy == "after_graded":
        return submission.status == "graded"
    # 默认 after_submit：提交后即可看
    return submission.status in {"submitted", "graded"}


def _user_assignment_to_dto(
    assignment: PaperAssignment,
    *,
    paper: Paper | None = None,
    last: PaperSubmission | None = None,
) -> UserAssignmentDTO:
    return UserAssignmentDTO(
        id=assignment.id,
        paper_id=assignment.paper_id,
        paper_title=paper.title if paper else "",
        paper_description=(paper.description or "") if paper else "",
        total_score=float(paper.total_score or 0) if paper else 0,
        pass_score=float(paper.pass_score or 0) if paper else 0,
        duration_minutes=int(paper.duration_minutes or 0) if paper else 0,
        question_count=int(paper.question_count or 0) if paper else 0,
        max_attempts=int(assignment.max_attempts or 1),
        attempt_count=int(assignment.attempt_count or 0),
        deadline_at=assignment.deadline_at.isoformat() if assignment.deadline_at else None,
        status=assignment.status or "pending",
        last_submission_id=last.id if last else None,
        last_status=last.status if last else None,
        last_final_score=float(last.final_score) if last and last.final_score is not None else None,
        last_is_pass=bool(last.is_pass) if last and last.is_pass is not None else None,
        last_submitted_at=last.submitted_at.isoformat() if last and last.submitted_at else None,
        is_expired=_is_assignment_expired(assignment),
    )


async def _user_assignment_dtos(
    assignments: list[PaperAssignment],
    db: AsyncSession,
) -> list[UserAssignmentDTO]:
    if not assignments:
        return []
    assignment_ids = [item.id for item in assignments]
    paper_ids = sorted({item.paper_id for item in assignments})

    paper_map: dict[int, Paper] = {}
    if paper_ids:
        papers = await db.execute(select(Paper).where(Paper.id.in_(paper_ids)))
        paper_map = {int(paper.id): paper for paper in papers.scalars().all()}

    latest_subq = (
        select(
            PaperSubmission.id.label("id"),
            func.row_number()
            .over(
                partition_by=PaperSubmission.assignment_id,
                order_by=(PaperSubmission.attempt_no.desc(), PaperSubmission.id.desc()),
            )
            .label("rn"),
        )
        .where(
            PaperSubmission.assignment_id.in_(assignment_ids),
            PaperSubmission.status != "in_progress",
        )
        .subquery()
    )
    last_rows = await db.execute(
        select(PaperSubmission)
        .join(latest_subq, PaperSubmission.id == latest_subq.c.id)
        .where(latest_subq.c.rn == 1)
    )
    last_map: dict[int, PaperSubmission] = {}
    for submission in last_rows.scalars().all():
        last_map.setdefault(int(submission.assignment_id), submission)

    return [
        _user_assignment_to_dto(
            assignment,
            paper=paper_map.get(int(assignment.paper_id)),
            last=last_map.get(int(assignment.id)),
        )
        for assignment in assignments
    ]


async def _user_assignment_dto(
    assignment: PaperAssignment, db: AsyncSession
) -> UserAssignmentDTO:
    return (await _user_assignment_dtos([assignment], db))[0]


# ---------------- 用户端：我的考试 ----------------


@submit_router.get("/my-assignments", response_model=list[UserAssignmentDTO])
async def list_my_assignments(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[UserAssignmentDTO]:
    rows = (
        await db.execute(
            select(PaperAssignment)
            .where(PaperAssignment.user_id == user.id)
            .order_by(PaperAssignment.id.desc())
        )
    ).scalars().all()
    return await _user_assignment_dtos(rows, db)


@submit_router.get("/assignments/{assignment_id}", response_model=UserAssignmentDetail)
async def get_assignment_for_user(
    assignment_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> UserAssignmentDetail:
    """学员答题用：返回试卷题目（无正确答案 / 解析）。"""
    assignment = (
        await db.execute(select(PaperAssignment).where(PaperAssignment.id == assignment_id))
    ).scalar_one_or_none()
    if not assignment:
        raise HTTPException(status_code=404, detail="考试不存在。")
    if assignment.user_id != user.id:
        raise HTTPException(status_code=403, detail="无权查看他人的考试。")

    paper = (
        await db.execute(select(Paper).where(Paper.id == assignment.paper_id))
    ).scalar_one_or_none()
    if not paper:
        raise HTTPException(status_code=404, detail="试卷不存在。")

    rows = (
        await db.execute(
            select(PaperQuestion, QuestionBank)
            .join(QuestionBank, QuestionBank.id == PaperQuestion.question_id)
            .where(PaperQuestion.paper_id == paper.id)
            .order_by(PaperQuestion.sort_order, PaperQuestion.id)
        )
    ).all()

    questions: list[UserPaperQuestionDTO] = []
    for pq, qb in rows:
        score = float(pq.score_override) if pq.score_override is not None else float(qb.default_score or 0)
        questions.append(
            UserPaperQuestionDTO(
                id=pq.id,
                question_id=qb.id,
                question_type=qb.question_type,
                question_type_label=question_type_label(qb.question_type),
                sort_order=pq.sort_order,
                section_name=pq.section_name or "",
                stem=qb.stem,
                options=parse_options(qb.options_json),
                score=score,
            )
        )

    can_start = True
    block_reason = ""
    if paper.status != "published":
        can_start = False
        block_reason = "试卷尚未发布。"
    elif _is_assignment_expired(assignment):
        can_start = False
        block_reason = "已超过考试截止时间。"
    elif int(assignment.attempt_count or 0) >= int(assignment.max_attempts or 1):
        can_start = False
        block_reason = "答题次数已用完。"

    # 找/建当前 in_progress 提交，用于：
    #   - 断点续答（刷新页面后倒计时不重置）
    #   - 正确处理"用户开始但未提交"的中间状态
    started_at_iso: str | None = None
    remain_sec: int | None = None
    duration_min = int(paper.duration_minutes or 0)

    if can_start:
        in_progress = (
            await db.execute(
                select(PaperSubmission)
                .where(
                    PaperSubmission.assignment_id == assignment.id,
                    PaperSubmission.user_id == user.id,
                    PaperSubmission.status == "in_progress",
                )
                .order_by(PaperSubmission.id.asc())
                .limit(1)
            )
        ).scalar_one_or_none()

        if in_progress is None:
            in_progress = PaperSubmission(
                assignment_id=assignment.id,
                paper_id=assignment.paper_id,
                user_id=user.id,
                attempt_no=int(assignment.attempt_count or 0) + 1,
                status="in_progress",
                started_at=datetime.now(),
            )
            db.add(in_progress)
            await db.flush()
            await db.refresh(in_progress)

        started_at_iso = in_progress.started_at.isoformat() if in_progress.started_at else None
        if duration_min > 0 and in_progress.started_at:
            deadline = in_progress.started_at + timedelta(minutes=duration_min)
            remain = int((deadline - datetime.now()).total_seconds())
            remain_sec = max(0, remain)
            if remain_sec <= 0:
                can_start = False
                block_reason = "本次答题时间已用尽，请直接提交或开始新的一次。"

    return UserAssignmentDetail(
        assignment=await _user_assignment_dto(assignment, db),
        questions=questions,
        can_start=can_start,
        block_reason=block_reason,
        started_at=started_at_iso,
        remain_sec=remain_sec,
    )


@submit_router.get(
    "/assignments/{assignment_id}/my-submissions",
    response_model=list[SubmissionDTO],
)
async def list_my_submissions(
    assignment_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[SubmissionDTO]:
    assignment = (
        await db.execute(select(PaperAssignment).where(PaperAssignment.id == assignment_id))
    ).scalar_one_or_none()
    if not assignment:
        raise HTTPException(status_code=404, detail="考试不存在。")
    if assignment.user_id != user.id:
        raise HTTPException(status_code=403, detail="无权查看他人的考试。")

    rows = (
        await db.execute(
            select(PaperSubmission)
            .where(PaperSubmission.assignment_id == assignment_id)
            .order_by(PaperSubmission.attempt_no.desc(), PaperSubmission.id.desc())
        )
    ).scalars().all()
    return [_submission_to_dto(s) for s in rows]


@submit_router.get("/submissions/{submission_id}", response_model=UserSubmissionResult)
async def get_my_submission(
    submission_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> UserSubmissionResult:
    sub = (
        await db.execute(select(PaperSubmission).where(PaperSubmission.id == submission_id))
    ).scalar_one_or_none()
    if not sub:
        raise HTTPException(status_code=404, detail="答卷不存在。")
    if sub.user_id != user.id:
        raise HTTPException(status_code=403, detail="无权查看他人的答卷。")

    paper = (
        await db.execute(select(Paper).where(Paper.id == sub.paper_id))
    ).scalar_one_or_none()
    show_answer = _should_show_answer(paper, sub)

    answer_rows = (
        await db.execute(
            select(PaperAnswer, PaperQuestion, QuestionBank)
            .join(PaperQuestion, PaperQuestion.id == PaperAnswer.paper_question_id)
            .join(QuestionBank, QuestionBank.id == PaperAnswer.question_id)
            .where(PaperAnswer.submission_id == submission_id)
            .order_by(PaperQuestion.sort_order, PaperQuestion.id)
        )
    ).all()

    answers: list[UserAnswerDTO] = []
    for ans, pq, qb in answer_rows:
        score = float(pq.score_override) if pq.score_override is not None else float(qb.default_score or 0)
        answers.append(
            UserAnswerDTO(
                id=ans.id,
                paper_question_id=pq.id,
                question_id=qb.id,
                question_type=qb.question_type,
                question_type_label=question_type_label(qb.question_type),
                stem=qb.stem,
                options=parse_options(qb.options_json),
                score=score,
                user_answer=parse_answer(ans.answer_json),
                is_correct=bool(ans.is_correct) if ans.is_correct is not None else None,
                auto_score=float(ans.auto_score) if ans.auto_score is not None else None,
                manual_score=float(ans.manual_score) if ans.manual_score is not None else None,
                final_score=float(ans.final_score) if ans.final_score is not None else None,
                comment=ans.comment or "",
                is_objective=is_objective(qb.question_type),
                correct_answer=parse_answer(qb.correct_answer_json) if show_answer else [],
                explanation=(qb.explanation or "") if show_answer else "",
            )
        )

    paper_summary = {
        "id": paper.id,
        "title": paper.title,
        "total_score": float(paper.total_score or 0),
        "pass_score": float(paper.pass_score or 0),
        "question_count": int(paper.question_count or 0),
        "show_answer_after": paper.show_answer_after or "after_submit",
    } if paper else {}

    return UserSubmissionResult(
        submission=_submission_to_dto(sub),
        paper=paper_summary,
        answers=answers,
        show_answer=show_answer,
    )


# ---------------- 用户端：提交 ----------------


@submit_router.post("/assignments/{assignment_id}/submit", response_model=SubmissionDTO)
async def submit_paper_for_user(
    assignment_id: int,
    payload: SubmitPayload,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> SubmissionDTO:
    """学员提交答卷：写答案 + 自动判分客观题，简答题进入复核。

    复用同一次 GET 时建好的 in_progress 提交（保留 started_at 用于服务端超时校验），
    没有 in_progress 时再新建。
    """
    res = await db.execute(select(PaperAssignment).where(PaperAssignment.id == assignment_id))
    assign = res.scalar_one_or_none()
    if not assign:
        raise HTTPException(status_code=404, detail="考试不存在。")
    if assign.user_id != user.id:
        raise HTTPException(status_code=403, detail="无权提交他人试卷。")
    if _is_assignment_expired(assign):
        raise HTTPException(status_code=400, detail="已超过考试截止时间。")
    if assign.attempt_count >= assign.max_attempts:
        raise HTTPException(status_code=400, detail="已用尽答题次数。")

    paper_res = await db.execute(select(Paper).where(Paper.id == assign.paper_id))
    paper = paper_res.scalar_one_or_none()
    if not paper:
        raise HTTPException(status_code=404, detail="试卷不存在。")
    if paper.status != "published":
        raise HTTPException(status_code=400, detail="试卷尚未发布。")

    # 找已有 in_progress 提交，复用之（保留 started_at）
    submission = (
        await db.execute(
            select(PaperSubmission)
            .where(
                PaperSubmission.assignment_id == assign.id,
                PaperSubmission.user_id == user.id,
                PaperSubmission.status == "in_progress",
            )
            .order_by(PaperSubmission.id.desc())
            .limit(1)
        )
    ).scalar_one_or_none()

    if submission is None:
        attempt_no = int(assign.attempt_count or 0) + 1
        submission = PaperSubmission(
            assignment_id=assign.id,
            paper_id=assign.paper_id,
            user_id=user.id,
            attempt_no=attempt_no,
            status="submitted",
            started_at=datetime.now(),
            submitted_at=datetime.now(),
        )
        db.add(submission)
        await db.flush()
    else:
        # 服务端兜底：基于 started_at + duration 校验是否超时
        if int(paper.duration_minutes or 0) > 0 and submission.started_at:
            deadline = submission.started_at + timedelta(minutes=int(paper.duration_minutes))
            # 给 30 秒缓冲，前端倒计时跳变到 0 后立即提交时不会被误拒
            if datetime.now() > deadline + timedelta(seconds=30):
                # 已超时；标记为提交并按当前作答自动判分（不抛错，避免学员答案丢失）
                pass
        submission.status = "submitted"
        submission.submitted_at = datetime.now()
        # 清掉之前可能残留的 PaperAnswer（保险，理论上 in_progress 状态没有 answers）
        await db.execute(
            sql_delete(PaperAnswer).where(PaperAnswer.submission_id == submission.id)
        )

    pq_rows = (
        await db.execute(
            select(PaperQuestion, QuestionBank)
            .join(QuestionBank, QuestionBank.id == PaperQuestion.question_id)
            .where(PaperQuestion.paper_id == assign.paper_id)
        )
    ).all()
    pq_by_id = {pq.id: (pq, qb) for (pq, qb) in pq_rows}

    answer_map = {a.paper_question_id: a.answer for a in payload.answers}
    for pq_id, (pq, qb) in pq_by_id.items():
        user_ans = answer_map.get(pq_id, [])
        score = float(pq.score_override) if pq.score_override is not None else float(qb.default_score or 0)
        is_correct, auto_score = score_question(
            qb.question_type,
            parse_answer(qb.correct_answer_json),
            user_ans,
            score,
        )
        db.add(
            PaperAnswer(
                submission_id=submission.id,
                paper_question_id=pq.id,
                question_id=qb.id,
                question_type=qb.question_type,
                answer_json=json.dumps(user_ans, ensure_ascii=False),
                auto_score=auto_score,
                is_correct=is_correct,
                final_score=auto_score if is_correct is not None else None,
            )
        )

    await db.flush()
    await _recalc_submission(submission, db)
    assign.attempt_count = int(submission.attempt_no or 1)
    await _ensure_assignment_status(assign, db)
    await db.flush()
    await db.refresh(submission)
    return _submission_to_dto(submission)
