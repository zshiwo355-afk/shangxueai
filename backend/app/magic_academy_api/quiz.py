from __future__ import annotations

from typing import Any

from fastapi import Depends, HTTPException
from sqlalchemy import delete as sql_delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import require_admin
from ..db import get_db
from ..magic_academy_schemas import QuestionPayload, QuizPointPayload
from ..models import (
    MagicQuestion,
    MagicQuizAnswer,
    MagicQuizPointPassRecord,
    MagicVideoQuizPoint,
    User,
)
from . import router
from ._utils import _json_dumps, _question_correct_answers, _question_options
from ._video_helpers import (
    _bump_video_quiz_version,
    _get_questions_map,
    _get_quiz_points_map,
    _get_video_or_404,
)


@router.get("/videos/{video_id}/quiz-points")
async def list_quiz_points(
    video_id: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> list[dict[str, Any]]:
    del admin
    await _get_video_or_404(db, video_id)
    points_map = await _get_quiz_points_map(db, [video_id])
    points = points_map.get(video_id, [])
    questions_map = await _get_questions_map(db, [item.id for item in points])
    return [
        {
            "id": item.id,
            "video_id": item.video_id,
            "trigger_second": item.trigger_second,
            "question_count": item.question_count,
            "pass_score": item.pass_score,
            "enabled": bool(item.enabled),
            "questions": [
                {
                    "id": q.id,
                    "quiz_point_id": q.quiz_point_id,
                    "question_type": q.question_type,
                    "stem": q.stem,
                    "options": _question_options(q),
                    "correct_answers": _question_correct_answers(q),
                    "score": float(q.score or 0),
                    "sort_order": q.sort_order,
                    "is_required": bool(q.is_required),
                }
                for q in questions_map.get(item.id, [])
            ],
        }
        for item in points
    ]


@router.post("/videos/{video_id}/quiz-points")
async def create_quiz_point(
    video_id: int,
    payload: QuizPointPayload,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    del admin
    await _get_video_or_404(db, video_id)
    point = MagicVideoQuizPoint(
        video_id=video_id,
        trigger_second=payload.trigger_second,
        question_count=payload.question_count,
        pass_score=payload.pass_score,
        enabled=payload.enabled,
    )
    db.add(point)
    await db.flush()
    await _bump_video_quiz_version(db, video_id)
    return {
        "id": point.id,
        "video_id": point.video_id,
        "trigger_second": point.trigger_second,
        "question_count": point.question_count,
        "pass_score": point.pass_score,
        "enabled": bool(point.enabled),
    }


@router.put("/quiz-points/{point_id}")
async def update_quiz_point(
    point_id: int,
    payload: QuizPointPayload,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    del admin
    point = await db.get(MagicVideoQuizPoint, point_id)
    if not point:
        raise HTTPException(status_code=404, detail="答题节点不存在。")
    point.trigger_second = payload.trigger_second
    point.question_count = payload.question_count
    point.pass_score = payload.pass_score
    point.enabled = payload.enabled
    await db.flush()
    await _bump_video_quiz_version(db, point.video_id)
    return {
        "id": point.id,
        "video_id": point.video_id,
        "trigger_second": point.trigger_second,
        "question_count": point.question_count,
        "pass_score": point.pass_score,
        "enabled": bool(point.enabled),
    }


@router.delete("/quiz-points/{point_id}")
async def delete_quiz_point(
    point_id: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, bool]:
    del admin
    point = await db.get(MagicVideoQuizPoint, point_id)
    if not point:
        raise HTTPException(status_code=404, detail="答题节点不存在。")
    video_id = point.video_id
    await db.execute(sql_delete(MagicQuestion).where(MagicQuestion.quiz_point_id == point_id))
    await db.execute(sql_delete(MagicQuizAnswer).where(MagicQuizAnswer.quiz_point_id == point_id))
    await db.execute(sql_delete(MagicQuizPointPassRecord).where(MagicQuizPointPassRecord.quiz_point_id == point_id))
    await db.delete(point)
    await db.flush()
    await _bump_video_quiz_version(db, video_id)
    return {"success": True}


@router.get("/quiz-points/{point_id}/questions")
async def list_questions(
    point_id: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> list[dict[str, Any]]:
    del admin
    point = await db.get(MagicVideoQuizPoint, point_id)
    if not point:
        raise HTTPException(status_code=404, detail="答题节点不存在。")
    questions_map = await _get_questions_map(db, [point_id])
    return [
        {
            "id": q.id,
            "quiz_point_id": q.quiz_point_id,
            "question_type": q.question_type,
            "stem": q.stem,
            "options": _question_options(q),
            "correct_answers": _question_correct_answers(q),
            "score": float(q.score or 0),
            "sort_order": q.sort_order,
            "is_required": bool(q.is_required),
        }
        for q in questions_map.get(point_id, [])
    ]


@router.post("/quiz-points/{point_id}/questions")
async def create_question(
    point_id: int,
    payload: QuestionPayload,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    del admin
    point = await db.get(MagicVideoQuizPoint, point_id)
    if not point:
        raise HTTPException(status_code=404, detail="答题节点不存在。")
    count_result = await db.execute(
        select(func.count(MagicQuestion.id)).where(MagicQuestion.quiz_point_id == point_id)
    )
    next_sort_order = int(count_result.scalar_one() or 0)
    question = MagicQuestion(
        quiz_point_id=point_id,
        question_type=payload.question_type,
        stem=payload.stem.strip(),
        options_json=_json_dumps(payload.options),
        correct_answer_json=_json_dumps(payload.correct_answers),
        score=payload.score,
        sort_order=payload.sort_order or next_sort_order,
        is_required=payload.is_required,
    )
    db.add(question)
    await db.flush()
    result = await db.execute(select(func.count(MagicQuestion.id)).where(MagicQuestion.quiz_point_id == point_id))
    point.question_count = int(result.scalar_one() or 0)
    await db.flush()
    await _bump_video_quiz_version(db, point.video_id)
    return {
        "id": question.id,
        "quiz_point_id": question.quiz_point_id,
        "question_type": question.question_type,
        "stem": question.stem,
        "options": payload.options,
        "correct_answers": payload.correct_answers,
        "score": float(question.score or 0),
        "sort_order": question.sort_order,
        "is_required": bool(question.is_required),
    }


@router.put("/questions/{question_id}")
async def update_question(
    question_id: int,
    payload: QuestionPayload,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    del admin
    question = await db.get(MagicQuestion, question_id)
    if not question:
        raise HTTPException(status_code=404, detail="题目不存在。")
    question.question_type = payload.question_type
    question.stem = payload.stem.strip()
    question.options_json = _json_dumps(payload.options)
    question.correct_answer_json = _json_dumps(payload.correct_answers)
    question.score = payload.score
    question.sort_order = payload.sort_order or question.sort_order or 0
    question.is_required = payload.is_required
    await db.flush()
    point = await db.get(MagicVideoQuizPoint, question.quiz_point_id)
    if point:
        await _bump_video_quiz_version(db, point.video_id)
    return {
        "id": question.id,
        "quiz_point_id": question.quiz_point_id,
        "question_type": question.question_type,
        "stem": question.stem,
        "options": payload.options,
        "correct_answers": payload.correct_answers,
        "score": float(question.score or 0),
        "sort_order": question.sort_order,
        "is_required": bool(question.is_required),
    }


@router.delete("/questions/{question_id}")
async def delete_question(
    question_id: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, bool]:
    del admin
    question = await db.get(MagicQuestion, question_id)
    if not question:
        raise HTTPException(status_code=404, detail="题目不存在。")
    point = await db.get(MagicVideoQuizPoint, question.quiz_point_id)
    await db.execute(sql_delete(MagicQuizAnswer).where(MagicQuizAnswer.question_id == question_id))
    await db.delete(question)
    await db.flush()
    if point:
        result = await db.execute(
            select(func.count(MagicQuestion.id)).where(MagicQuestion.quiz_point_id == point.id)
        )
        point.question_count = int(result.scalar_one() or 0)
        await db.flush()
        await _bump_video_quiz_version(db, point.video_id)
    return {"success": True}
