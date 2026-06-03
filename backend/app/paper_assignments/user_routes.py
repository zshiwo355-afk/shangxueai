"""用户端：我的派发、答题详情、开始/提交/查看结果。"""
from __future__ import annotations

import json
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete as sql_delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import get_current_user
from ..db import get_db
from ..models import (
    Paper,
    PaperAnswer,
    PaperAssignment,
    PaperQuestion,
    PaperSubmission,
    QuestionBank,
    User,
)
from ..notification_service import notify_submission_received, safe_dispatch
from ..paper_grading import (
    is_objective,
    is_subjective,
    parse_answer,
    parse_options,
    question_type_label,
    score_question,
)
from .dtos import (
    SubmissionDTO,
    SubmitPayload,
    UserAnswerDTO,
    UserAssignmentDTO,
    UserAssignmentDetail,
    UserPaperQuestionDTO,
    UserSubmissionResult,
)
from .grading import (
    _ensure_assignment_status,
    _recalc_submission,
)
from .helpers import (
    _assignment_lock,
    _compute_remain,
    _is_assignment_expired,
    _should_show_answer,
    _submission_to_dto,
    _user_assignment_dto,
    _user_assignment_dtos,
)


submit_router = APIRouter(prefix="/api/papers", tags=["paper-submit"])


# ---------------- 通知调度（独立 session 包装） ----------------


async def _notify_submission_received_in_session(session: AsyncSession, submission_id: int) -> None:
    sub = await session.get(PaperSubmission, submission_id)
    if sub is None:
        return
    await notify_submission_received(session, sub)


# ---------------- 用户端帮助函数 ----------------


async def _load_assignment_for_user_readonly(
    *,
    assignment_id: int,
    db: AsyncSession,
    user: User,
) -> tuple[PaperAssignment, Paper, list[UserPaperQuestionDTO], bool, str, int]:
    """纯读：取出考试 / 试卷 / 题目，并校验权限和可考性。

    返回 (assignment, paper, questions_dto, can_start, block_reason, duration_minutes)。
    不写库、不 commit。GET 详情和 POST /start 共用此函数。
    """
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

    return assignment, paper, questions, can_start, block_reason, int(paper.duration_minutes or 0)


async def _get_assignment_for_user_readonly(
    *,
    assignment_id: int,
    db: AsyncSession,
    user: User,
) -> UserAssignmentDetail:
    """GET 详情：纯读。

    - 如果已存在 in_progress 提交：返回 started_at + remain_sec（用于断点续答）
    - 没有 in_progress：started_at/remain_sec 为 None；前端通过 POST /start 来创建
    """
    assignment, paper, questions, can_start, block_reason, duration_min = (
        await _load_assignment_for_user_readonly(
            assignment_id=assignment_id, db=db, user=user
        )
    )

    started_at_iso: str | None = None
    remain_sec: int | None = None
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
        started_at_iso, remain_sec, can_start_after, reason_after = _compute_remain(
            in_progress, duration_min
        )
        if not can_start_after:
            can_start = False
            block_reason = reason_after

    return UserAssignmentDetail(
        assignment=await _user_assignment_dto(assignment, db),
        questions=questions,
        can_start=can_start,
        block_reason=block_reason,
        started_at=started_at_iso,
        remain_sec=remain_sec,
    )


async def _start_assignment_for_user(
    *,
    assignment_id: int,
    db: AsyncSession,
    user: User,
) -> UserAssignmentDetail:
    """POST /start：找/建 in_progress 提交，返回与 GET 同结构的详情。

    需要锁防止用户在多个 tab 同时点开始造成两条 in_progress 行。
    """
    async with _assignment_lock(assignment_id):
        assignment, paper, questions, can_start, block_reason, duration_min = (
            await _load_assignment_for_user_readonly(
                assignment_id=assignment_id, db=db, user=user
            )
        )

        started_at_iso: str | None = None
        remain_sec: int | None = None

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

            started_at_iso, remain_sec, can_start_after, reason_after = _compute_remain(
                in_progress, duration_min
            )
            if not can_start_after:
                can_start = False
                block_reason = reason_after

    return UserAssignmentDetail(
        assignment=await _user_assignment_dto(assignment, db),
        questions=questions,
        can_start=can_start,
        block_reason=block_reason,
        started_at=started_at_iso,
        remain_sec=remain_sec,
    )


