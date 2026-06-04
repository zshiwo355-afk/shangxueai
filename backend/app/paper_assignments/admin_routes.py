"""管理端：派发列表、待复核、批量删除、企微推送（单/批）、复核打分。"""
from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import delete as sql_delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import require_admin
from ..db import get_db, session_scope
from ..models import (
    Paper,
    PaperAnswer,
    PaperAssignment,
    PaperQuestion,
    PaperSubmission,
    QuestionBank,
    User,
)
from ..paper_grading import (
    is_objective,
    parse_answer,
    parse_options,
    question_type_label,
)
from ..wecom_push import push_assignment
from ..wecom_push_bulk import bulk_push_paper_assignments
from .dtos import (
    AnswerDTO,
    AssignmentDTO,
    AssignmentListResponse,
    BulkAssignmentIdsPayload,
    BulkAssignmentPushPayload,
    CreateAssignmentsPayload,
    GradeSubmissionPayload,
    PendingSubmissionDTO,
    PendingSubmissionListResponse,
    SubmissionDetailResponse,
    SubmissionDTO,
)
from .grading import (
    _ensure_assignment_status,
    _recalc_submission,
    paper_grading_logger,
)
from .helpers import (
    _build_assignment_dto,
    _build_assignment_dtos,
    _parse_datetime,
    _submission_to_dto,
)


router = APIRouter(prefix="/api/admin/paper-assignments", tags=["admin-paper-assignments"])


# ---------------- 派发列表 / 待复核 ----------------


