"""派发模块的小工具：日期解析、per-assignment 串行锁、ORM→DTO 转换、剩余时间计算。

不包含「评分核心 / 状态推算」（见 :mod:`grading`），也不直接对外暴露 HTTP。
"""
from __future__ import annotations

from datetime import datetime, timedelta

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..id_lock import IdLockRegistry
from ..models import (
    Paper,
    PaperAssignment,
    PaperSubmission,
    User,
)
from .dtos import (
    AssignmentDTO,
    SubmissionDTO,
    UserAssignmentDTO,
)


_assignment_lock_registry = IdLockRegistry(name="paper-assignment")


def _parse_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"日期格式错误：{value}") from exc


def _assignment_lock(assignment_id: int):
    """获取 per-assignment 的串行锁；async with 使用。"""
    return _assignment_lock_registry.acquire(int(assignment_id))


# ---------------- 管理端 ORM → DTO ----------------


def _assignment_to_dto(
    row: PaperAssignment,
    *,
    paper_title: str = "",
    user: User | None = None,
    sub_count: int = 0,
    pending: int = 0,
    last: PaperSubmission | None = None,
) -> AssignmentDTO:
    return AssignmentDTO(
        id=row.id,
        paper_id=row.paper_id,
        paper_title=paper_title,
        user_id=row.user_id,
        user_username=user.username if user else "",
        user_display_name=(user.real_name or user.display_name or user.username) if user else "",
        max_attempts=int(row.max_attempts or 1),
        attempt_count=int(row.attempt_count or 0),
        deadline_at=row.deadline_at.isoformat() if row.deadline_at else None,
        status=row.status or "pending",
        wecom_push_status=row.wecom_push_status or "none",
        wecom_push_error=row.wecom_push_error,
        wecom_pushed_at=row.wecom_pushed_at.isoformat() if row.wecom_pushed_at else None,
        submission_count=int(sub_count),
        pending_review_count=int(pending),
        last_final_score=float(last.final_score) if last and last.final_score is not None else None,
        last_is_pass=bool(last.is_pass) if last and last.is_pass is not None else None,
        created_at=row.created_at.isoformat() if row.created_at else "",
    )


async def _build_assignment_dtos(rows: list[PaperAssignment], db: AsyncSession) -> list[AssignmentDTO]:
    if not rows:
        return []
    assignment_ids = [row.id for row in rows]
    paper_ids = sorted({row.paper_id for row in rows})
    user_ids = sorted({row.user_id for row in rows})

    paper_map: dict[int, str] = {}
    if paper_ids:
        paper_rows = await db.execute(select(Paper.id, Paper.title).where(Paper.id.in_(paper_ids)))
        paper_map = {int(paper_id): title or "" for paper_id, title in paper_rows.all()}

    user_map: dict[int, User] = {}
    if user_ids:
        users = await db.execute(select(User).where(User.id.in_(user_ids)))
        user_map = {int(user.id): user for user in users.scalars().all()}

    count_rows = await db.execute(
        select(PaperSubmission.assignment_id, func.count(PaperSubmission.id))
        .where(PaperSubmission.assignment_id.in_(assignment_ids))
        .group_by(PaperSubmission.assignment_id)
    )
    sub_count_map = {int(assignment_id): int(count) for assignment_id, count in count_rows.all()}

    pending_rows = await db.execute(
        select(PaperSubmission.assignment_id, func.count(PaperSubmission.id))
        .where(
            PaperSubmission.assignment_id.in_(assignment_ids),
            PaperSubmission.status == "submitted",
        )
        .group_by(PaperSubmission.assignment_id)
    )
    pending_map = {int(assignment_id): int(count) for assignment_id, count in pending_rows.all()}

    latest_subq = (
        select(
            PaperSubmission.id.label("id"),
            func.row_number()
            .over(
                partition_by=PaperSubmission.assignment_id,
                order_by=(PaperSubmission.attempt_no.desc(), PaperSubmission.id.desc()),
            )
            .label("rn"),
        )
        .where(PaperSubmission.assignment_id.in_(assignment_ids))
        .subquery()
    )
    last_rows = await db.execute(
        select(PaperSubmission)
        .join(latest_subq, PaperSubmission.id == latest_subq.c.id)
        .where(latest_subq.c.rn == 1)
    )
    last_map: dict[int, PaperSubmission] = {}
    for submission in last_rows.scalars().all():
        last_map.setdefault(int(submission.assignment_id), submission)

    return [
        _assignment_to_dto(
            row,
            paper_title=paper_map.get(int(row.paper_id), ""),
            user=user_map.get(int(row.user_id)),
            sub_count=sub_count_map.get(int(row.id), 0),
            pending=pending_map.get(int(row.id), 0),
            last=last_map.get(int(row.id)),
        )
        for row in rows
    ]


async def _build_assignment_dto(row: PaperAssignment, db: AsyncSession) -> AssignmentDTO:
    return (await _build_assignment_dtos([row], db))[0]