async def _submit_paper_for_user_locked(
    *,
    assignment_id: int,
    payload: SubmitPayload,
    db: AsyncSession,
    user: User,
) -> tuple[SubmissionDTO, int, str]:
    res = await db.execute(
        select(PaperAssignment)
        .where(PaperAssignment.id == assignment_id)
        .with_for_update()
    )
    assign = res.scalar_one_or_none()
    if not assign:
        raise HTTPException(status_code=404, detail="考试不存在。")
    if assign.user_id != user.id:
        raise HTTPException(status_code=403, detail="无权提交他人试卷。")
    if _is_assignment_expired(assign):
        raise HTTPException(status_code=400, detail="已超过考试截止时间。")

    latest_submission = (
        await db.execute(
            select(PaperSubmission)
            .where(
                PaperSubmission.assignment_id == assign.id,
                PaperSubmission.user_id == user.id,
                PaperSubmission.status != "in_progress",
            )
            .order_by(PaperSubmission.attempt_no.desc(), PaperSubmission.id.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if assign.attempt_count >= assign.max_attempts:
        if latest_submission is not None:
            return _submission_to_dto(latest_submission), int(latest_submission.id), latest_submission.status
        raise HTTPException(status_code=400, detail="已用尽答题次数。")

    paper_res = await db.execute(select(Paper).where(Paper.id == assign.paper_id))
    paper = paper_res.scalar_one_or_none()
    if not paper:
        raise HTTPException(status_code=404, detail="试卷不存在。")
    if paper.status != "published":
        raise HTTPException(status_code=400, detail="试卷尚未发布。")

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

    if submission is None and latest_submission is not None and int(latest_submission.attempt_no or 0) == int(assign.attempt_count or 0):
        return _submission_to_dto(latest_submission), int(latest_submission.id), latest_submission.status

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
        if int(paper.duration_minutes or 0) > 0 and submission.started_at:
            deadline = submission.started_at + timedelta(minutes=int(paper.duration_minutes))
            if datetime.now() > deadline + timedelta(seconds=30):
                pass
        submission.status = "submitted"
        submission.submitted_at = datetime.now()
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
    has_pending_ai = False
    for pq_id, (pq, qb) in pq_by_id.items():
        user_ans = answer_map.get(pq_id, [])
        score = float(pq.score_override) if pq.score_override is not None else float(qb.default_score or 0)
        is_correct, auto_score = score_question(
            qb.question_type,
            parse_answer(qb.correct_answer_json),
            user_ans,
            score,
        )
        new_row = PaperAnswer(
            submission_id=submission.id,
            paper_question_id=pq.id,
            question_id=qb.id,
            question_type=qb.question_type,
            answer_json=json.dumps(user_ans, ensure_ascii=False),
            auto_score=auto_score,
            is_correct=is_correct,
            final_score=auto_score if is_correct is not None else None,
        )
        db.add(new_row)
        if is_subjective(qb.question_type) and bool(getattr(qb, "ai_grading_enabled", True)):
            has_pending_ai = True

    await db.flush()

    # 主观题 AI 判分挪到后台 worker：避免 LLM 抖动让用户提交接口超时，
    # 也避免同一连接长时间持锁影响其它写入。挂起的 ai_score=None 由
    # _recalc_submission 转化为 status='submitted'（待评分），worker
    # 完成后会再次推算到 'graded'。
    await _recalc_submission(submission, db)
    assign.attempt_count = int(submission.attempt_no or 1)
    await _ensure_assignment_status(assign, db)
    await db.flush()
    await db.refresh(submission)
    response_dto = _submission_to_dto(submission)
    submission_id_for_notify = int(submission.id)
    submission_status_for_notify = submission.status
    await db.commit()
    if has_pending_ai:
        # 入队后台判分；worker 自身会再次重算 submission/assignment 状态
        from ..paper_ai_worker import enqueue as enqueue_ai_grading
        enqueue_ai_grading(submission_id_for_notify)
    return response_dto, submission_id_for_notify, submission_status_for_notify


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
    """学员答题详情：纯读，不写库。
    没有 in_progress 提交时 started_at/remain_sec 为 None；
    要真正开始考试请改调 POST /assignments/{id}/start。
    """
    return await _get_assignment_for_user_readonly(
        assignment_id=assignment_id,
        db=db,
        user=user,
    )


@submit_router.post("/assignments/{assignment_id}/start", response_model=UserAssignmentDetail)
async def start_assignment_for_user(
    assignment_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> UserAssignmentDetail:
    """显式开始考试：创建（或复用）in_progress 提交。"""
    return await _start_assignment_for_user(
        assignment_id=assignment_id,
        db=db,
        user=user,
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
    # GET 不再触发 LLM；如果还有挂起的主观题 AI 评分，把这条 submission
    # 重新入队后台 worker，下次轮询/前端 3 秒后重拉时就能看到更新
    if (
        sub.status == "submitted"
        and paper is not None
        and not bool(paper.manual_review_subjective)
    ):
        from ..paper_ai_worker import enqueue as enqueue_ai_grading
        enqueue_ai_grading(int(sub.id))
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
                ai_score=float(ans.ai_score) if ans.ai_score is not None else None,
                ai_comment=ans.ai_comment or "",
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
        "manual_review_subjective": bool(paper.manual_review_subjective),
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
    async with _assignment_lock(assignment_id):
        response_dto, submission_id_for_notify, _submission_status_for_notify = await _submit_paper_for_user_locked(
            assignment_id=assignment_id,
            payload=payload,
            db=db,
            user=user,
        )
    await safe_dispatch(
        lambda session: _notify_submission_received_in_session(session, submission_id_for_notify),
        event="paper_submission_received",
        business_id=submission_id_for_notify,
    )
    return response_dto


__all__ = ["submit_router"]
