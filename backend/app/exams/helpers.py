"""考试模块共享的辅助函数：随机选项、DTO 转换、加锁、核心 _start/_finish/_review 流程。

这些函数都不直接对外暴露 HTTP；admin_routes / user_routes 调用它们。
"""
from __future__ import annotations

import json
import logging
import random
from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import session_store
from ..chat_pipeline import run_finish_pipeline, run_start_pipeline
from ..config import Settings
from ..id_lock import IdLockRegistry
from ..llm_errors import LLMError
from ..maxkb import MaxKBError
from ..models import ConfigOption, Exam, ExamAttempt, User
from ..notification_service import notify_exam_assigned
from ..rule_loader import RuleLoader
from ..scenarios import random_scenario_seed
from ..schemas import ChatTurn, StateView
from ..state_machine import build_state_view
from .dtos import (
    ExamAttemptDTO,
    ExamDTO,
    ExamFinishResponse,
    ExamReviewRequest,
    ExamStartResponse,
)

logger = logging.getLogger(__name__)
_exam_lock_registry = IdLockRegistry(name="exam-operation")


# ---------- 通知调度（独立 session 包装，避免企微/日志抖动污染主事务） ----------


async def _notify_exam_assigned_in_session(session: AsyncSession, exam_id: int) -> None:
    exam = await session.get(Exam, exam_id)
    if exam is None:
        return
    await notify_exam_assigned(session, exam)


def _exam_lock(exam_id: int):
    """获取 per-exam 串行锁；async with 使用。"""
    return _exam_lock_registry.acquire(int(exam_id))


def _parse_iso_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"日期格式错误：{value}") from exc


def _exam_to_dto(exam: Exam, user: User | None = None) -> ExamDTO:
    return ExamDTO(
        id=exam.id,
        user_id=exam.user_id,
        user_username=user.username if user else None,
        user_display_name=(user.display_name or user.username) if user else None,
        title=exam.title,
        pass_score=exam.pass_score,
        status=exam.status,
        attempt_count=exam.attempt_count,
        max_attempts=exam.max_attempts,
        fixed_training_type=exam.fixed_training_type,
        fixed_difficulty=exam.fixed_difficulty,
        fixed_customer_type=exam.fixed_customer_type,
        ai_weight=float(exam.ai_weight if exam.ai_weight is not None else 0.5),
        deadline_at=exam.deadline_at.isoformat() if exam.deadline_at else None,
        created_by=exam.created_by,
        created_at=exam.created_at.isoformat() if exam.created_at else "",
        updated_at=exam.updated_at.isoformat() if exam.updated_at else "",
        completed_at=exam.completed_at.isoformat() if exam.completed_at else None,
    )


def _attempt_to_dto(att: ExamAttempt) -> ExamAttemptDTO:
    review = None
    if att.review_json:
        try:
            review = json.loads(att.review_json)
        except (TypeError, ValueError):
            review = None
    chat_history: list[dict] = []
    if att.chat_history_json:
        try:
            parsed = json.loads(att.chat_history_json)
            if isinstance(parsed, list):
                chat_history = [item for item in parsed if isinstance(item, dict)]
        except (TypeError, ValueError):
            chat_history = []
    review_pending = att.status == "completed" and att.reviewed_at is None
    return ExamAttemptDTO(
        id=att.id,
        exam_id=att.exam_id,
        attempt_no=att.attempt_no,
        training_type=att.training_type,
        difficulty=att.difficulty,
        customer_type=att.customer_type,
        session_id=att.session_id,
        status=att.status,
        score=att.score,
        is_pass=bool(att.is_pass) if att.is_pass is not None else None,
        result=att.result,
        review_json=review,
        chat_history=chat_history,
        admin_score=att.admin_score,
        admin_comment=att.admin_comment,
        final_score=att.final_score,
        final_is_pass=bool(att.final_is_pass) if att.final_is_pass is not None else None,
        reviewed_at=att.reviewed_at.isoformat() if att.reviewed_at else None,
        review_pending=review_pending,
        started_at=att.started_at.isoformat() if att.started_at else "",
        completed_at=att.completed_at.isoformat() if att.completed_at else None,
    )


async def _random_option(db: AsyncSession, category: str, exclude: list[str] | None = None) -> str:
    stmt = select(ConfigOption.value).where(
        ConfigOption.category == category, ConfigOption.enabled.is_(True)
    )
    result = await db.execute(stmt)
    candidates = [v for (v,) in result.all() if v]
    if exclude:
        excluded = set(v for v in exclude if v)
        filtered = [v for v in candidates if v not in excluded]
        if filtered:
            candidates = filtered
    if not candidates:
        raise HTTPException(status_code=503, detail=f"未配置任何启用的 {category} 选项。")
    pool = [v for v in candidates if v != "随机"] or candidates
    return random.choice(pool)


