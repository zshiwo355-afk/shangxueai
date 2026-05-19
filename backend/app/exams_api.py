"""考试模块：管理员派发 + 用户应试 + 管理员复核（V2.2）。

考试 vs 训练的差异：
  - 难度可由管理员固定（默认中等），亦可让 admin 选随机
  - training_type / customer_type / difficulty：管理员可任意指定为固定值（覆盖随机）
  - 最多 2 次尝试；每次场景种子重新随机；未固定的维度仍每次随机
  - 用户提交后状态为 pending_review，由管理员人工复核打分
  - 最终成绩 = AI 评分 * ai_weight + 管理员评分 * (1-ai_weight)，决定通过/未通过
"""
from __future__ import annotations

import json
import logging
import random
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from . import session_store
from .auth import get_current_user, require_admin
from .chat_pipeline import run_finish_pipeline, run_start_pipeline
from .config import Settings
from .db import get_db
from .llm_errors import LLMError
from .maxkb import MaxKBError
from .models import ConfigOption, Exam, ExamAttempt, User
from .rule_loader import RuleLoader
from .scenarios import random_scenario_seed
from .schemas import ChatTurn, StateView
from .state_machine import build_state_view

logger = logging.getLogger(__name__)


# ============== DTO ==============


class ExamCreateRequest(BaseModel):
    user_id: int = Field(..., gt=0)
    title: str = Field(default="陪练考试", max_length=255)
    fixed_training_type: str | None = Field(default=None, max_length=64)
    fixed_difficulty: str | None = Field(default=None, max_length=32)
    fixed_customer_type: str | None = Field(default=None, max_length=64)
    ai_weight: float = Field(default=0.5, ge=0.0, le=1.0)

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


# =====================================================================
# Admin endpoints
# =====================================================================

admin_router = APIRouter(prefix="/api/admin/exams", tags=["admin-exams"])


