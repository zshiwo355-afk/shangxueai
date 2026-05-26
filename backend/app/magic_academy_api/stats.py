from __future__ import annotations

from typing import Any

from fastapi import Depends
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..access import is_super_admin
from ..auth import require_admin
from ..db import get_db
from ..models import (
    MagicQuestion,
    MagicQuizAnswer,
    MagicVideo,
    MagicVideoProgress,
    MagicVideoQuizPoint,
    MagicVideoWhitelist,
    User,
    UserWhitelist,
)
from . import router
from ._utils import (
    SOURCE_MANUAL,
    SOURCE_WHITELIST_EXEMPT,
    _build_export_filename,
    _iso,
    _json_loads,
    _now,
    _parse_answer,
    _user_department,
    _user_name,
    _xlsx_response,
)
from ._video_helpers import (
    _collect_target_users,
    _filter_stats_users,
    _get_video_or_404,
    _get_video_targets,
)


@router.get("/videos/{video_id}/stats")
async def get_video_stats(
    video_id: int,
    department: str | None = None,
    user_id: int | None = None,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> list[dict[str, Any]]:
    reveal_whitelist = is_super_admin(admin)
    video = await _get_video_or_404(db, video_id)
    targets_map = await _get_video_targets(db, [video_id])
    targets = targets_map.get(video_id, [])
    users = _filter_stats_users(await _collect_target_users(db, video, targets), department, user_id)
    if not users:
        return []
    user_ids = [item.id for item in users]
    progress_result = await db.execute(
        select(MagicVideoProgress).where(
            MagicVideoProgress.video_id == video_id,
            MagicVideoProgress.user_id.in_(user_ids),
        )
    )
    progress_map = {item.user_id: item for item in progress_result.scalars().all()}
    inferred_duration_result = await db.execute(
        select(
            func.max(
                func.greatest(
                    func.coalesce(MagicVideoProgress.total_duration, 0),
                    func.coalesce(MagicVideoProgress.max_watched_position, 0),
                    func.coalesce(MagicVideoProgress.current_position, 0),
                )
            )
        ).where(MagicVideoProgress.video_id == video_id)
    )
    inferred_video_duration = float(inferred_duration_result.scalar() or 0)
    whitelist_result = await db.execute(
        select(MagicVideoWhitelist).where(
            MagicVideoWhitelist.video_id == video_id,
            MagicVideoWhitelist.user_id.in_(user_ids),
        )
    )
    whitelist_user_ids = {item.user_id for item in whitelist_result.scalars().all()}
    user_whitelist_result = await db.execute(
        select(UserWhitelist).where(UserWhitelist.user_id.in_(user_ids), UserWhitelist.enabled.is_(True))
    )
    user_whitelist_map = {item.user_id: item for item in user_whitelist_result.scalars().all()}
    rows = []
    for item in users:
        progress = progress_map.get(item.id)
        whitelist_entry = user_whitelist_map.get(item.id)
        course_exempt_enabled = bool(whitelist_entry and whitelist_entry.course_exempt_enabled)
        video_total_duration = float(
            video.duration_seconds
            or video.duration
            or inferred_video_duration
            or (progress.total_duration if progress else 0)
            or 0
        )
        watched = (
            video_total_duration
            if course_exempt_enabled
            else min(float(progress.max_watched_position or 0), video_total_duration) if progress else 0
        )
        rows.append({
            "user_id": item.id,
            "name": _user_name(item),
            "department": _user_department(item),
            "position": item.position or "",
            "video_name": video.title,
            "video_duration_seconds": int(video_total_duration),
            "watched_seconds": round(watched, 2),
            "progress_percent": 100.0 if course_exempt_enabled else float(progress.progress_percent or 0) if progress else 0,
            "is_completed": True if course_exempt_enabled else bool(progress.is_completed) if progress else False,
            "completed_at": _iso(progress.completed_at) if progress else (_iso(_now()) if course_exempt_enabled else None),
            "quiz_passed": True if course_exempt_enabled else bool(progress.quiz_passed) if progress else False,
            "answer_attempt_count": int(progress.answer_attempt_count or 0) if progress else 0,
            "last_watched_at": _iso(progress.last_watched_at) if progress else None,
            "is_whitelist_user": (item.id in whitelist_user_ids) if reveal_whitelist else False,
            "completed_by_whitelist": course_exempt_enabled if reveal_whitelist else False,
            "progress_source": (
                SOURCE_WHITELIST_EXEMPT if course_exempt_enabled and reveal_whitelist
                else (progress.progress_source if progress else SOURCE_MANUAL)
            ),
        })
    return rows


@router.get("/videos/{video_id}/answers")
async def get_video_answer_details(
    video_id: int,
    department: str | None = None,
    user_id: int | None = None,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> list[dict[str, Any]]:
    del admin
    video = await _get_video_or_404(db, video_id)
    targets_map = await _get_video_targets(db, [video_id])
    targets = targets_map.get(video_id, [])
    users = _filter_stats_users(await _collect_target_users(db, video, targets), department, user_id)
    if not users:
        return []
    user_ids = [item.id for item in users]
    answer_result = await db.execute(
        select(MagicQuizAnswer, User, MagicVideoQuizPoint, MagicQuestion, MagicVideo)
        .join(User, User.id == MagicQuizAnswer.user_id)
        .join(MagicVideoQuizPoint, MagicVideoQuizPoint.id == MagicQuizAnswer.quiz_point_id)
        .join(MagicQuestion, MagicQuestion.id == MagicQuizAnswer.question_id)
        .join(MagicVideo, MagicVideo.id == MagicQuizAnswer.video_id)
        .where(MagicQuizAnswer.video_id == video_id, MagicQuizAnswer.user_id.in_(user_ids))
        .order_by(MagicQuizAnswer.submitted_at.desc())
    )
    rows = []
    for answer, user, point, question, video in answer_result.all():
        rows.append({
            "name": _user_name(user),
            "department": _user_department(user),
            "video_name": video.title,
            "quiz_point": point.trigger_second,
            "question": question.stem,
            "user_answer": _json_loads(answer.answer_json, []),
            "correct_answer": _parse_answer(_json_loads(answer.correct_answer_json, answer.correct_answer_json)),
            "is_correct": bool(answer.is_correct),
            "score": float(answer.score or 0),
            "submitted_at": _iso(answer.submitted_at),
            "attempt_no": answer.attempt_no,
            "answer_source": answer.answer_source or SOURCE_MANUAL,
            "auto_correct_by_whitelist": bool(answer.auto_correct_by_whitelist),
        })
    return rows


@router.get("/videos/{video_id}/export-progress")
async def export_video_progress(
    video_id: int,
    department: str | None = None,
    user_id: int | None = None,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> StreamingResponse:
    rows = await get_video_stats(video_id, department, user_id, db, admin)
    video = await _get_video_or_404(db, video_id)
    reveal_whitelist = is_super_admin(admin)
    user_name = None
    if user_id:
        target = await db.get(User, user_id)
        user_name = _user_name(target) if target and target.role == "user" else None
    export_rows = []
    for item in rows:
        row = [
            item["name"],
            item["department"],
            item["video_name"],
            item["video_duration_seconds"],
            item["watched_seconds"],
            item["progress_percent"],
            "是" if item["is_completed"] else "否",
            item["completed_at"] or "",
            "是" if item["quiz_passed"] else "否",
            item["answer_attempt_count"],
            item["last_watched_at"] or "",
        ]
        if reveal_whitelist:
            row.append("是" if item["is_whitelist_user"] else "否")
        export_rows.append(row)
    headers = ["姓名", "部门", "视频名称", "视频总时长", "已观看时长", "观看进度百分比", "是否完成", "完成时间", "答题是否通过", "答题次数", "最后观看时间"]
    if reveal_whitelist:
        headers.append("是否白名单")
    return _xlsx_response(
        _build_export_filename("视频学习统计", video.title, department, user_name),
        headers,
        export_rows,
    )


@router.get("/videos/{video_id}/export-answers")
async def export_video_answers(
    video_id: int,
    department: str | None = None,
    user_id: int | None = None,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> StreamingResponse:
    rows = await get_video_answer_details(video_id, department, user_id, db, admin)
    video = await _get_video_or_404(db, video_id)
    user_name = None
    if user_id:
        target = await db.get(User, user_id)
        user_name = _user_name(target) if target and target.role == "user" else None
    export_rows = [
        [
            item["name"],
            item["department"],
            item["video_name"],
            item["quiz_point"],
            item["question"],
            " / ".join(item["user_answer"]),
            " / ".join(item["correct_answer"]),
            "是" if item["is_correct"] else "否",
            item["score"],
            item["submitted_at"] or "",
            item["attempt_no"],
        ]
        for item in rows
    ]
    return _xlsx_response(
        _build_export_filename("答题详情", video.title, department, user_name),
        ["姓名", "部门", "视频名称", "答题节点", "题目", "用户答案", "正确答案", "是否正确", "得分", "提交时间", "第几次提交"],
        export_rows,
    )
