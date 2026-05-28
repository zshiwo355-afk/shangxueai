from __future__ import annotations

import asyncio
from datetime import datetime
from typing import Any

from fastapi import Depends, HTTPException
from fastapi.responses import FileResponse, RedirectResponse
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..access import get_user_whitelist_permissions
from ..auth import get_current_user
from ..db import get_db
from ..magic_academy_schemas import (
    ProgressPayload,
    QuizSubmitPayload,
    WatchConfirmLogPayload,
)
from ..models import (
    MagicQuizAnswer,
    MagicQuizPointPassRecord,
    MagicVideo,
    MagicVideoProgress,
    MagicVideoQuizPoint,
    MagicVideoWatchConfirmLog,
    User,
)
from . import router
from ._oss import _build_signed_stream_url
from ._utils import (
    SOURCE_MANUAL,
    SOURCE_WHITELIST_AUTO_CORRECT,
    SOURCE_WHITELIST_EXEMPT,
    UPLOAD_ROOT,
    _iso,
    _json_dumps,
    _json_loads,
    _now,
    _question_correct_answers,
    _question_options,
    _score_answer,
)
from ._video_helpers import (
    _apply_whitelist_quiz_points,
    _can_seek_freely,
    _ensure_progress_quiz_version,
    _ensure_video_access,
    _get_progress,
    _get_questions_map,
    _get_quiz_points_map,
    _get_series_context_map,
    _get_video_or_404,
    _get_video_targets,
    _get_watch_confirm_settings_map,
    _is_whitelisted,
    _video_to_dict,
    _video_visible_to_user,
)

MAX_PROGRESS_SPEED_MULTIPLIER = 2.0
MAX_PROGRESS_SKEW_SECONDS = 10.0


def _clamp_trusted_progress(
    progress: MagicVideoProgress | None,
    *,
    now: datetime,
    duration: float,
    reported_current_position: float,
    reported_max_watched_position: float,
) -> tuple[float, float]:
    previous_current = max(float(progress.current_position or 0), 0) if progress else 0.0
    previous_max = max(float(progress.max_watched_position or 0), 0) if progress else 0.0
    previous_anchor = progress.last_watched_at or progress.updated_at if progress else None
    elapsed_seconds = max((now - previous_anchor).total_seconds(), 0) if previous_anchor else 0
    allowed_growth = elapsed_seconds * MAX_PROGRESS_SPEED_MULTIPLIER + MAX_PROGRESS_SKEW_SECONDS
    trusted_ceiling = min(duration, previous_max + allowed_growth) if duration > 0 else previous_max + allowed_growth
    trusted_current = min(max(reported_current_position, 0), duration or reported_current_position)
    trusted_max = max(previous_max, reported_max_watched_position, trusted_current)
    trusted_max = min(trusted_max, trusted_ceiling)
    trusted_max = max(trusted_max, previous_max)
    trusted_current = min(trusted_current, trusted_max if duration > 0 else trusted_current)
    trusted_current = max(trusted_current, 0.0)
    if trusted_max < previous_current:
        trusted_max = previous_current
    return trusted_current, trusted_max


