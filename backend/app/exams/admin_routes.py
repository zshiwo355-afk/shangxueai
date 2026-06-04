"""管理端考试 / 通关接口：派发、列表、复核、删除、企微推送。"""
from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import delete as sql_delete, desc, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import session_store
from ..auth import require_admin
from ..db import get_db
from ..models import Exam, ExamAttempt, User
from ..notification_service import safe_dispatch
from .dtos import (
    BulkExamIdsPayload,
    ExamBatchCreateRequest,
    ExamCreateRequest,
    ExamDTO,
    ExamReviewRequest,
)
from .helpers import (
    _attempt_to_dto,
    _exam_lock,
    _exam_to_dto,
    _notify_exam_assigned_in_session,
    _parse_iso_dt,
    _review_exam_attempt_locked,
    logger,
)


admin_router = APIRouter(prefix="/api/admin/exams", tags=["admin-exams"])
review_router = APIRouter(prefix="/api/admin/exam-attempts", tags=["admin-exam-review"])


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
        pass_score=int(payload.pass_score),
        status="pending",
        attempt_count=0,
        max_attempts=int(payload.max_attempts),
        fixed_training_type=payload.fixed_training_type,
        fixed_difficulty=payload.fixed_difficulty,
        fixed_customer_type=payload.fixed_customer_type,
        ai_weight=float(payload.ai_weight),
        deadline_at=_parse_iso_dt(payload.deadline_at),
        created_by=admin.id,
    )
    db.add(exam)
    await db.flush()
    await db.refresh(exam)
    response = _exam_to_dto(exam, target)
    exam_id_for_notify = int(exam.id)
    await db.commit()
    await safe_dispatch(
        lambda session: _notify_exam_assigned_in_session(session, exam_id_for_notify),
        event="exam_assigned",
        business_id=exam_id_for_notify,
    )
    return response