@router.get("")
async def list_assignments(
    page: int | None = Query(None, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    paper_id: int | None = Query(None),
    status_: str | None = Query(None, alias="status"),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> list[AssignmentDTO] | AssignmentListResponse:
    del admin
    stmt = select(PaperAssignment).order_by(PaperAssignment.id.desc())
    count_stmt = select(func.count()).select_from(PaperAssignment)
    if paper_id:
        stmt = stmt.where(PaperAssignment.paper_id == paper_id)
        count_stmt = count_stmt.where(PaperAssignment.paper_id == paper_id)
    if status_:
        stmt = stmt.where(PaperAssignment.status == status_)
        count_stmt = count_stmt.where(PaperAssignment.status == status_)
    total = 0
    if page is not None:
        total = int((await db.execute(count_stmt)).scalar_one() or 0)
        stmt = stmt.limit(page_size).offset((page - 1) * page_size)
    rows = (await db.execute(stmt)).scalars().all()
    items = await _build_assignment_dtos(rows, db)
    if page is None:
        return items
    return AssignmentListResponse(items=items, total=total, page=page, page_size=page_size)


@router.get("/pending-review")
async def list_pending_review(
    page: int | None = Query(None, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> list[AssignmentDTO] | AssignmentListResponse:
    """待复核：包含至少一条 status=submitted 提交的派发。"""
    del admin
    stmt = (
        select(PaperAssignment)
        .join(PaperSubmission, PaperSubmission.assignment_id == PaperAssignment.id)
        .where(PaperSubmission.status == "submitted")
        .group_by(PaperAssignment.id)
        .order_by(PaperAssignment.id.desc())
    )
    total = 0
    if page is not None:
        total = int(
            (
                await db.execute(
                    select(func.count(func.distinct(PaperAssignment.id)))
                    .join(PaperSubmission, PaperSubmission.assignment_id == PaperAssignment.id)
                    .where(PaperSubmission.status == "submitted")
                )
            ).scalar_one()
            or 0
        )
        stmt = stmt.limit(page_size).offset((page - 1) * page_size)
    rows = (await db.execute(stmt)).scalars().all()
    items = await _build_assignment_dtos(rows, db)
    if page is None:
        return items
    return AssignmentListResponse(items=items, total=total, page=page, page_size=page_size)


@router.get("/pending-submissions")
async def list_pending_submissions(
    page: int | None = Query(None, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> list[PendingSubmissionDTO] | PendingSubmissionListResponse:
    """待复核 submissions 扁平表（status=submitted）。"""
    del admin
    stmt = select(PaperSubmission).where(PaperSubmission.status == "submitted").order_by(PaperSubmission.submitted_at.desc())
    total = 0
    if page is not None:
        total = int(
            (
                await db.execute(
                    select(func.count()).select_from(PaperSubmission).where(PaperSubmission.status == "submitted")
                )
            ).scalar_one()
            or 0
        )
        stmt = stmt.limit(page_size).offset((page - 1) * page_size)
    rows = (await db.execute(stmt)).scalars().all()

    paper_ids = sorted({row.paper_id for row in rows})
    user_ids = sorted({row.user_id for row in rows})
    paper_map: dict[int, str] = {}
    if paper_ids:
        paper_rows = await db.execute(select(Paper.id, Paper.title).where(Paper.id.in_(paper_ids)))
        paper_map = {int(paper_id): title or "" for paper_id, title in paper_rows.all()}
    user_map: dict[int, User] = {}
    if user_ids:
        user_rows = await db.execute(select(User).where(User.id.in_(user_ids)))
        user_map = {int(user.id): user for user in user_rows.scalars().all()}

    out: list[PendingSubmissionDTO] = []
    for s in rows:
        user = user_map.get(int(s.user_id))
        out.append(
            PendingSubmissionDTO(
                id=s.id,
                assignment_id=s.assignment_id,
                paper_id=s.paper_id,
                paper_title=paper_map.get(int(s.paper_id), ""),
                user_id=s.user_id,
                user_username=user.username if user else "",
                user_display_name=(user.real_name or user.display_name or user.username) if user else "",
                attempt_no=int(s.attempt_no or 1),
                auto_score=float(s.auto_score) if s.auto_score is not None else None,
                submitted_at=s.submitted_at.isoformat() if s.submitted_at else None,
            )
        )
    if page is None:
        return out
    return PendingSubmissionListResponse(items=out, total=total, page=page, page_size=page_size)


# ---------------- 创建 / 删除 / 推送 ----------------


@router.post("", response_model=list[AssignmentDTO])
async def create_assignments(
    payload: CreateAssignmentsPayload,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> list[AssignmentDTO]:
    paper_res = await db.execute(select(Paper).where(Paper.id == payload.paper_id))
    paper = paper_res.scalar_one_or_none()
    if not paper:
        raise HTTPException(status_code=404, detail="试卷不存在。")
    if paper.status != "published":
        raise HTTPException(status_code=400, detail="仅已发布的试卷可派发。")
    if (paper.question_count or 0) <= 0:
        raise HTTPException(status_code=400, detail="试卷尚无题目。")

    user_rows = (
        await db.execute(select(User).where(User.id.in_(payload.user_ids)))
    ).scalars().all()
    found_ids = {u.id for u in user_rows}
    missing = [uid for uid in payload.user_ids if uid not in found_ids]
    if missing:
        raise HTTPException(status_code=400, detail=f"用户不存在：{missing}")
    # 离职 / 禁用员工不参与任何业务，从本批中静默剔除——不影响其余有效员工的派发。
    effective_user_ids = [int(u.id) for u in user_rows if not bool(u.disabled)]
    if not effective_user_ids:
        raise HTTPException(status_code=400, detail="所选员工均已离职或被禁用，无法派发。")

    deadline = _parse_datetime(payload.deadline_at)

    # 已存在派发的用户（uniq 冲突避免）
    existing_pairs = (
        await db.execute(
            select(PaperAssignment).where(
                PaperAssignment.paper_id == payload.paper_id,
                PaperAssignment.user_id.in_(effective_user_ids),
            )
        )
    ).scalars().all()
    existing_user_ids = {row.user_id for row in existing_pairs}
    existing_by_user = {row.user_id: row for row in existing_pairs}

    created: list[PaperAssignment] = []
    for uid in effective_user_ids:
        if uid in existing_user_ids:
            created.append(existing_by_user[uid])
            continue
        row = PaperAssignment(
            paper_id=payload.paper_id,
            user_id=uid,
            max_attempts=int(payload.max_attempts or 1),
            deadline_at=deadline,
            status="pending",
            created_by=admin.id,
        )
        db.add(row)
        await db.flush()
        await db.refresh(row)
        created.append(row)

    return await _build_assignment_dtos(created, db)


@router.delete("/{assignment_id}")
async def delete_assignment(
    assignment_id: int,
    force: bool = Query(False, description="为 true 时连同已有提交一起级联删除"),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    del admin
    sub_count = (
        await db.execute(
            select(func.count()).select_from(PaperSubmission).where(
                PaperSubmission.assignment_id == assignment_id
            )
        )
    ).scalar_one()
    if sub_count and not force:
        raise HTTPException(
            status_code=409,
            detail=f"该派发已有 {int(sub_count)} 条提交记录，请确认后强制删除。",
        )

    # 级联清理 paper_answers + paper_submissions
    if sub_count:
        sub_ids = (
            await db.execute(
                select(PaperSubmission.id).where(PaperSubmission.assignment_id == assignment_id)
            )
        ).scalars().all()
        if sub_ids:
            await db.execute(sql_delete(PaperAnswer).where(PaperAnswer.submission_id.in_(sub_ids)))
            await db.execute(sql_delete(PaperSubmission).where(PaperSubmission.id.in_(sub_ids)))

    res = await db.execute(sql_delete(PaperAssignment).where(PaperAssignment.id == assignment_id))
    if res.rowcount == 0:
        raise HTTPException(status_code=404, detail="派发任务不存在。")
    return {"success": True, "deleted_submissions": int(sub_count)}


@router.post("/{assignment_id}/wecom-push", response_model=AssignmentDTO)
async def push_to_wecom(
    assignment_id: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> AssignmentDTO:
    del admin
    res = await db.execute(select(PaperAssignment).where(PaperAssignment.id == assignment_id))
    row = res.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="派发任务不存在。")
    # 推送本身可能因网络抖动耗时数秒到十几秒。把它放到独立 session 里，
    # 避免主请求事务长时间持锁；推送函数内部已经把状态字段、log 都写好。
    async with session_scope() as push_session:
        await push_assignment(assignment_id, push_session)
    await db.refresh(row)
    return await _build_assignment_dto(row, db)


@router.post("/bulk-delete")
async def bulk_delete_assignments(
    payload: BulkAssignmentIdsPayload,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    """批量删除派发任务。

    带提交记录的派发，必须 `force=true` 才会级联清掉 paper_answers 和
    paper_submissions；否则跳过并在 `skipped` 里返回，前端可根据这个
    重新弹一次确认再以强制模式重试。
    """
    del admin
    ids = sorted({int(i) for i in payload.ids})
    if not ids:
        return {"deleted": 0, "skipped": [], "skipped_count": 0, "deleted_submissions": 0}

    # 哪些派发有提交
    sub_count_rows = (
        await db.execute(
            select(PaperSubmission.assignment_id, func.count(PaperSubmission.id))
            .where(PaperSubmission.assignment_id.in_(ids))
            .group_by(PaperSubmission.assignment_id)
        )
    ).all()
    sub_count_map = {int(aid): int(cnt) for aid, cnt in sub_count_rows}
    has_subs = {aid for aid, cnt in sub_count_map.items() if cnt > 0}

    if has_subs and not payload.force:
        # 不强制：把有提交的跳过，没提交的正常删
        deletable = [i for i in ids if i not in has_subs]
        if deletable:
            await db.execute(sql_delete(PaperAssignment).where(PaperAssignment.id.in_(deletable)))
        return {
            "deleted": len(deletable),
            "skipped": sorted(has_subs),
            "skipped_count": len(has_subs),
            "deleted_submissions": 0,
        }

    # 强制：先清提交、答题，再删派发
    deleted_subs = 0
    if has_subs:
        sub_ids = (
            await db.execute(
                select(PaperSubmission.id).where(PaperSubmission.assignment_id.in_(list(has_subs)))
            )
        ).scalars().all()
        if sub_ids:
            await db.execute(sql_delete(PaperAnswer).where(PaperAnswer.submission_id.in_(sub_ids)))
            res_sub = await db.execute(sql_delete(PaperSubmission).where(PaperSubmission.id.in_(sub_ids)))
            deleted_subs = int(res_sub.rowcount or 0)

    res = await db.execute(sql_delete(PaperAssignment).where(PaperAssignment.id.in_(ids)))
    return {
        "deleted": int(res.rowcount or 0),
        "skipped": [],
        "skipped_count": 0,
        "deleted_submissions": deleted_subs,
    }


@router.post("/bulk-wecom-push")
async def bulk_push_assignments_wecom(
    payload: BulkAssignmentPushPayload,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    """批量推送企微。立即返回，真正的推送在后台 task 里跑。

    分组群发模式：
    - 同试卷 + 同截止时间 = 一组，一次企微 API 调用群发，秒级完成；
    - 每条 assignment 各自有 wecom_push_status / notification_log，监控页可查；
    - 企微返回的 invaliduser 精确映射回对应 assignment 标 failed，其余标 sent；
    - 失败不影响其它组。
    """
    del admin
    ids = sorted({int(i) for i in payload.ids})
    if not ids:
        return {"queued": 0, "missing": []}

    rows = (
        await db.execute(select(PaperAssignment.id).where(PaperAssignment.id.in_(ids)))
    ).all()
    found_ids = {int(r[0]) for r in rows}
    missing = [i for i in ids if i not in found_ids]
    queued = [i for i in ids if i in found_ids]

    async def _run_bulk_push(target_ids: list[int]) -> None:
        try:
            result = await bulk_push_paper_assignments(target_ids)
            paper_grading_logger.info(
                "bulk_wecom_push done sent=%s failed=%s skipped=%s total=%s",
                result.get("sent"), result.get("failed"), result.get("skipped"),
                len(target_ids),
            )
        except Exception:  # noqa: BLE001
            paper_grading_logger.exception(
                "bulk_wecom_push failed batch_size=%s", len(target_ids),
            )

    if queued:
        asyncio.create_task(_run_bulk_push(queued))

    return {
        "queued": len(queued),
        "missing": missing,
        # 同步返回里只能给"已加入推送队列"——真正的 sent/failed 要等后台跑完，
        # 通过列表的 wecom_push_status 字段或推送监控页查看。
        "sent": len(queued),
        "failed": 0,
        "results": [{"id": i, "ok": True, "message": "已加入推送队列"} for i in queued],
    }


# ---------------- 提交记录 / 复核 ----------------


@router.get("/{assignment_id}/submissions")
async def list_submissions(
    assignment_id: int,
    page: int | None = Query(None, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> Any:
    """单派发的所有提交。
    不传 page → 返回 list[SubmissionDTO]，沿用旧契约；
    传 page → 返回 {items, total, page, page_size}。
    """
    del admin
    base = (
        select(PaperSubmission)
        .where(PaperSubmission.assignment_id == assignment_id)
        .order_by(PaperSubmission.attempt_no.desc(), PaperSubmission.id.desc())
    )
    if page is None:
        rows = (await db.execute(base)).scalars().all()
        return [_submission_to_dto(s) for s in rows]
    total = int(
        (
            await db.execute(
                select(func.count())
                .select_from(PaperSubmission)
                .where(PaperSubmission.assignment_id == assignment_id)
            )
        ).scalar_one()
        or 0
    )
    rows = (
        await db.execute(base.limit(page_size).offset((page - 1) * page_size))
    ).scalars().all()
    return {
        "items": [_submission_to_dto(s).model_dump() for s in rows],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.get("/submissions/{submission_id}", response_model=SubmissionDetailResponse)
async def get_submission_detail(
    submission_id: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> SubmissionDetailResponse:
    del admin
    res = await db.execute(select(PaperSubmission).where(PaperSubmission.id == submission_id))
    sub = res.scalar_one_or_none()
    if not sub:
        raise HTTPException(status_code=404, detail="提交不存在。")

    paper_res = await db.execute(select(Paper).where(Paper.id == sub.paper_id))
    paper = paper_res.scalar_one_or_none()

    answer_rows = (
        await db.execute(
            select(PaperAnswer, PaperQuestion, QuestionBank)
            .join(PaperQuestion, PaperQuestion.id == PaperAnswer.paper_question_id, isouter=True)
            .join(QuestionBank, QuestionBank.id == PaperAnswer.question_id, isouter=True)
            .where(PaperAnswer.submission_id == submission_id)
            .order_by(PaperQuestion.sort_order, PaperQuestion.id)
        )
    ).all()

    answers: list[AnswerDTO] = []
    for ans, pq, qb in answer_rows:
        # 历史 submission 可能引用了之后被删除的 QuestionBank / PaperQuestion，
        # 用题型/分值兜底，避免 admin 复核 drawer 整张白屏。
        question_type = (qb.question_type if qb else ans.question_type) or ans.question_type
        score = (
            float(pq.score_override) if pq and pq.score_override is not None
            else float((qb.default_score if qb else 0) or 0)
        )
        answers.append(
            AnswerDTO(
                id=ans.id,
                paper_question_id=int(pq.id) if pq else int(ans.paper_question_id),
                question_id=int(qb.id) if qb else int(ans.question_id),
                question_type=question_type,
                question_type_label=question_type_label(question_type),
                stem=qb.stem if qb else "（题目数据已不可用）",
                options=parse_options(qb.options_json) if qb else [],
                correct_answer=parse_answer(qb.correct_answer_json) if qb else [],
                score=score,
                user_answer=parse_answer(ans.answer_json),
                auto_score=float(ans.auto_score) if ans.auto_score is not None else None,
                manual_score=float(ans.manual_score) if ans.manual_score is not None else None,
                ai_score=float(ans.ai_score) if ans.ai_score is not None else None,
                ai_comment=ans.ai_comment or "",
                final_score=float(ans.final_score) if ans.final_score is not None else None,
                is_correct=bool(ans.is_correct) if ans.is_correct is not None else None,
                comment=ans.comment or "",
                is_objective=is_objective(question_type),
            )
        )

    paper_summary = {
        "id": paper.id,
        "title": paper.title,
        "total_score": float(paper.total_score or 0),
        "pass_score": float(paper.pass_score or 0),
        "question_count": int(paper.question_count or 0),
    } if paper else {}

    return SubmissionDetailResponse(
        submission=_submission_to_dto(sub),
        paper=paper_summary,
        answers=answers,
    )


@router.post("/submissions/{submission_id}/grade", response_model=SubmissionDetailResponse)
async def grade_submission(
    submission_id: int,
    payload: GradeSubmissionPayload,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> SubmissionDetailResponse:
    res = await db.execute(select(PaperSubmission).where(PaperSubmission.id == submission_id))
    sub = res.scalar_one_or_none()
    if not sub:
        raise HTTPException(status_code=404, detail="提交不存在。")
    if sub.status == "in_progress":
        raise HTTPException(status_code=400, detail="尚未提交，无法评分。")

    patch_map = {int(patch.answer_id): patch for patch in payload.answers}
    if patch_map:
        # 直接按 ID 取 PaperAnswer，**不要** JOIN paper_questions / question_bank。
        # 历史 submission 的 PaperAnswer.question_id 可能已经指向被删除 / 重新导入
        # 后失效的 QuestionBank 行，INNER JOIN 会把这些行整个丢掉，导致
        # ans.manual_score 永远不会被写回，复核保存后 submission 卡在
        # status='submitted'，最终分也算不出来。
        answer_rows = (
            await db.execute(
                select(PaperAnswer).where(
                    PaperAnswer.submission_id == submission_id,
                    PaperAnswer.id.in_(patch_map.keys()),
                )
            )
        ).scalars().all()

        # 单独查每题的分值上限，用于校验。LEFT OUTER JOIN 保证 QuestionBank
        # 缺失时仍能拿到 PaperQuestion.score_override；都拿不到时按 0 处理
        # 并跳过上限校验（管理员输入照样保存）。
        pq_ids = sorted({int(ans.paper_question_id) for ans in answer_rows})
        max_score_by_pq: dict[int, float] = {}
        if pq_ids:
            cap_rows = (
                await db.execute(
                    select(
                        PaperQuestion.id,
                        PaperQuestion.score_override,
                        QuestionBank.default_score,
                    )
                    .join(
                        QuestionBank,
                        QuestionBank.id == PaperQuestion.question_id,
                        isouter=True,
                    )
                    .where(PaperQuestion.id.in_(pq_ids))
                )
            ).all()
            for pq_id, score_override, default_score in cap_rows:
                cap = (
                    float(score_override)
                    if score_override is not None
                    else float(default_score or 0)
                )
                max_score_by_pq[int(pq_id)] = cap

        for ans in answer_rows:
            patch = patch_map.get(int(ans.id))
            if not patch:
                continue
            max_score = max_score_by_pq.get(int(ans.paper_question_id), 0.0)
            if patch.manual_score < 0:
                raise HTTPException(
                    status_code=400,
                    detail=f"题目 {ans.paper_question_id} 评分不能为负。",
                )
            if max_score > 0 and patch.manual_score > max_score:
                raise HTTPException(
                    status_code=400,
                    detail=f"题目 {ans.paper_question_id} 评分需在 0 ~ {max_score} 之间。",
                )
            ans.manual_score = float(patch.manual_score)
            if patch.comment is not None:
                ans.comment = patch.comment.strip()

    if payload.overall_comment is not None:
        sub.comment = payload.overall_comment.strip()
    sub.graded_by = admin.id
    await _recalc_submission(sub, db)
    await db.flush()

    # 同步派发状态
    assign_res = await db.execute(select(PaperAssignment).where(PaperAssignment.id == sub.assignment_id))
    assign = assign_res.scalar_one_or_none()
    if assign:
        await _ensure_assignment_status(assign, db)

    await db.flush()
    await db.commit()
    return await get_submission_detail(submission_id, db, admin)


__all__ = ["router"]
