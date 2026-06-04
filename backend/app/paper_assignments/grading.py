"""试卷判分核心：

- ``_recalc_submission`` —— 根据 ``paper_answers`` 重算 auto/manual/final/is_pass 与 ``submission.status``
- ``_ensure_assignment_status`` —— 把 ``paper_assignments.status`` 推算成 pending / in_progress / pending_review / graded
- ``_build_ai_grading_job`` / ``_run_ai_grading_jobs`` / ``_retry_pending_ai_grading``
  —— 主观题 AI 判分共享逻辑（提交链路 + 兜底重试）

``paper_ai_worker.py`` 仍以 ``from .paper_assignments_api import _ensure_assignment_status,
_recalc_submission`` 方式 import 这两个函数；包 ``__init__`` 会重导出。
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import (
    Paper,
    PaperAnswer,
    PaperAssignment,
    PaperQuestion,
    PaperSubmission,
    QuestionBank,
)
from ..points_service import grant_points
from ..paper_grading import (
    grade_short_answer_with_ai,
    is_objective,
    is_subjective,
    parse_answer,
    parse_keywords,
)


paper_grading_logger = logging.getLogger("app.paper_grading")


def _build_ai_grading_job(
    row: PaperAnswer,
    qb: QuestionBank,
    *,
    user_answer: list[str],
    full_score: float,
) -> tuple[PaperAnswer, dict[str, Any]]:
    return (
        row,
        {
            "stem": qb.stem or "",
            "reference_answer": parse_answer(qb.correct_answer_json),
            "keywords": parse_keywords(getattr(qb, "grading_keywords", None)),
            "user_answer": parse_answer(user_answer),
            "full_score": full_score,
        },
    )


async def _run_ai_grading_jobs(
    jobs: list[tuple[PaperAnswer, dict[str, Any]]],
) -> bool:
    if not jobs:
        return False

    changed = False

    async def _grade_one(row: PaperAnswer, kwargs: dict[str, Any]) -> None:
        nonlocal changed
        try:
            ai_score, ai_comment = await grade_short_answer_with_ai(**kwargs)
            row.ai_score = float(ai_score)
            row.ai_comment = ai_comment or "AI 评分已完成。"
            changed = True
        except Exception:  # noqa: BLE001
            row.ai_score = None
            row.ai_comment = "AI 评分暂未完成，系统会在结果页自动重试。"
            paper_grading_logger.exception(
                "AI grading failed for answer paper_question_id=%s",
                row.paper_question_id,
            )

    await asyncio.gather(*[_grade_one(row, kwargs) for row, kwargs in jobs])
    return changed


async def _retry_pending_ai_grading(
    submission: PaperSubmission,
    paper: Paper | None,
    db: AsyncSession,
) -> bool:
    if not paper or submission.status != "submitted" or bool(paper.manual_review_subjective):
        return False

    pending_rows = (
        await db.execute(
            select(PaperAnswer, PaperQuestion, QuestionBank)
            .join(PaperQuestion, PaperQuestion.id == PaperAnswer.paper_question_id)
            .join(QuestionBank, QuestionBank.id == PaperAnswer.question_id)
            .where(PaperAnswer.submission_id == submission.id)
            .order_by(PaperQuestion.sort_order, PaperQuestion.id)
        )
    ).all()

    jobs: list[tuple[PaperAnswer, dict[str, Any]]] = []
    for answer, pq, qb in pending_rows:
        if not is_subjective(answer.question_type):
            continue
        if answer.manual_score is not None or answer.ai_score is not None:
            continue
        if not bool(getattr(qb, "ai_grading_enabled", True)):
            continue
        score = float(pq.score_override) if pq.score_override is not None else float(qb.default_score or 0)
        jobs.append(
            _build_ai_grading_job(
                answer,
                qb,
                user_answer=parse_answer(answer.answer_json),
                full_score=score,
            )
        )

    if not jobs:
        return False

    changed = await _run_ai_grading_jobs(jobs)
    await db.flush()
    await _recalc_submission(submission, db)

    assignment = (
        await db.execute(select(PaperAssignment).where(PaperAssignment.id == submission.assignment_id))
    ).scalar_one_or_none()
    if assignment:
        await _ensure_assignment_status(assignment, db)

    await db.flush()
    return changed


async def _recalc_submission(submission: PaperSubmission, db: AsyncSession) -> None:
    """根据 paper_answers 重算 auto/manual/final/is_pass 并更新状态。

    主观题取分优先级：manual_score > ai_score > 挂起。
    任一题挂起 → status=submitted，否则 graded（AI 分默认即终评）。
    """
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
    force_manual_review = bool(paper.manual_review_subjective) if paper else False

    for a in answers:
        if is_objective(a.question_type):
            auto_total += float(a.auto_score or 0)
            a.final_score = float(a.auto_score or 0)
        elif is_subjective(a.question_type):
            if force_manual_review and a.manual_score is None:
                a.final_score = None
                has_pending_subjective = True
            elif a.manual_score is not None:
                # 人工分覆盖一切
                manual_total += float(a.manual_score or 0)
                a.final_score = float(a.manual_score or 0)
            elif a.ai_score is not None:
                # AI 分作为默认终评，计入 manual_total（汇总展示用）
                manual_total += float(a.ai_score or 0)
                a.final_score = float(a.ai_score or 0)
            else:
                # 无任何评分 → 挂起，必须人工复核
                has_pending_subjective = True
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
        # 试卷判定通过 → 入账（dedupe_extra=paper_id 保证每用户每试卷只首次给）
        if submission.is_pass:
            try:
                await grant_points(
                    db,
                    user_id=int(submission.user_id),
                    rule_code="paper_pass",
                    business_type="paper_submission",
                    business_id=int(submission.id),
                    dedupe_extra=f"p{int(submission.paper_id)}",
                    remark=f"试卷#{submission.paper_id} 通过",
                )
            except Exception:  # noqa: BLE001
                paper_grading_logger.exception("grant_points failed for paper submission=%s", submission.id)


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


__all__ = [
    "paper_grading_logger",
    "_build_ai_grading_job",
    "_run_ai_grading_jobs",
    "_retry_pending_ai_grading",
    "_recalc_submission",
    "_ensure_assignment_status",
]
