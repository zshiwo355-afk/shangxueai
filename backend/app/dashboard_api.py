"""数据看板：管理员侧聚合查询。

设计要点：
  - 所有查询用 count(*)/group by 聚合，避免拉行；30 天范围只扫索引列。
  - KPI 一次接口返回所有顶部数字，前端不分多次请求。
  - 趋势按天聚合（DATE(created_at)），返回 [{date, count}, ...] 自补零。
  - 部门维度只在用 GROUP BY users.department；空部门记为 "未分配"。
"""
from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy import and_, case, distinct, func, select, union_all
from sqlalchemy.ext.asyncio import AsyncSession

from .auth import require_admin
from .db import get_db
from .models import (
    Exam,
    ExamAttempt,
    MagicAudioUpload,
    MagicReadingContent,
    MagicVideo,
    MagicVideoProgress,
    PaperAssignment,
    PaperSubmission,
    TrainingRecord,
    User,
    UserPointSummary,
)

router = APIRouter(prefix="/api/admin/dashboard", tags=["admin-dashboard"])


def _daterange(start: date, end: date):
    cur = start
    while cur <= end:
        yield cur
        cur = cur + timedelta(days=1)


# -------------------- KPI 概览 --------------------

@router.get("/kpi")
async def kpi(
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    del admin
    today_start = datetime.combine(date.today(), datetime.min.time())
    week_start = today_start - timedelta(days=6)

    # 用户总数 / 在职数：一次 SQL 同时算
    user_row = (await db.execute(
        select(
            func.count(User.id),
            func.sum(case((User.disabled.is_(False), 1), else_=0)),
        )
    )).first()
    total_users = int(user_row[0] or 0)
    active_users = int(user_row[1] or 0)
    left_users = total_users - active_users

    # 今日活跃用户：UNION ALL 五个来源后 COUNT DISTINCT，
    # 在 DB 内完成去重，避免把 user_id 拉到 Python
    today_exam_uid = (
        select(Exam.user_id.label("uid"))
        .join(ExamAttempt, ExamAttempt.exam_id == Exam.id)
        .where(ExamAttempt.started_at >= today_start)
    )
    today_union = union_all(
        select(TrainingRecord.user_id.label("uid")).where(TrainingRecord.created_at >= today_start),
        select(MagicVideoProgress.user_id.label("uid")).where(MagicVideoProgress.last_watched_at >= today_start),
        select(MagicAudioUpload.user_id.label("uid")).where(
            MagicAudioUpload.uploaded_on >= today_start, MagicAudioUpload.is_deleted.is_(False)
        ),
        select(PaperSubmission.user_id.label("uid")).where(PaperSubmission.started_at >= today_start),
        today_exam_uid,
    ).subquery()
    today_active = int((await db.execute(
        select(func.count(distinct(today_union.c.uid)))
    )).scalar() or 0)

    # 本周 AI 对练次数 = 自由训练 + 通关 attempt（已开始）
    week_training_free = int((await db.execute(
        select(func.count(TrainingRecord.id)).where(TrainingRecord.created_at >= week_start)
    )).scalar() or 0)
    week_training_exam = int((await db.execute(
        select(func.count(ExamAttempt.id)).where(ExamAttempt.started_at >= week_start)
    )).scalar() or 0)
    week_training = week_training_free + week_training_exam
    week_audio = int((await db.execute(
        select(func.count(MagicAudioUpload.id)).where(
            MagicAudioUpload.uploaded_on >= week_start,
            MagicAudioUpload.is_deleted.is_(False),
        )
    )).scalar() or 0)

    # 待批阅试卷 + 本周通过率：一次 SQL 拿完
    paper_row = (await db.execute(
        select(
            func.sum(case((PaperSubmission.status == "submitted", 1), else_=0)),
            func.sum(case(
                (and_(
                    PaperSubmission.status == "graded",
                    PaperSubmission.graded_at >= week_start,
                    PaperSubmission.is_pass.is_(True),
                ), 1),
                else_=0,
            )),
            func.sum(case(
                (and_(
                    PaperSubmission.status == "graded",
                    PaperSubmission.graded_at >= week_start,
                ), 1),
                else_=0,
            )),
        )
    )).first()
    pending_papers = int(paper_row[0] or 0)
    week_paper_pass = int(paper_row[1] or 0)
    week_paper_total = int(paper_row[2] or 0)
    paper_pass_rate = (
        round(100 * week_paper_pass / week_paper_total, 1)
        if week_paper_total > 0
        else 0.0
    )

    # 待复核 AI 通关：attempt 已 completed，但还没 reviewed_at
    pending_exams = int((await db.execute(
        select(func.count(ExamAttempt.id)).where(
            ExamAttempt.status == "completed",
            ExamAttempt.reviewed_at.is_(None),
        )
    )).scalar() or 0)

    return {
        "users": {
            "total": total_users,
            "active": active_users,
            "left": left_users,
            "today_active": today_active,
        },
        "training": {
            "week_count": week_training,
        },
        "reading": {
            "week_count": week_audio,
        },
        "papers": {
            "pending_review": pending_papers,
            "week_pass_rate": paper_pass_rate,
        },
        "exams": {
            "pending_review": pending_exams,
        },
    }


# -------------------- 趋势图 --------------------

@router.get("/trend")
async def trend(
    metric: str = Query(..., pattern="^(training|video|reading|paper)$"),
    days: int = Query(default=30, ge=7, le=90),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> list[dict[str, Any]]:
    del admin
    end = date.today()
    start = end - timedelta(days=days - 1)
    start_dt = datetime.combine(start, datetime.min.time())

    if metric == "training":
        # AI 对练 = 自由训练 + 通关 attempt
        train_dates = select(func.date(TrainingRecord.created_at).label("d")).where(
            TrainingRecord.created_at >= start_dt
        )
        exam_dates = select(func.date(ExamAttempt.started_at).label("d")).where(
            ExamAttempt.started_at >= start_dt
        )
        u = union_all(train_dates, exam_dates).subquery()
        stmt = select(u.c.d, func.count()).group_by(u.c.d)
    elif metric == "video":
        date_expr = func.date(MagicVideoProgress.last_watched_at)
        stmt = select(date_expr.label("d"), func.count(MagicVideoProgress.id)).where(
            MagicVideoProgress.last_watched_at >= start_dt
        ).group_by(date_expr)
    elif metric == "reading":
        date_expr = func.date(MagicAudioUpload.uploaded_on)
        stmt = select(date_expr.label("d"), func.count(MagicAudioUpload.id)).where(
            MagicAudioUpload.uploaded_on >= start_dt,
            MagicAudioUpload.is_deleted.is_(False),
        ).group_by(date_expr)
    else:  # paper
        date_expr = func.date(PaperSubmission.submitted_at)
        stmt = select(date_expr.label("d"), func.count(PaperSubmission.id)).where(
            PaperSubmission.submitted_at >= start_dt
        ).group_by(date_expr)

    result = await db.execute(stmt)
    counts: dict[str, int] = {}
    for d, c in result.all():
        # MySQL 返回 date 对象；统一 str 化
        key = d.isoformat() if hasattr(d, "isoformat") else str(d)
        counts[key] = int(c or 0)

    items = []
    for d in _daterange(start, end):
        key = d.isoformat()
        items.append({"date": key, "count": counts.get(key, 0)})
    return items


# -------------------- 部门维度透视 --------------------

@router.get("/department-stats")
async def department_stats(
    days: int = Query(default=30, ge=7, le=90),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> list[dict[str, Any]]:
    """各部门：人数 / 活跃数 / 训练次数 / 平均训练分 / 打卡数 / 累计积分。"""
    del admin
    range_start = datetime.combine(date.today() - timedelta(days=days - 1), datetime.min.time())

    # 部门 → 人数
    head_result = await db.execute(
        select(User.department, func.count(User.id))
        .where(User.disabled.is_(False))
        .group_by(User.department)
    )
    dept_head: dict[str, int] = {}
    for dept, cnt in head_result.all():
        key = dept or "未分配"
        dept_head[key] = int(cnt or 0)

    # 部门 → 活跃数：UNION ALL 四个来源 join users 后 GROUP BY 部门 + COUNT DISTINCT
    active_union = union_all(
        select(TrainingRecord.user_id.label("uid"))
        .where(TrainingRecord.created_at >= range_start),
        select(MagicVideoProgress.user_id.label("uid"))
        .where(MagicVideoProgress.last_watched_at >= range_start),
        select(MagicAudioUpload.user_id.label("uid"))
        .where(MagicAudioUpload.uploaded_on >= range_start, MagicAudioUpload.is_deleted.is_(False)),
        select(Exam.user_id.label("uid"))
        .join(ExamAttempt, ExamAttempt.exam_id == Exam.id)
        .where(ExamAttempt.started_at >= range_start),
    ).subquery()
    active_result = await db.execute(
        select(User.department, func.count(distinct(active_union.c.uid)))
        .join(User, User.id == active_union.c.uid)
        .group_by(User.department)
    )
    dept_active = {(d or "未分配"): int(c or 0) for d, c in active_result.all()}

    # 部门 → 训练次数 + 平均分：自由训练
    training_result = await db.execute(
        select(User.department, func.count(TrainingRecord.id), func.avg(TrainingRecord.score))
        .join(User, User.id == TrainingRecord.user_id)
        .where(TrainingRecord.created_at >= range_start)
        .group_by(User.department)
    )
    dept_training: dict[str, dict[str, Any]] = {}
    for dept, cnt, avg_score in training_result.all():
        key = dept or "未分配"
        dept_training[key] = {
            "count": int(cnt or 0),
            "score_sum": float(avg_score or 0) * int(cnt or 0),
        }

    # 部门 → 通关 attempt 次数 + 平均 AI 分（用 exam→user 关联部门）
    exam_attempt_result = await db.execute(
        select(User.department, func.count(ExamAttempt.id), func.avg(ExamAttempt.score))
        .join(Exam, Exam.id == ExamAttempt.exam_id)
        .join(User, User.id == Exam.user_id)
        .where(ExamAttempt.started_at >= range_start)
        .group_by(User.department)
    )
    for dept, cnt, avg_score in exam_attempt_result.all():
        key = dept or "未分配"
        bucket = dept_training.setdefault(key, {"count": 0, "score_sum": 0.0})
        bucket["count"] += int(cnt or 0)
        bucket["score_sum"] += float(avg_score or 0) * int(cnt or 0)

    # 部门 → 打卡次数
    audio_result = await db.execute(
        select(User.department, func.count(MagicAudioUpload.id))
        .join(User, User.id == MagicAudioUpload.user_id)
        .where(MagicAudioUpload.uploaded_on >= range_start, MagicAudioUpload.is_deleted.is_(False))
        .group_by(User.department)
    )
    dept_audio = {(d or "未分配"): int(c or 0) for d, c in audio_result.all()}

    # 部门 → 累计积分
    points_result = await db.execute(
        select(User.department, func.sum(UserPointSummary.total_points))
        .join(User, User.id == UserPointSummary.user_id)
        .where(User.disabled.is_(False))
        .group_by(User.department)
    )
    dept_points = {(d or "未分配"): int(p or 0) for d, p in points_result.all()}

    items = []
    for dept, head in dept_head.items():
        training = dept_training.get(dept, {"count": 0, "score_sum": 0.0})
        cnt = int(training.get("count") or 0)
        avg = round(training.get("score_sum", 0.0) / cnt, 1) if cnt > 0 else 0.0
        items.append({
            "department": dept,
            "headcount": head,
            "active_count": dept_active.get(dept, 0),
            "training_count": cnt,
            "training_avg_score": avg,
            "reading_count": dept_audio.get(dept, 0),
            "total_points": dept_points.get(dept, 0),
        })
    items.sort(key=lambda x: (-x["headcount"], x["department"]))
    return items


# -------------------- 待办与紧急任务 --------------------

@router.get("/pending-tasks")
async def pending_tasks(
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    """需要管理员处理的事项 + 临近 deadline 的资源（用于催办）。"""
    del admin
    now = datetime.now()
    week_later = now + timedelta(days=7)

    video_due_q = select(func.count(MagicVideo.id)).where(
        MagicVideo.deadline_at.isnot(None),
        MagicVideo.deadline_at >= now,
        MagicVideo.deadline_at <= week_later,
        MagicVideo.deleted_at.is_(None),
    ).scalar_subquery()

    reading_due_q = select(func.count(MagicReadingContent.id)).where(
        MagicReadingContent.makeup_deadline_at.isnot(None),
        MagicReadingContent.makeup_deadline_at >= now,
        MagicReadingContent.makeup_deadline_at <= week_later,
        MagicReadingContent.is_deleted.is_(False),
    ).scalar_subquery()

    paper_due_q = select(func.count(PaperAssignment.id)).where(
        PaperAssignment.deadline_at.isnot(None),
        PaperAssignment.deadline_at >= now,
        PaperAssignment.deadline_at <= week_later,
        PaperAssignment.status.in_(["pending", "in_progress"]),
    ).scalar_subquery()

    paper_overdue_q = select(func.count(PaperAssignment.id)).where(
        PaperAssignment.deadline_at.isnot(None),
        PaperAssignment.deadline_at < now,
        PaperAssignment.status.in_(["pending", "in_progress"]),
    ).scalar_subquery()

    row = (await db.execute(
        select(
            video_due_q.label("video_due"),
            reading_due_q.label("reading_due"),
            paper_due_q.label("paper_due"),
            paper_overdue_q.label("paper_overdue"),
        )
    )).first()

    return {
        "video_due_in_7d": int(row.video_due or 0),
        "reading_due_in_7d": int(row.reading_due or 0),
        "paper_due_in_7d": int(row.paper_due or 0),
        "paper_overdue": int(row.paper_overdue or 0),
    }


# -------------------- 嵌入式排行（用于看板首屏） --------------------

@router.get("/leaderboard-preview")
async def leaderboard_preview(
    limit: int = Query(default=10, ge=3, le=50),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> list[dict[str, Any]]:
    del admin
    stmt = (
        select(
            UserPointSummary.user_id,
            UserPointSummary.total_points,
            UserPointSummary.streak_days,
            User.display_name,
            User.real_name,
            User.username,
            User.department,
        )
        .join(User, User.id == UserPointSummary.user_id)
        .where(User.disabled.is_(False))
        .order_by(UserPointSummary.total_points.desc(), UserPointSummary.user_id.asc())
        .limit(limit)
    )
    result = await db.execute(stmt)
    items = []
    for idx, row in enumerate(result.all(), start=1):
        items.append({
            "rank": idx,
            "user_id": int(row.user_id),
            "name": row.display_name or row.real_name or row.username or f"#{row.user_id}",
            "department": row.department or "",
            "total_points": int(row.total_points or 0),
            "streak_days": int(row.streak_days or 0),
        })
    return items


# -------------------- 积分分类构成 --------------------

@router.get("/points-breakdown")
async def points_breakdown(
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    """全公司积分按分类聚合，前端画环形图。"""
    del admin
    result = await db.execute(
        select(
            func.coalesce(func.sum(UserPointSummary.training_points), 0),
            func.coalesce(func.sum(UserPointSummary.course_points), 0),
            func.coalesce(func.sum(UserPointSummary.reading_points), 0),
            func.coalesce(func.sum(UserPointSummary.paper_points), 0),
            func.coalesce(func.sum(UserPointSummary.exam_points), 0),
            func.coalesce(func.sum(UserPointSummary.manual_points), 0),
            func.coalesce(func.sum(UserPointSummary.total_points), 0),
        )
        .join(User, User.id == UserPointSummary.user_id)
        .where(User.disabled.is_(False))
    )
    row = result.first()
    return {
        "training": int(row[0] or 0),
        "course": int(row[1] or 0),
        "reading": int(row[2] or 0),
        "paper": int(row[3] or 0),
        "exam": int(row[4] or 0),
        "manual": int(row[5] or 0),
        "total": int(row[6] or 0),
    }