async def _start_exam_locked(
    *,
    exam_id: int,
    db: AsyncSession,
    user: User,
    settings: Settings,
    rule_loader: RuleLoader,
) -> ExamStartResponse:
    exam = await db.get(Exam, exam_id)
    if not exam or exam.user_id != user.id:
        raise HTTPException(status_code=404, detail="考试不存在或无权访问。")
    if exam.status in ("passed", "failed"):
        raise HTTPException(status_code=400, detail="该考试已结束，无法再次进行。")

    in_progress = await db.execute(
        select(ExamAttempt)
        .where(ExamAttempt.exam_id == exam_id, ExamAttempt.status == "in_progress")
        .order_by(desc(ExamAttempt.attempt_no))
    )
    active = in_progress.scalars().first()
    if active and active.session_id:
        session = await session_store.get_session(db, active.session_id)
        return ExamStartResponse(
            session_id=session.session_id,
            attempt_no=active.attempt_no,
            training_type=active.training_type,
            difficulty=active.difficulty,
            customer_type=active.customer_type,
            visible_brief=session.visible_brief.model_dump(),
            first_customer_message=session.first_customer_message,
            state=StateView(**build_state_view(session, settings)),
        )

    pending = await db.execute(
        select(ExamAttempt)
        .where(
            ExamAttempt.exam_id == exam_id,
            ExamAttempt.status == "completed",
            ExamAttempt.reviewed_at.is_(None),
        )
        .order_by(desc(ExamAttempt.attempt_no))
    )
    if pending.scalars().first() is not None:
        raise HTTPException(status_code=400, detail="上一轮答题正在等待管理员复核。")
    if exam.attempt_count >= exam.max_attempts:
        raise HTTPException(status_code=400, detail="已用完所有考试机会。")

    prev_res = await db.execute(select(ExamAttempt).where(ExamAttempt.exam_id == exam_id))
    prev_atts = prev_res.scalars().all()
    used_types = [a.training_type for a in prev_atts]
    used_customers = [a.customer_type for a in prev_atts]
    training_type = exam.fixed_training_type or await _random_option(
        db, "training_type", exclude=used_types
    )
    customer_type = exam.fixed_customer_type or await _random_option(
        db, "customer_type", exclude=used_customers
    )
    difficulty = exam.fixed_difficulty or "中等"

    try:
        visible_brief, hidden_pack, first_msg = await run_start_pipeline(
            rule_loader,
            settings,
            training_type=training_type,
            difficulty=difficulty,
            customer_type=customer_type,
            variety_hints=random_scenario_seed(),
        )
    except MaxKBError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc
    except LLMError as exc:
        logger.exception("exam/start LLM failed")
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc

    attempt_no = (max([a.attempt_no for a in prev_atts]) if prev_atts else 0) + 1
    attempt = ExamAttempt(
        exam_id=exam.id,
        attempt_no=attempt_no,
        training_type=training_type,
        difficulty=difficulty,
        customer_type=customer_type,
        status="in_progress",
    )
    db.add(attempt)
    await db.flush()
    await db.refresh(attempt)

    session = await session_store.create_session(
        db,
        user_id=user.id,
        mode="exam",
        training_type=training_type,
        difficulty=difficulty,
        customer_type=customer_type,
        exam_attempt_id=attempt.id,
    )
    session.visible_brief = visible_brief
    session.hidden_training_pack = hidden_pack
    session.first_customer_message = first_msg
    session.chat_history.append(
        ChatTurn(round=0, role="customer", content=first_msg, stage="opening")
    )
    await session_store.save_session(db, session)

    attempt.session_id = session.session_id
    if exam.status == "pending":
        exam.status = "in_progress"
    await db.flush()
    response = ExamStartResponse(
        session_id=session.session_id,
        attempt_no=attempt_no,
        training_type=training_type,
        difficulty=difficulty,
        customer_type=customer_type,
        visible_brief=visible_brief.model_dump(),
        first_customer_message=first_msg,
        state=StateView(**build_state_view(session, settings)),
    )
    await db.commit()
    return response