@router.get("/my/videos")
async def list_my_videos(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[dict[str, Any]]:
    whitelist_permissions = await get_user_whitelist_permissions(db, user.id)
    result = await db.execute(
        select(MagicVideo).where(MagicVideo.deleted_at.is_(None)).order_by(desc(MagicVideo.created_at))
    )
    videos = result.scalars().all()
    video_ids = [item.id for item in videos]
    targets_map = await _get_video_targets(db, [item.id for item in videos])
    progress_result = await db.execute(
        select(MagicVideoProgress).where(MagicVideoProgress.user_id == user.id)
    )
    progress_map = {item.video_id: item for item in progress_result.scalars().all()}
    series_context_map = await _get_series_context_map(
        db,
        video_ids,
        progress_map=progress_map,
        whitelist_permissions=whitelist_permissions,
    )
    watch_confirm_settings = await _get_watch_confirm_settings_map(db, video_ids)
    output = []
    for video in videos:
        targets = targets_map.get(video.id, [])
        whitelisted = await _is_whitelisted(db, video.id, user.id)
        if not _video_visible_to_user(video, user, targets, whitelisted):
            continue
        output.append(
            _video_to_dict(
                video,
                targets,
                progress_map.get(video.id),
                whitelisted,
                whitelist_permissions,
                series_context_map.get(video.id),
                watch_confirm_settings.get(video.id),
            )
        )
    return output


@router.get("/my/videos/{video_id}")
async def get_my_video_detail(
    video_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    whitelist_permissions = await get_user_whitelist_permissions(db, user.id)
    video = await _get_video_or_404(db, video_id)
    targets, whitelisted = await _ensure_video_access(db, video, user)
    progress = await _get_progress(db, user.id, video_id, create=False)
    progress = await _ensure_progress_quiz_version(db, progress, video)
    all_progress_result = await db.execute(
        select(MagicVideoProgress).where(MagicVideoProgress.user_id == user.id)
    )
    all_progress_map = {item.video_id: item for item in all_progress_result.scalars().all()}
    points_map = await _get_quiz_points_map(db, [video_id])
    points = points_map.get(video_id, [])
    questions_map = await _get_questions_map(db, [item.id for item in points])
    series_context_map = await _get_series_context_map(
        db,
        [video_id],
        progress_map=all_progress_map,
        whitelist_permissions=whitelist_permissions,
    )
    watch_confirm_settings = await _get_watch_confirm_settings_map(db, [video_id])
    payload = _video_to_dict(
        video,
        targets,
        progress,
        whitelisted,
        whitelist_permissions,
        series_context_map.get(video_id),
        watch_confirm_settings.get(video_id),
    )
    payload["stream_url"] = f"/api/magic-academy/videos/{video_id}/stream"
    payload["quiz_points"] = [
        {
            "id": point.id,
            "trigger_second": point.trigger_second,
            "question_count": point.question_count,
            "pass_score": point.pass_score,
            "enabled": bool(point.enabled),
            "questions": [
                {
                    "id": q.id,
                    "question_type": q.question_type,
                    "stem": q.stem,
                    "options": _question_options(q),
                    "score": float(q.score or 0),
                    "sort_order": q.sort_order,
                    "is_required": bool(q.is_required),
                }
                for q in questions_map.get(point.id, [])
            ],
        }
        for point in points
    ]
    _apply_whitelist_quiz_points(payload, whitelist_permissions)
    return payload


@router.get("/videos/{video_id}/stream", response_model=None)
async def stream_video(
    video_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> FileResponse | RedirectResponse:
    video = await _get_video_or_404(db, video_id)
    await _ensure_video_access(db, video, user)
    if (video.storage_type or "local") == "oss" and video.oss_object_key:
        signed_url = await asyncio.to_thread(_build_signed_stream_url, video.oss_object_key)
        return RedirectResponse(signed_url, status_code=307)
    path = UPLOAD_ROOT / video.file_path
    if not path.exists():
        raise HTTPException(status_code=404, detail="视频文件不存在。")
    return FileResponse(path, media_type=video.mime_type or "video/mp4", filename=video.file_name)


@router.post("/my/videos/{video_id}/progress")
async def save_my_video_progress(
    video_id: int,
    payload: ProgressPayload,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    whitelist_permissions = await get_user_whitelist_permissions(db, user.id)
    video = await _get_video_or_404(db, video_id)
    targets, whitelisted = await _ensure_video_access(db, video, user)
    progress = await _get_progress(db, user.id, video_id, create=True)
    progress = await _ensure_progress_quiz_version(db, progress, video)
    now = _now()
    all_progress_result = await db.execute(
        select(MagicVideoProgress).where(MagicVideoProgress.user_id == user.id)
    )
    all_progress_map = {item.video_id: item for item in all_progress_result.scalars().all()}
    duration = max(float(payload.duration_seconds or video.duration_seconds or progress.total_duration or 0), 0)
    progress.total_duration = duration
    reported_current_position = min(max(float(payload.current_position or 0), 0), duration or float(payload.current_position or 0))
    reported_max_watched_position = min(max(float(payload.max_watched_position or 0), 0), duration or float(payload.max_watched_position or 0))
    if _can_seek_freely(whitelisted, whitelist_permissions):
        trusted_current = reported_current_position
        trusted_max = max(float(progress.max_watched_position or 0), reported_max_watched_position, trusted_current)
        if duration > 0:
            trusted_max = min(trusted_max, duration)
    else:
        trusted_current, trusted_max = _clamp_trusted_progress(
            progress,
            now=now,
            duration=duration,
            reported_current_position=reported_current_position,
            reported_max_watched_position=reported_max_watched_position,
        )
    progress.current_position = trusted_current
    progress.max_watched_position = trusted_max
    progress.progress_percent = round((trusted_max / duration) * 100, 2) if duration > 0 else 0
    progress.progress_source = progress.progress_source or SOURCE_MANUAL
    if payload.page_visible:
        progress.last_watched_at = now
    answered = set(_json_loads(progress.answered_point_ids_json, []))
    point_result = await db.execute(
        select(MagicVideoQuizPoint.id)
        .where(MagicVideoQuizPoint.video_id == video_id, MagicVideoQuizPoint.enabled.is_(True))
    )
    required_point_ids = {int(item[0]) for item in point_result.all()}
    progress.quiz_passed = answered.issuperset(required_point_ids)
    if whitelist_permissions.get("course_exempt_enabled"):
        progress.quiz_passed = True
    near_end = duration > 0 and trusted_max >= max(duration - 1.5, duration * 0.98)
    if whitelist_permissions.get("course_exempt_enabled"):
        progress.is_completed = True
        progress.completed_by_whitelist = True
        progress.progress_source = SOURCE_WHITELIST_EXEMPT
        if not progress.completed_at:
            progress.completed_at = now
    elif near_end and progress.quiz_passed and video.status == "published":
        progress.is_completed = True
        if not progress.completed_at:
            progress.completed_at = now
    await db.flush()
    series_context_map = await _get_series_context_map(
        db,
        [video_id],
        progress_map=all_progress_map,
        whitelist_permissions=whitelist_permissions,
    )
    watch_confirm_settings = await _get_watch_confirm_settings_map(db, [video_id])
    return _video_to_dict(
        video,
        targets,
        progress,
        whitelisted,
        whitelist_permissions,
        series_context_map.get(video_id),
        watch_confirm_settings.get(video_id),
    )


@router.post("/my/videos/{video_id}/submit-quiz")
async def submit_my_video_quiz(
    video_id: int,
    payload: QuizSubmitPayload,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    whitelist_permissions = await get_user_whitelist_permissions(db, user.id)
    video = await _get_video_or_404(db, video_id)
    _, whitelisted = await _ensure_video_access(db, video, user)
    point = await db.get(MagicVideoQuizPoint, payload.quiz_point_id)
    if not point or point.video_id != video_id:
        raise HTTPException(status_code=404, detail="答题节点不存在。")
    questions_map = await _get_questions_map(db, [point.id])
    questions = questions_map.get(point.id, [])
    progress = await _get_progress(db, user.id, video_id, create=True)
    progress = await _ensure_progress_quiz_version(db, progress, video)
    attempt_result = await db.execute(
        select(func.count(MagicQuizPointPassRecord.id)).where(
            MagicQuizPointPassRecord.user_id == user.id,
            MagicQuizPointPassRecord.video_id == video_id,
            MagicQuizPointPassRecord.quiz_point_id == point.id,
        )
    )
    attempt_no = int(attempt_result.scalar_one() or 0) + 1

    answer_map = {item.question_id: item.answer for item in payload.answers}
    rows = []
    auto_correct = bool(whitelist_permissions.get("auto_answer_correct") or (whitelisted and payload.skip_by_whitelist))
    if auto_correct:
        for question in questions:
            rows.append({
                "question_id": question.id,
                "stem": question.stem,
                "user_answer": [],
                "correct_answer": _question_correct_answers(question),
                "is_correct": True,
                "score": float(question.score or 100),
            })
    else:
        for question in questions:
            is_correct, score, answer, correct = _score_answer(question, answer_map.get(question.id))
            rows.append({
                "question_id": question.id,
                "stem": question.stem,
                "user_answer": answer,
                "correct_answer": correct,
                "is_correct": is_correct,
                "score": float(score),
            })

    total_score = 0.0
    total_possible = 0.0
    for item, question in zip(rows, questions, strict=False):
        score = float(item["score"])
        total_score += score
        total_possible += float(question.score or 100)
        db.add(
            MagicQuizAnswer(
                user_id=user.id,
                video_id=video_id,
                quiz_point_id=point.id,
                question_id=question.id,
                attempt_no=attempt_no,
                answer_json=_json_dumps(item["user_answer"]),
                correct_answer_json=_json_dumps(item["correct_answer"]),
                is_correct=item["is_correct"],
                score=score,
                answer_source=SOURCE_WHITELIST_AUTO_CORRECT if auto_correct else SOURCE_MANUAL,
                auto_correct_by_whitelist=auto_correct,
            )
        )
    final_score = round((total_score / total_possible) * 100, 2) if total_possible > 0 else 100.0
    all_correct = bool(rows) and all(bool(item["is_correct"]) for item in rows)
    passed = auto_correct or all_correct
    db.add(
        MagicQuizPointPassRecord(
            user_id=user.id,
            video_id=video_id,
            quiz_point_id=point.id,
            attempt_no=attempt_no,
            score=final_score,
            passed=passed,
            source=SOURCE_WHITELIST_AUTO_CORRECT if auto_correct else SOURCE_MANUAL,
            passed_at=_now() if passed else None,
        )
    )
    answered = set(_json_loads(progress.answered_point_ids_json, []))
    if passed:
        answered.add(point.id)
    progress.answered_point_ids_json = _json_dumps(sorted(answered))
    progress.answer_attempt_count = int(progress.answer_attempt_count or 0) + 1
    point_result = await db.execute(
        select(MagicVideoQuizPoint.id).where(
            MagicVideoQuizPoint.video_id == video_id,
            MagicVideoQuizPoint.enabled.is_(True),
        )
    )
    required_point_ids = {int(item[0]) for item in point_result.all()}
    progress.quiz_passed = answered.issuperset(required_point_ids) or whitelist_permissions.get("course_exempt_enabled")
    if progress.total_duration > 0 and progress.max_watched_position >= max(progress.total_duration - 1.5, progress.total_duration * 0.98) and progress.quiz_passed:
        progress.is_completed = True
        progress.completed_at = progress.completed_at or _now()
    await db.flush()
    return {
        "quiz_point_id": point.id,
        "attempt_no": attempt_no,
        "score": final_score,
        "passed": passed,
        "required_score": 100,
        "details": rows,
    }


@router.post("/my/videos/{video_id}/watch-confirm")
async def create_watch_confirm_log(
    video_id: int,
    payload: WatchConfirmLogPayload,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    video = await _get_video_or_404(db, video_id)
    await _ensure_video_access(db, video, user)
    row = MagicVideoWatchConfirmLog(
        user_id=user.id,
        video_id=video_id,
        progress_seconds=float(payload.progress_seconds or 0),
        confirm_round=int(payload.confirm_round or 1),
        confirmed_at=_now(),
    )
    db.add(row)
    await db.flush()
    return {
        "id": int(row.id),
        "video_id": int(video_id),
        "progress_seconds": float(row.progress_seconds or 0),
        "confirm_round": int(row.confirm_round or 1),
        "confirmed_at": _iso(row.confirmed_at),
    }
