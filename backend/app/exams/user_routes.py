"""用户端通关接口：start / finish / my / attempts。"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import get_current_user
from ..config import Settings
from ..db import get_db
from ..models import Exam, ExamAttempt, User
from ..rule_loader import RuleLoader
from .dtos import ExamAttemptDTO, ExamFinishResponse, ExamStartResponse
from .helpers import (
    _attempt_to_dto,
    _exam_lock,
    _exam_to_dto,
    _finish_exam_locked,
    _start_exam_locked,
    logger,
)


def build_user_router(*, settings: Settings, rule_loader: RuleLoader) -> APIRouter:
    router = APIRouter(prefix="/api/exams", tags=["exams"])

    @router.get("/my")
    async def my_exams(
        db: AsyncSession = Depends(get_db),
        user: User = Depends(get_current_user),
    ) -> list[dict]:
        result = await db.execute(
            select(Exam).where(Exam.user_id == user.id).order_by(desc(Exam.created_at))
        )
        exams = result.scalars().all()
        exam_ids = [e.id for e in exams]
        attempts_map: dict[int, list[ExamAttemptDTO]] = {exam_id: [] for exam_id in exam_ids}
        if exam_ids:
            attempts_res = await db.execute(
                select(ExamAttempt)
                .where(ExamAttempt.exam_id.in_(exam_ids))
                .order_by(ExamAttempt.exam_id.asc(), ExamAttempt.attempt_no.asc())
            )
            for attempt in attempts_res.scalars().all():
                attempts_map.setdefault(int(attempt.exam_id), []).append(_attempt_to_dto(attempt))
        out: list[dict] = []
        for e in exams:
            atts = attempts_map.get(int(e.id), [])
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
        async with _exam_lock(exam_id):
            return await _start_exam_locked(
                exam_id=exam_id,
                db=db,
                user=user,
                settings=settings,
                rule_loader=rule_loader,
            )

    @router.post("/{exam_id}/finish", response_model=ExamFinishResponse)
    async def finish_exam(
        exam_id: int,
        db: AsyncSession = Depends(get_db),
        user: User = Depends(get_current_user),
    ) -> ExamFinishResponse:
        async with _exam_lock(exam_id):
            response, _attempt_id_for_notify, attempt_no, score = await _finish_exam_locked(
                exam_id=exam_id,
                db=db,
                user=user,
                settings=settings,
                rule_loader=rule_loader,
            )
        logger.info(
            "exam/finish ok user=%s exam_id=%s attempt_no=%s ai_score=%s -> pending_review",
            user.id, exam_id, attempt_no, score,
        )
        return response

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


__all__ = ["build_user_router"]