async def _finish_exam_locked(
    *,
    exam_id: int,
    db: AsyncSession,
    user: User,
    settings: Settings,
    rule_loader: RuleLoader,
) -> tuple[ExamFinishResponse, int, int, float]:
    exam = await db.get(Exam, exam_id)
    if not exam or exam.user_id != user.id:
        raise HTTPException(status_code=404, detail="考试不存在或无权访问。")

    in_progress = await db.execute(
        select(ExamAttempt)
        .where(ExamAttempt.exam_id == exam_id, ExamAttempt.status == "in_progress")
        .order_by(desc(ExamAttempt.attempt_no))
    )
    attempt = in_progress.scalars().first()
    if not attempt or not attempt.session_id:
        raise HTTPException(status_code=400, detail="没有进行中的考试。")

    session = await session_store.get_session(db, attempt.session_id)
    try:
        normalized = await run_finish_pipeline(rule_loader, settings, session=session)
    except MaxKBError as exc:
        logger.exception("exam/finish: rule_loader failed")
        raise HTTPException(status_code=exc.status_code, detail=f"加载复盘规则失败：{exc.message}") from exc
    except LLMError as exc:
        logger.exception("exam/finish: call_llm_json failed")
        raise HTTPException(status_code=exc.status_code, detail=f"复盘生成失败：{exc.message}") from exc
    except Exception as exc:
        logger.exception("exam/finish: unexpected")
        raise HTTPException(status_code=500, detail=f"复盘生成异常：{type(exc).__name__}: {exc}") from exc

    score = float(normalized.get("score") or 0)
    attempt.status = "completed"
    attempt.score = score
    attempt.is_pass = score >= exam.pass_score
    attempt.result = str(normalized.get("result") or "")
    attempt.review_json = json.dumps(normalized, ensure_ascii=False)
    attempt.chat_history_json = json.dumps(
        [t.model_dump() for t in session.chat_history], ensure_ascii=False
    )
    attempt.completed_at = datetime.now(tz=timezone.utc)

    exam.attempt_count = attempt.attempt_no
    exam.status = "pending_review"
    await session_store.delete_session(db, attempt.session_id)
    attempt.session_id = None

    await db.flush()
    await db.refresh(attempt)
    await db.refresh(exam)
    response = ExamFinishResponse(
        attempt=_attempt_to_dto(attempt),
        exam_status=exam.status,
        can_retry=False,
        attempts_used=exam.attempt_count,
        max_attempts=exam.max_attempts,
        pending_review=True,
    )
    attempt_id_for_notify = int(attempt.id)
    attempt_no = int(attempt.attempt_no)
    await db.commit()
    return response, attempt_id_for_notify, attempt_no, score


async def _review_exam_attempt_locked(
    *,
    attempt_id: int,
    payload: ExamReviewRequest,
    db: AsyncSession,
    admin: User,
) -> tuple[dict[str, Any], int, tuple[float, float, float, bool, str]]:
    attempt = await db.get(ExamAttempt, attempt_id)
    if not attempt:
        raise HTTPException(status_code=404, detail="该次尝试不存在。")
    if attempt.status != "completed":
        raise HTTPException(status_code=400, detail="只能复核已完成的尝试。")
    if attempt.reviewed_at is not None:
        raise HTTPException(status_code=400, detail="该次尝试已复核，请勿重复提交。")

    exam = await db.get(Exam, attempt.exam_id)
    if not exam:
        raise HTTPException(status_code=404, detail="考试不存在。")

    ai_weight = float(exam.ai_weight if exam.ai_weight is not None else 0.5)
    ai_weight = max(0.0, min(1.0, ai_weight))
    ai_score = float(attempt.score or 0)
    admin_score = float(payload.admin_score)
    final_score = ai_score * ai_weight + admin_score * (1.0 - ai_weight)
    final_is_pass = final_score >= float(exam.pass_score)

    attempt.admin_score = admin_score
    attempt.admin_comment = (payload.admin_comment or "").strip() or None
    attempt.final_score = final_score
    attempt.final_is_pass = final_is_pass
    attempt.reviewed_by = admin.id
    attempt.reviewed_at = datetime.now(tz=timezone.utc)

    if final_is_pass:
        exam.status = "passed"
        exam.completed_at = datetime.now(tz=timezone.utc)
    elif exam.attempt_count >= exam.max_attempts:
        exam.status = "failed"
        exam.completed_at = datetime.now(tz=timezone.utc)
    else:
        exam.status = "pending"

    await db.flush()
    await db.refresh(attempt)
    await db.refresh(exam)
    response_payload = {
        "success": True,
        "attempt": _attempt_to_dto(attempt).model_dump(),
        "exam": _exam_to_dto(exam).model_dump(),
    }
    attempt_id_for_notify = int(attempt.id)
    log_payload = (ai_score, admin_score, final_score, final_is_pass, exam.status)
    await db.commit()
    return response_payload, attempt_id_for_notify, log_payload


__all__ = [
    "logger",
    "_notify_exam_assigned_in_session",
    "_exam_lock",
    "_parse_iso_dt",
    "_exam_to_dto",
    "_attempt_to_dto",
    "_random_option",
    "_start_exam_locked",
    "_finish_exam_locked",
    "_review_exam_attempt_locked",
]