def _submission_to_dto(s: PaperSubmission) -> SubmissionDTO:
    return SubmissionDTO(
        id=s.id,
        assignment_id=s.assignment_id,
        paper_id=s.paper_id,
        user_id=s.user_id,
        attempt_no=int(s.attempt_no or 1),
        status=s.status or "in_progress",
        auto_score=float(s.auto_score) if s.auto_score is not None else None,
        manual_score=float(s.manual_score) if s.manual_score is not None else None,
        final_score=float(s.final_score) if s.final_score is not None else None,
        is_pass=bool(s.is_pass) if s.is_pass is not None else None,
        started_at=s.started_at.isoformat() if s.started_at else None,
        submitted_at=s.submitted_at.isoformat() if s.submitted_at else None,
        graded_at=s.graded_at.isoformat() if s.graded_at else None,
        graded_by=s.graded_by,
        comment=s.comment or "",
    )


# ---------------- 用户端 ----------------


def _is_assignment_expired(assignment: PaperAssignment) -> bool:
    return bool(assignment.deadline_at and assignment.deadline_at < datetime.now())


def _should_show_answer(paper: Paper | None, submission: PaperSubmission | None) -> bool:
    if not paper or not submission:
        return False
    policy = (paper.show_answer_after or "after_submit").strip()
    if policy == "never":
        return False
    if policy == "after_graded":
        return submission.status == "graded"
    # 默认 after_submit：提交后即可看
    return submission.status in {"submitted", "graded"}


def _user_assignment_to_dto(
    assignment: PaperAssignment,
    *,
    paper: Paper | None = None,
    last: PaperSubmission | None = None,
) -> UserAssignmentDTO:
    return UserAssignmentDTO(
        id=assignment.id,
        paper_id=assignment.paper_id,
        paper_title=paper.title if paper else "",
        paper_description=(paper.description or "") if paper else "",
        total_score=float(paper.total_score or 0) if paper else 0,
        pass_score=float(paper.pass_score or 0) if paper else 0,
        duration_minutes=int(paper.duration_minutes or 0) if paper else 0,
        question_count=int(paper.question_count or 0) if paper else 0,
        manual_review_subjective=bool(paper.manual_review_subjective) if paper else False,
        max_attempts=int(assignment.max_attempts or 1),
        attempt_count=int(assignment.attempt_count or 0),
        deadline_at=assignment.deadline_at.isoformat() if assignment.deadline_at else None,
        status=assignment.status or "pending",
        last_submission_id=last.id if last else None,
        last_status=last.status if last else None,
        last_final_score=float(last.final_score) if last and last.final_score is not None else None,
        last_is_pass=bool(last.is_pass) if last and last.is_pass is not None else None,
        last_submitted_at=last.submitted_at.isoformat() if last and last.submitted_at else None,
        is_expired=_is_assignment_expired(assignment),
    )


async def _user_assignment_dtos(
    assignments: list[PaperAssignment],
    db: AsyncSession,
) -> list[UserAssignmentDTO]:
    if not assignments:
        return []
    assignment_ids = [item.id for item in assignments]
    paper_ids = sorted({item.paper_id for item in assignments})

    paper_map: dict[int, Paper] = {}
    if paper_ids:
        papers = await db.execute(select(Paper).where(Paper.id.in_(paper_ids)))
        paper_map = {int(paper.id): paper for paper in papers.scalars().all()}

    latest_subq = (
        select(
            PaperSubmission.id.label("id"),
            func.row_number()
            .over(
                partition_by=PaperSubmission.assignment_id,
                order_by=(PaperSubmission.attempt_no.desc(), PaperSubmission.id.desc()),
            )
            .label("rn"),
        )
        .where(
            PaperSubmission.assignment_id.in_(assignment_ids),
            PaperSubmission.status != "in_progress",
        )
        .subquery()
    )
    last_rows = await db.execute(
        select(PaperSubmission)
        .join(latest_subq, PaperSubmission.id == latest_subq.c.id)
        .where(latest_subq.c.rn == 1)
    )
    last_map: dict[int, PaperSubmission] = {}
    for submission in last_rows.scalars().all():
        last_map.setdefault(int(submission.assignment_id), submission)

    return [
        _user_assignment_to_dto(
            assignment,
            paper=paper_map.get(int(assignment.paper_id)),
            last=last_map.get(int(assignment.id)),
        )
        for assignment in assignments
    ]


async def _user_assignment_dto(
    assignment: PaperAssignment, db: AsyncSession
) -> UserAssignmentDTO:
    return (await _user_assignment_dtos([assignment], db))[0]


def _compute_remain(
    in_progress: PaperSubmission | None,
    duration_min: int,
) -> tuple[str | None, int | None, bool, str]:
    """根据 in_progress 提交计算 started_at / remain_sec / 是否仍可作答。"""
    if in_progress is None:
        return None, None, True, ""
    started_at_iso = in_progress.started_at.isoformat() if in_progress.started_at else None
    if duration_min <= 0 or not in_progress.started_at:
        return started_at_iso, None, True, ""
    deadline = in_progress.started_at + timedelta(minutes=duration_min)
    remain_sec = max(0, int((deadline - datetime.now()).total_seconds()))
    if remain_sec <= 0:
        return started_at_iso, remain_sec, False, "本次答题时间已用尽，请直接提交或开始新的一次。"
    return started_at_iso, remain_sec, True, ""


__all__ = [
    "_parse_datetime",
    "_assignment_lock",
    "_assignment_to_dto",
    "_build_assignment_dtos",
    "_build_assignment_dto",
    "_submission_to_dto",
    "_is_assignment_expired",
    "_should_show_answer",
    "_user_assignment_to_dto",
    "_user_assignment_dtos",
    "_user_assignment_dto",
    "_compute_remain",
]