@admin_router.post("", response_model=ExamDTO)
async def create_exam(
    payload: ExamCreateRequest,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> ExamDTO:
    target = await db.get(User, payload.user_id)
    if not target:
        raise HTTPException(status_code=404, detail="目标用户不存在。")
    exam = Exam(
        user_id=payload.user_id,
        title=(payload.title or "陪练考试").strip() or "陪练考试",
        pass_score=60,
        status="pending",
        attempt_count=0,
        max_attempts=2,
        fixed_training_type=payload.fixed_training_type,
        fixed_difficulty=payload.fixed_difficulty,
        fixed_customer_type=payload.fixed_customer_type,
        ai_weight=float(payload.ai_weight),
        created_by=admin.id,
    )
    db.add(exam)
    await db.flush()
    await db.refresh(exam)
    return _exam_to_dto(exam, target)


@admin_router.get("", response_model=list[ExamDTO])
async def list_exams(
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> list[ExamDTO]:
    del admin
    result = await db.execute(select(Exam).order_by(desc(Exam.created_at)))
    exams = result.scalars().all()
    if not exams:
        return []
    user_ids = {e.user_id for e in exams}
    user_rows = await db.execute(select(User).where(User.id.in_(user_ids)))
    user_map = {u.id: u for u in user_rows.scalars().all()}
    return [_exam_to_dto(e, user_map.get(e.user_id)) for e in exams]


@admin_router.get("/pending-review", response_model=list[dict])
async def list_pending_review(
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> list[dict]:
    """返回所有 status=completed 且 reviewed_at IS NULL 的 attempt（含所属考试和应试者）。"""
    del admin
    rows = await db.execute(
        select(ExamAttempt)
        .where(ExamAttempt.status == "completed", ExamAttempt.reviewed_at.is_(None))
        .order_by(desc(ExamAttempt.completed_at))
    )
    attempts = rows.scalars().all()
    if not attempts:
        return []
    exam_ids = {a.exam_id for a in attempts}
    exams_res = await db.execute(select(Exam).where(Exam.id.in_(exam_ids)))
    exam_map = {e.id: e for e in exams_res.scalars().all()}
    user_ids = {e.user_id for e in exam_map.values()}
    users_res = await db.execute(select(User).where(User.id.in_(user_ids)))
    user_map = {u.id: u for u in users_res.scalars().all()}
    out = []
    for att in attempts:
        exam = exam_map.get(att.exam_id)
        user = user_map.get(exam.user_id) if exam else None
        out.append({
            "attempt": _attempt_to_dto(att).model_dump(),
            "exam": _exam_to_dto(exam, user).model_dump() if exam else None,
        })
    return out


@admin_router.get("/{exam_id}", response_model=dict)
async def get_exam_detail(
    exam_id: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict:
    del admin
    exam = await db.get(Exam, exam_id)
    if not exam:
        raise HTTPException(status_code=404, detail="考试不存在。")
    user = await db.get(User, exam.user_id)
    attempts_res = await db.execute(
        select(ExamAttempt).where(ExamAttempt.exam_id == exam_id).order_by(ExamAttempt.attempt_no.asc())
    )
    attempts = [_attempt_to_dto(a) for a in attempts_res.scalars().all()]
    return {"exam": _exam_to_dto(exam, user).model_dump(), "attempts": [a.model_dump() for a in attempts]}


@admin_router.delete("/{exam_id}")
async def delete_exam(
    exam_id: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict:
    del admin
    exam = await db.get(Exam, exam_id)
    if not exam:
        raise HTTPException(status_code=404, detail="考试不存在。")
    atts = await db.execute(select(ExamAttempt).where(ExamAttempt.exam_id == exam_id))
    for att in atts.scalars().all():
        if att.session_id:
            await session_store.delete_session(db, att.session_id)
        await db.delete(att)
    await db.delete(exam)
    await db.flush()
    return {"success": True}


# 复核单次 attempt
review_router = APIRouter(prefix="/api/admin/exam-attempts", tags=["admin-exam-review"])


@review_router.post("/{attempt_id}/review", response_model=dict)
async def submit_admin_review(
    attempt_id: int,
    payload: ExamReviewRequest,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict:
    attempt = await db.get(ExamAttempt, attempt_id)
    if not attempt:
        raise HTTPException(status_code=404, detail="该次尝试不存在。")
    if attempt.status != "completed":
        raise HTTPException(status_code=400, detail="只能复核已完成的尝试。")
    exam = await db.get(Exam, attempt.exam_id)
    if not exam:
        raise HTTPException(status_code=404, detail="考试不存在。")

    # 计算最终成绩
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

    # 推进 exam.status
    if final_is_pass:
        exam.status = "passed"
        exam.completed_at = datetime.now(tz=timezone.utc)
    elif exam.attempt_count >= exam.max_attempts:
        exam.status = "failed"
        exam.completed_at = datetime.now(tz=timezone.utc)
    else:
        exam.status = "pending"  # 等用户开始下一次

    await db.flush()
    await db.refresh(attempt)
    await db.refresh(exam)
    await db.commit()

    logger.info(
        "exam attempt reviewed: attempt_id=%s ai=%.1f admin=%.1f final=%.1f pass=%s exam_status=%s",
        attempt_id, ai_score, admin_score, final_score, final_is_pass, exam.status,
    )
    return {
        "success": True,
        "attempt": _attempt_to_dto(attempt).model_dump(),
        "exam": _exam_to_dto(exam).model_dump(),
    }


# =====================================================================
# User endpoints
# =====================================================================


def build_user_router(*, settings: Settings, rule_loader: RuleLoader) -> APIRouter:
    router = APIRouter(prefix="/api/exams", tags=["exams"])

    def _state_view(session) -> StateView:
        return StateView(**build_state_view(session, settings))

    @router.get("/my")
    async def my_exams(
        db: AsyncSession = Depends(get_db),
        user: User = Depends(get_current_user),
    ) -> list[dict]:
        result = await db.execute(
            select(Exam).where(Exam.user_id == user.id).order_by(desc(Exam.created_at))
        )
        exams = result.scalars().all()
        out: list[dict] = []
        for e in exams:
            atts_res = await db.execute(
                select(ExamAttempt).where(ExamAttempt.exam_id == e.id).order_by(ExamAttempt.attempt_no.asc())
            )
            atts = [_attempt_to_dto(a) for a in atts_res.scalars().all()]
            out.append({
                "exam": _exam_to_dto(e).model_dump(),
                "attempts": [a.model_dump() for a in atts],
            })
        return out

    @router.post("/{exam_id}/start", response_model=ExamStartResponse)
    async def start_exam(
        exam_id: int,
        db: AsyncSession = Depends(get_db),
        user: User = Depends(get_current_user),
    ) -> ExamStartResponse:
        exam = await db.get(Exam, exam_id)
        if not exam or exam.user_id != user.id:
            raise HTTPException(status_code=404, detail="考试不存在或无权访问。")
        if exam.status in ("passed", "failed"):
            raise HTTPException(status_code=400, detail="该考试已结束，无法再次进行。")

        # 是否有进行中的 attempt？有就续考、不重新生成
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
                state=_state_view(session),
            )

        # 是否有正在等待复核的 attempt？等老师复核完才能继续
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
            raise HTTPException(
                status_code=400,
                detail="上一次答题正在等待管理员复核，复核完成后才能开始下一次。",
            )

        # 检查剩余次数
        if exam.attempt_count >= exam.max_attempts:
            raise HTTPException(status_code=400, detail="已用完所有考试机会。")

        # 收集已用过的 type / customer，给"重新随机"避开
        prev_res = await db.execute(
            select(ExamAttempt).where(ExamAttempt.exam_id == exam_id)
        )
        prev_atts = prev_res.scalars().all()
        used_types = [a.training_type for a in prev_atts]
        used_customers = [a.customer_type for a in prev_atts]

        # 优先用管理员固定的参数；NULL 则按"避开历史"随机抽
        training_type = (
            exam.fixed_training_type
            or await _random_option(db, "training_type", exclude=used_types)
        )
        customer_type = (
            exam.fixed_customer_type
            or await _random_option(db, "customer_type", exclude=used_customers)
        )
        difficulty = exam.fixed_difficulty or "中等"
        scenario_seed = random_scenario_seed()

        try:
            visible_brief, hidden_pack, first_msg = await run_start_pipeline(
                rule_loader,
                settings,
                training_type=training_type,
                difficulty=difficulty,
                customer_type=customer_type,
                variety_hints=scenario_seed,
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

        return ExamStartResponse(
            session_id=session.session_id,
            attempt_no=attempt_no,
            training_type=training_type,
            difficulty=difficulty,
            customer_type=customer_type,
            visible_brief=visible_brief.model_dump(),
            first_customer_message=first_msg,
            state=_state_view(session),
        )

    @router.post("/{exam_id}/finish", response_model=ExamFinishResponse)
    async def finish_exam(
        exam_id: int,
        db: AsyncSession = Depends(get_db),
        user: User = Depends(get_current_user),
    ) -> ExamFinishResponse:
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
        # 注意：is_pass 这里只代表 AI 预判，最终通过与否要等管理员复核
        is_pass_ai = score >= exam.pass_score

        attempt.status = "completed"
        attempt.score = score
        attempt.is_pass = is_pass_ai
        attempt.result = str(normalized.get("result") or "")
        attempt.review_json = json.dumps(normalized, ensure_ascii=False)
        attempt.chat_history_json = json.dumps(
            [t.model_dump() for t in session.chat_history], ensure_ascii=False
        )
        attempt.completed_at = datetime.now(tz=timezone.utc)
        # admin_score / final_score 留 NULL，等管理员复核

        exam.attempt_count = attempt.attempt_no
        # 状态改为 pending_review 等待管理员复核（不在此处决定 pass/fail）
        exam.status = "pending_review"

        await session_store.delete_session(db, attempt.session_id)
        attempt.session_id = None

        await db.flush()
        await db.refresh(attempt)
        await db.refresh(exam)
        await db.commit()

        try:
            resp = ExamFinishResponse(
                attempt=_attempt_to_dto(attempt),
                exam_status=exam.status,
                can_retry=False,  # 复核完成前不知道还能不能重考
                attempts_used=exam.attempt_count,
                max_attempts=exam.max_attempts,
                pending_review=True,
            )
        except Exception as exc:
            logger.exception("exam/finish: response build failed; review=%r", normalized)
            raise HTTPException(
                status_code=500,
                detail=f"考试响应构造失败：{type(exc).__name__}: {exc}",
            ) from exc

        logger.info(
            "exam/finish ok user=%s exam_id=%s attempt_no=%s ai_score=%s -> pending_review",
            user.id, exam.id, attempt.attempt_no, score,
        )
        return resp

    @router.get("/{exam_id}/attempts", response_model=list[ExamAttemptDTO])
    async def my_exam_attempts(
        exam_id: int,
        db: AsyncSession = Depends(get_db),
        user: User = Depends(get_current_user),
    ) -> list[ExamAttemptDTO]:
        exam = await db.get(Exam, exam_id)
        if not exam or exam.user_id != user.id:
            raise HTTPException(status_code=404, detail="考试不存在或无权访问。")
        result = await db.execute(
            select(ExamAttempt).where(ExamAttempt.exam_id == exam_id).order_by(ExamAttempt.attempt_no.asc())
        )
        return [_attempt_to_dto(a) for a in result.scalars().all()]

    return router