@admin_router.post("/batch", response_model=list[ExamDTO])
async def batch_create_exams(
    payload: ExamBatchCreateRequest,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> list[ExamDTO]:
    """按多用户批量派发通关 —— 支持按部门/岗位/全员维度（前端解析后传 user_ids）。"""
    rows = (
        await db.execute(select(User).where(User.id.in_(payload.user_ids)))
    ).scalars().all()
    found = {u.id: u for u in rows}
    missing = [uid for uid in payload.user_ids if uid not in found]
    if missing:
        raise HTTPException(status_code=400, detail=f"用户不存在：{missing}")
    # 离职 / 禁用员工不参与任何业务，从本批中静默剔除——不影响其余有效员工的派发。
    effective_user_ids = [uid for uid in payload.user_ids if not bool(found[uid].disabled)]
    if not effective_user_ids:
        raise HTTPException(status_code=400, detail="所选员工均已离职或被禁用，无法派发。")

    title = (payload.title or "陪练通关").strip() or "陪练通关"
    deadline = _parse_iso_dt(payload.deadline_at)
    out: list[ExamDTO] = []
    notify_exam_ids: list[int] = []
    for uid in effective_user_ids:
        target = found[uid]
        exam = Exam(
            user_id=uid,
            title=title,
            pass_score=int(payload.pass_score),
            status="pending",
            attempt_count=0,
            max_attempts=int(payload.max_attempts),
            fixed_training_type=payload.fixed_training_type,
            fixed_difficulty=payload.fixed_difficulty,
            fixed_customer_type=payload.fixed_customer_type,
            ai_weight=float(payload.ai_weight),
            deadline_at=deadline,
            created_by=admin.id,
        )
        db.add(exam)
        await db.flush()
        await db.refresh(exam)
        notify_exam_ids.append(int(exam.id))
        out.append(_exam_to_dto(exam, target))
    await db.commit()
    if notify_exam_ids:
        # 一次群发：相同 title + max_attempts + deadline 的会被合并成一次企微 API 调用
        from ..wecom_push_bulk import bulk_push_exams

        async def _bg_push(target_ids: list[int]) -> None:
            try:
                await bulk_push_exams(target_ids)
            except Exception:  # noqa: BLE001
                logger.exception("[exam_assigned] bulk push failed batch_size=%s", len(target_ids))

        asyncio.create_task(_bg_push(list(notify_exam_ids)))
    return out


@admin_router.get("")
async def list_exams(
    page: int | None = Query(None, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    keyword: str | None = Query(None, description="按应试者姓名 / 用户名 / 标题模糊搜索"),
    status_: str | None = Query(None, alias="status"),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> Any:
    """列表。
    不传 page → 返回 list[ExamDTO]，沿用旧契约；
    传 page → 返回 {items, total, page, page_size}。
    """
    del admin
    stmt = select(Exam)
    count_stmt = select(func.count()).select_from(Exam)
    if status_:
        stmt = stmt.where(Exam.status == status_.strip())
        count_stmt = count_stmt.where(Exam.status == status_.strip())
    kw = (keyword or "").strip()
    if kw:
        like = f"%{kw}%"
        # 关键字命中 exam.title 或者命中应试者（先取候选 user_id 子查询）
        user_sub = select(User.id).where(
            or_(
                User.username.like(like),
                User.real_name.like(like),
                User.display_name.like(like),
            )
        )
        kw_cond = or_(Exam.title.like(like), Exam.user_id.in_(user_sub))
        stmt = stmt.where(kw_cond)
        count_stmt = count_stmt.where(kw_cond)
    stmt = stmt.order_by(desc(Exam.created_at), desc(Exam.id))

    if page is None:
        result = await db.execute(stmt)
        exams = result.scalars().all()
        if not exams:
            return []
        user_ids = {e.user_id for e in exams}
        user_rows = await db.execute(select(User).where(User.id.in_(user_ids)))
        user_map = {u.id: u for u in user_rows.scalars().all()}
        return [_exam_to_dto(e, user_map.get(e.user_id)) for e in exams]

    total = int((await db.execute(count_stmt)).scalar_one() or 0)
    stmt = stmt.limit(page_size).offset((page - 1) * page_size)
    result = await db.execute(stmt)
    exams = result.scalars().all()
    user_ids = {e.user_id for e in exams}
    user_map: dict[int, User] = {}
    if user_ids:
        user_rows = await db.execute(select(User).where(User.id.in_(user_ids)))
        user_map = {u.id: u for u in user_rows.scalars().all()}
    items = [_exam_to_dto(e, user_map.get(e.user_id)).model_dump() for e in exams]
    return {"items": items, "total": total, "page": page, "page_size": page_size}


@admin_router.get("/pending-review", response_model=list[dict])
async def list_pending_review(
    limit: int = Query(default=200, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> list[dict]:
    """返回所有 status=completed 且 reviewed_at IS NULL 的 attempt（含所属考试和应试者）。
    默认最多 200 条，按 completed_at 倒序，避免历史积压一次拉空。
    """
    del admin
    rows = await db.execute(
        select(ExamAttempt)
        .where(ExamAttempt.status == "completed", ExamAttempt.reviewed_at.is_(None))
        .order_by(desc(ExamAttempt.completed_at))
        .limit(limit)
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


@admin_router.post("/bulk-delete")
async def bulk_delete_exams(
    payload: BulkExamIdsPayload,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    """批量删除通关任务。

    带尝试记录（attempt_count > 0）的通关，必须 `force=true` 才会级联清掉
    attempts + 对应的 session；否则跳过并在 `skipped` 里返回，前端可根据这个
    重新弹一次确认再以强制模式重试。
    """
    del admin
    ids = sorted({int(i) for i in payload.ids})
    if not ids:
        return {"deleted": 0, "skipped": [], "skipped_count": 0, "deleted_attempts": 0}

    exam_rows = (
        await db.execute(select(Exam).where(Exam.id.in_(ids)))
    ).scalars().all()
    found_ids = {int(e.id) for e in exam_rows}
    has_attempts = {int(e.id) for e in exam_rows if int(e.attempt_count or 0) > 0}

    if has_attempts and not payload.force:
        # 不强制：跳过有尝试记录的，没尝试过的正常删
        deletable = [i for i in ids if i in found_ids and i not in has_attempts]
        deleted_attempts = 0
        if deletable:
            # 删 exam 前清掉可能存在的 attempt（理论上 attempt_count==0 时不会有，但保险起见）
            atts = (
                await db.execute(select(ExamAttempt).where(ExamAttempt.exam_id.in_(deletable)))
            ).scalars().all()
            for att in atts:
                if att.session_id:
                    await session_store.delete_session(db, att.session_id)
                await db.delete(att)
                deleted_attempts += 1
            await db.execute(sql_delete(Exam).where(Exam.id.in_(deletable)))
        return {
            "deleted": len(deletable),
            "skipped": sorted(has_attempts),
            "skipped_count": len(has_attempts),
            "deleted_attempts": deleted_attempts,
        }

    # 强制：先清 attempts + sessions，再删 exam
    deleted_attempts = 0
    target_ids = [i for i in ids if i in found_ids]
    if target_ids:
        atts = (
            await db.execute(select(ExamAttempt).where(ExamAttempt.exam_id.in_(target_ids)))
        ).scalars().all()
        for att in atts:
            if att.session_id:
                await session_store.delete_session(db, att.session_id)
            await db.delete(att)
            deleted_attempts += 1
        await db.flush()
        res = await db.execute(sql_delete(Exam).where(Exam.id.in_(target_ids)))
        return {
            "deleted": int(res.rowcount or 0),
            "skipped": [],
            "skipped_count": 0,
            "deleted_attempts": deleted_attempts,
        }
    return {"deleted": 0, "skipped": [], "skipped_count": 0, "deleted_attempts": 0}


@admin_router.post("/{exam_id}/wecom-push")
async def push_exam_to_wecom(
    exam_id: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    """单条 AI 通关派发企微推送：用户在派发面板看到失败时一键重推。

    内部走 bulk_push_exams 的同一条路径，写一条新的 notification_log，
    业务侧没有 wecom_push_status 字段，结果只在推送监控页可见。
    """
    del admin
    exam = await db.get(Exam, exam_id)
    if exam is None:
        raise HTTPException(status_code=404, detail="AI 通关任务不存在。")
    from ..wecom_push_bulk import bulk_push_exams
    result = await bulk_push_exams([int(exam.id)])
    return {
        "exam_id": int(exam.id),
        "sent": int(result.get("sent", 0)),
        "failed": int(result.get("failed", 0)),
        "skipped": int(result.get("skipped", 0)),
    }


@review_router.post("/{attempt_id}/review", response_model=dict)
async def submit_admin_review(
    attempt_id: int,
    payload: ExamReviewRequest,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict:
    async with _exam_lock(attempt_id):
        response_payload, _attempt_id_for_notify, log_payload = await _review_exam_attempt_locked(
            attempt_id=attempt_id,
            payload=payload,
            db=db,
            admin=admin,
        )

    logger.info(
        "exam attempt reviewed: attempt_id=%s ai=%.1f admin=%.1f final=%.1f pass=%s exam_status=%s",
        attempt_id, *log_payload,
    )
    return response_payload


__all__ = ["admin_router", "review_router"]
