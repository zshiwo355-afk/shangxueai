"""试卷 AI 主观题判分后台 worker。

设计目标：把 LLM 调用从用户提交主请求里搬出来，避免 LLM 抖动 / 慢响应
长时间持有 DB 连接和阻塞用户。
- 入队：提交完成时调用 enqueue(submission_id)，把 ID 投到内存队列
- 兜底：worker 也定时扫描 DB 中 status='submitted' 且仍有 ai_score IS NULL
  的主观题，覆盖"入队消息丢失/进程重启"场景
- 隔离：每次判分起独立 session_scope()，单条失败不影响整体
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .db import session_scope
from .models import (
    Paper,
    PaperAnswer,
    PaperAssignment,
    PaperQuestion,
    PaperSubmission,
    QuestionBank,
)
from .paper_grading import (
    grade_short_answer_with_ai,
    is_subjective,
    parse_answer,
    parse_keywords,
)

logger = logging.getLogger("app.paper_ai_worker")

POLL_SECONDS = 30  # 兜底扫描间隔（秒）
SCAN_BATCH = 50    # 每次兜底扫描最多处理多少条 submission

_queue: asyncio.Queue[int] = asyncio.Queue()


def enqueue(submission_id: int) -> None:
    """把一条提交的 ID 丢进队列。失败（队列爆满）会被忽略，
    后续兜底扫描会再扫到。"""
    try:
        _queue.put_nowait(int(submission_id))
    except Exception:  # noqa: BLE001
        logger.exception("enqueue failed for submission_id=%s", submission_id)


async def _grade_submission(submission_id: int) -> bool:
    """在独立事务里跑一条 submission 的 AI 主观题判分。"""
    async with session_scope() as db:
        sub = await db.get(PaperSubmission, submission_id)
        if sub is None or sub.status != "submitted":
            return False
        paper = await db.get(Paper, sub.paper_id)
        if paper is None or bool(paper.manual_review_subjective):
            # 强制人工复核的卷子不走 AI 判分
            return False
        return await _grade_submission_in_session(sub, paper, db)


async def _grade_submission_in_session(
    submission: PaperSubmission,
    paper: Paper,
    db: AsyncSession,
) -> bool:
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
            (
                answer,
                {
                    "stem": qb.stem or "",
                    "reference_answer": parse_answer(qb.correct_answer_json),
                    "keywords": parse_keywords(getattr(qb, "grading_keywords", None)),
                    "user_answer": parse_answer(answer.answer_json),
                    "full_score": score,
                },
            )
        )

    if not jobs:
        # 没有挂起的 AI 题（可能全是客观题），直接走一次重算把状态推到 graded
        from .paper_assignments_api import _ensure_assignment_status, _recalc_submission

        await _recalc_submission(submission, db)
        assignment = await db.get(PaperAssignment, submission.assignment_id)
        if assignment is not None:
            await _ensure_assignment_status(assignment, db)
        await db.flush()
        return False

    # 串行调 LLM：避免一份卷子的多道题对同一上游模型瞬间打满 rate-limit。
    # 单道失败也不影响其它，最终重算会把已成功的算进 final_score。
    for answer, kwargs in jobs:
        try:
            ai_score, ai_comment = await grade_short_answer_with_ai(**kwargs)
            answer.ai_score = float(ai_score)
            answer.ai_comment = ai_comment or "AI 评分已完成。"
        except Exception:  # noqa: BLE001
            answer.ai_score = None
            answer.ai_comment = "AI 评分暂未完成，系统会自动重试。"
            logger.exception(
                "AI grading failed submission_id=%s pq_id=%s",
                submission.id,
                answer.paper_question_id,
            )

    await db.flush()

    from .paper_assignments_api import _ensure_assignment_status, _recalc_submission

    await _recalc_submission(submission, db)
    assignment = await db.get(PaperAssignment, submission.assignment_id)
    if assignment is not None:
        await _ensure_assignment_status(assignment, db)
    await db.flush()
    return True


async def _scan_pending_submissions() -> list[int]:
    """兜底扫描：找 status='submitted' 且还有 ai_score IS NULL 的主观题的提交。"""
    async with session_scope() as db:
        rows = (
            await db.execute(
                select(PaperSubmission.id)
                .join(PaperAnswer, PaperAnswer.submission_id == PaperSubmission.id)
                .join(Paper, Paper.id == PaperSubmission.paper_id)
                .where(
                    PaperSubmission.status == "submitted",
                    Paper.manual_review_subjective.is_(False),
                    PaperAnswer.question_type == "short_answer",
                    PaperAnswer.ai_score.is_(None),
                    PaperAnswer.manual_score.is_(None),
                )
                .group_by(PaperSubmission.id)
                .order_by(PaperSubmission.id.asc())
                .limit(SCAN_BATCH)
            )
        ).all()
        return [int(row[0]) for row in rows]


async def paper_ai_worker(stop_event: asyncio.Event) -> None:
    """后台 worker：消费 _queue，再加定时兜底扫描。"""
    while not stop_event.is_set():
        # 1) 优先消费即时入队的 submission_id
        try:
            submission_id = await asyncio.wait_for(_queue.get(), timeout=POLL_SECONDS)
        except (TimeoutError, asyncio.TimeoutError):
            submission_id = None

        if submission_id is not None:
            try:
                await _grade_submission(submission_id)
            except Exception:  # noqa: BLE001
                logger.exception("paper_ai_worker grade_submission failed id=%s", submission_id)
            continue  # 队列里可能还有，先不扫表

        # 2) 队列空闲 → 兜底扫一批
        try:
            pending_ids = await _scan_pending_submissions()
        except Exception:  # noqa: BLE001
            logger.exception("paper_ai_worker scan failed")
            pending_ids = []

        for sid in pending_ids:
            if stop_event.is_set():
                break
            try:
                await _grade_submission(sid)
            except Exception:  # noqa: BLE001
                logger.exception("paper_ai_worker grade_submission(scan) failed id=%s", sid)
