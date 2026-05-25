"""试卷（papers）管理：CRUD + 挑题 / 排序 / 单题分覆写 / 发布。"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import delete as sql_delete, func, select, update as sql_update
from sqlalchemy.ext.asyncio import AsyncSession

from .auth import require_admin
from .db import get_db
from .models import Paper, PaperAssignment, PaperQuestion, QuestionBank, User
from .paper_grading import (
    is_objective,
    is_subjective,
    parse_answer,
    parse_options,
    question_type_label,
)

router = APIRouter(prefix="/api/admin/papers", tags=["admin-papers"])


# ---------------- DTO ----------------


class PaperDTO(BaseModel):
    id: int
    title: str
    description: str
    total_score: float
    pass_score: float
    duration_minutes: int
    auto_grade_objective: bool
    manual_review_subjective: bool
    shuffle_questions: bool
    show_answer_after: str
    status: str
    question_count: int
    objective_count: int = 0
    subjective_count: int = 0
    needs_manual_review: bool = False
    created_at: str = ""
    updated_at: str = ""


class PaperListResponse(BaseModel):
    items: list[PaperDTO]
    total: int
    page: int
    page_size: int


class PaperCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=255)
    description: str = Field(default="")
    pass_score: float = 60
    duration_minutes: int = 0
    auto_grade_objective: bool = True
    manual_review_subjective: bool = True
    shuffle_questions: bool = False
    show_answer_after: str = Field(default="after_submit", max_length=16)


class PaperUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    pass_score: float | None = None
    duration_minutes: int | None = None
    auto_grade_objective: bool | None = None
    manual_review_subjective: bool | None = None
    shuffle_questions: bool | None = None
    show_answer_after: str | None = None
    status: str | None = None

    @field_validator("status")
    @classmethod
    def _check_status(cls, v: str | None) -> str | None:
        if v is None:
            return None
        if v not in {"draft", "published", "archived"}:
            raise ValueError("状态非法")
        return v


class PaperQuestionDTO(BaseModel):
    id: int
    paper_id: int
    question_id: int
    sort_order: int
    section_name: str
    score: float  # 实际生效分（覆写优先于 default_score）
    score_override: float | None
    question_type: str
    question_type_label: str
    stem: str
    options: list[str]
    correct_answer: list[str]
    explanation: str = ""


class AttachQuestionsPayload(BaseModel):
    question_ids: list[int] = Field(..., min_length=1)
    section_name: str = Field(default="", max_length=128)


class ReorderItem(BaseModel):
    id: int
    sort_order: int
    score_override: float | None = None
    section_name: str | None = None


class ReorderPayload(BaseModel):
    items: list[ReorderItem]


class PaperDetailResponse(BaseModel):
    paper: PaperDTO
    questions: list[PaperQuestionDTO]


# ---------------- helpers ----------------


async def _recalc_paper_stats(paper: Paper, db: AsyncSession) -> None:
    """重算试卷的 question_count / total_score。"""
    rows = (
        await db.execute(
            select(PaperQuestion, QuestionBank)
            .join(QuestionBank, QuestionBank.id == PaperQuestion.question_id)
            .where(PaperQuestion.paper_id == paper.id)
        )
    ).all()
    paper.question_count = len(rows)
    paper.total_score = float(
        sum(
            float(pq.score_override) if pq.score_override is not None else float(qb.default_score or 0)
            for (pq, qb) in rows
        )
    )


def _paper_to_dto(paper: Paper, *, objective: int = 0, subjective: int = 0) -> PaperDTO:
    return PaperDTO(
        id=paper.id,
        title=paper.title,
        description=paper.description or "",
        total_score=float(paper.total_score or 0),
        pass_score=float(paper.pass_score or 0),
        duration_minutes=int(paper.duration_minutes or 0),
        auto_grade_objective=bool(paper.auto_grade_objective),
        manual_review_subjective=bool(paper.manual_review_subjective),
        shuffle_questions=bool(paper.shuffle_questions),
        show_answer_after=paper.show_answer_after or "after_submit",
        status=paper.status or "draft",
        question_count=int(paper.question_count or 0),
        objective_count=objective,
        subjective_count=subjective,
        needs_manual_review=subjective > 0,
        created_at=paper.created_at.isoformat() if paper.created_at else "",
        updated_at=paper.updated_at.isoformat() if paper.updated_at else "",
    )


async def _count_paper_types(paper_id: int, db: AsyncSession) -> tuple[int, int]:
    rows = (
        await db.execute(
            select(QuestionBank.question_type)
            .join(PaperQuestion, PaperQuestion.question_id == QuestionBank.id)
            .where(PaperQuestion.paper_id == paper_id)
        )
    ).scalars().all()
    obj = sum(1 for t in rows if is_objective(t))
    sub = sum(1 for t in rows if is_subjective(t))
    return obj, sub


async def _count_paper_types_map(paper_ids: list[int], db: AsyncSession) -> dict[int, tuple[int, int]]:
    if not paper_ids:
        return {}
    rows = (
        await db.execute(
            select(PaperQuestion.paper_id, QuestionBank.question_type)
            .join(QuestionBank, QuestionBank.id == PaperQuestion.question_id)
            .where(PaperQuestion.paper_id.in_(paper_ids))
        )
    ).all()
    result: dict[int, tuple[int, int]] = {int(paper_id): (0, 0) for paper_id in paper_ids}
    for paper_id, question_type in rows:
        objective, subjective = result.get(int(paper_id), (0, 0))
        if is_objective(question_type):
            objective += 1
        elif is_subjective(question_type):
            subjective += 1
        result[int(paper_id)] = (objective, subjective)
    return result


# ---------------- routes ----------------


@router.get("")
async def list_papers(
    page: int | None = Query(None, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    status_: str | None = Query(None, alias="status"),
    keyword: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> list[PaperDTO] | PaperListResponse:
    del admin
    stmt = select(Paper)
    count_stmt = select(func.count()).select_from(Paper)
    if status_:
        stmt = stmt.where(Paper.status == status_)
        count_stmt = count_stmt.where(Paper.status == status_)
    if keyword:
        cond = Paper.title.like(f"%{keyword.strip()}%")
        stmt = stmt.where(cond)
        count_stmt = count_stmt.where(cond)
    stmt = stmt.order_by(Paper.id.desc())
    total = 0
    if page is not None:
        total = int((await db.execute(count_stmt)).scalar_one() or 0)
        stmt = stmt.limit(page_size).offset((page - 1) * page_size)
    papers = (await db.execute(stmt)).scalars().all()

    counts_map = await _count_paper_types_map([p.id for p in papers], db)
    out: list[PaperDTO] = []
    for p in papers:
        obj, sub = counts_map.get(int(p.id), (0, 0))
        out.append(_paper_to_dto(p, objective=obj, subjective=sub))
    if page is not None:
        return PaperListResponse(items=out, total=total, page=page, page_size=page_size)
    return out


@router.post("", response_model=PaperDTO)
async def create_paper(
    payload: PaperCreate,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> PaperDTO:
    p = Paper(
        title=payload.title.strip(),
        description=(payload.description or "").strip(),
        pass_score=float(payload.pass_score or 0),
        duration_minutes=int(payload.duration_minutes or 0),
        auto_grade_objective=bool(payload.auto_grade_objective),
        manual_review_subjective=bool(payload.manual_review_subjective),
        shuffle_questions=bool(payload.shuffle_questions),
        show_answer_after=(payload.show_answer_after or "after_submit"),
        status="draft",
        question_count=0,
        total_score=0.0,
        created_by=admin.id,
    )
    db.add(p)
    await db.flush()
    await db.refresh(p)
    return _paper_to_dto(p)


@router.get("/{paper_id}", response_model=PaperDetailResponse)
async def get_paper_detail(
    paper_id: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> PaperDetailResponse:
    del admin
    res = await db.execute(select(Paper).where(Paper.id == paper_id))
    paper = res.scalar_one_or_none()
    if not paper:
        raise HTTPException(status_code=404, detail="试卷不存在。")

    rows = (
        await db.execute(
            select(PaperQuestion, QuestionBank)
            .join(QuestionBank, QuestionBank.id == PaperQuestion.question_id)
            .where(PaperQuestion.paper_id == paper_id)
            .order_by(PaperQuestion.sort_order, PaperQuestion.id)
        )
    ).all()

    questions: list[PaperQuestionDTO] = []
    obj = sub = 0
    for pq, qb in rows:
        score = float(pq.score_override) if pq.score_override is not None else float(qb.default_score or 0)
        if is_objective(qb.question_type):
            obj += 1
        elif is_subjective(qb.question_type):
            sub += 1
        questions.append(
            PaperQuestionDTO(
                id=pq.id,
                paper_id=pq.paper_id,
                question_id=pq.question_id,
                sort_order=pq.sort_order,
                section_name=pq.section_name or "",
                score=score,
                score_override=float(pq.score_override) if pq.score_override is not None else None,
                question_type=qb.question_type,
                question_type_label=question_type_label(qb.question_type),
                stem=qb.stem,
                options=parse_options(qb.options_json),
                correct_answer=parse_answer(qb.correct_answer_json),
                explanation=qb.explanation or "",
            )
        )

    return PaperDetailResponse(
        paper=_paper_to_dto(paper, objective=obj, subjective=sub),
        questions=questions,
    )


@router.put("/{paper_id}", response_model=PaperDTO)
async def update_paper(
    paper_id: int,
    payload: PaperUpdate,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> PaperDTO:
    del admin
    res = await db.execute(select(Paper).where(Paper.id == paper_id))
    paper = res.scalar_one_or_none()
    if not paper:
        raise HTTPException(status_code=404, detail="试卷不存在。")

    if payload.title is not None:
        paper.title = payload.title.strip()
    if payload.description is not None:
        paper.description = payload.description.strip()
    if payload.pass_score is not None:
        paper.pass_score = float(payload.pass_score)
    if payload.duration_minutes is not None:
        paper.duration_minutes = int(payload.duration_minutes)
    if payload.auto_grade_objective is not None:
        paper.auto_grade_objective = bool(payload.auto_grade_objective)
    if payload.manual_review_subjective is not None:
        paper.manual_review_subjective = bool(payload.manual_review_subjective)
    if payload.shuffle_questions is not None:
        paper.shuffle_questions = bool(payload.shuffle_questions)
    if payload.show_answer_after is not None:
        paper.show_answer_after = payload.show_answer_after
    if payload.status is not None:
        paper.status = payload.status
    await db.flush()
    await db.refresh(paper)
    obj, sub = await _count_paper_types(paper.id, db)
    return _paper_to_dto(paper, objective=obj, subjective=sub)


@router.delete("/{paper_id}")
async def delete_paper(
    paper_id: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    del admin
    used = (
        await db.execute(
            select(func.count()).select_from(PaperAssignment).where(PaperAssignment.paper_id == paper_id)
        )
    ).scalar_one()
    if used:
        raise HTTPException(status_code=409, detail="该试卷已派发，无法删除。可改为归档。")
    await db.execute(sql_delete(PaperQuestion).where(PaperQuestion.paper_id == paper_id))
    res = await db.execute(sql_delete(Paper).where(Paper.id == paper_id))
    if res.rowcount == 0:
        raise HTTPException(status_code=404, detail="试卷不存在。")
    return {"success": True}


@router.post("/{paper_id}/publish", response_model=PaperDTO)
async def publish_paper(
    paper_id: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> PaperDTO:
    del admin
    res = await db.execute(select(Paper).where(Paper.id == paper_id))
    paper = res.scalar_one_or_none()
    if not paper:
        raise HTTPException(status_code=404, detail="试卷不存在。")
    if (paper.question_count or 0) <= 0:
        raise HTTPException(status_code=400, detail="试卷尚未挑题，无法发布。")
    paper.status = "published"
    await db.flush()
    await db.refresh(paper)
    obj, sub = await _count_paper_types(paper.id, db)
    return _paper_to_dto(paper, objective=obj, subjective=sub)


# ---------------- 题目挂载 ----------------


@router.post("/{paper_id}/questions", response_model=PaperDetailResponse)
async def attach_questions(
    paper_id: int,
    payload: AttachQuestionsPayload,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> PaperDetailResponse:
    paper_res = await db.execute(select(Paper).where(Paper.id == paper_id))
    paper = paper_res.scalar_one_or_none()
    if not paper:
        raise HTTPException(status_code=404, detail="试卷不存在。")

    # 校验题目存在
    qrows = (
        await db.execute(
            select(QuestionBank.id).where(QuestionBank.id.in_(payload.question_ids))
        )
    ).scalars().all()
    found = set(qrows)
    missing = [qid for qid in payload.question_ids if qid not in found]
    if missing:
        raise HTTPException(status_code=400, detail=f"题目不存在：{missing}")

    # 现有最大 sort_order
    cur_max = (
        await db.execute(
            select(func.coalesce(func.max(PaperQuestion.sort_order), 0)).where(
                PaperQuestion.paper_id == paper_id
            )
        )
    ).scalar_one()

    # 已挂载的题目（去重）
    existing_ids = set(
        (
            await db.execute(
                select(PaperQuestion.question_id).where(PaperQuestion.paper_id == paper_id)
            )
        ).scalars().all()
    )

    next_order = int(cur_max) + 10
    for qid in payload.question_ids:
        if qid in existing_ids:
            continue
        db.add(
            PaperQuestion(
                paper_id=paper_id,
                question_id=qid,
                sort_order=next_order,
                section_name=payload.section_name or "",
            )
        )
        existing_ids.add(qid)
        next_order += 10
    await db.flush()

    await _recalc_paper_stats(paper, db)
    await db.flush()
    return await get_paper_detail(paper_id, db, admin)


@router.put("/{paper_id}/questions/reorder", response_model=PaperDetailResponse)
async def reorder_paper_questions(
    paper_id: int,
    payload: ReorderPayload,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> PaperDetailResponse:
    paper_res = await db.execute(select(Paper).where(Paper.id == paper_id))
    paper = paper_res.scalar_one_or_none()
    if not paper:
        raise HTTPException(status_code=404, detail="试卷不存在。")

    for item in payload.items:
        values: dict[str, Any] = {"sort_order": int(item.sort_order)}
        if item.score_override is not None:
            if item.score_override <= 0:
                raise HTTPException(status_code=400, detail="单题分值必须大于 0。")
            values["score_override"] = float(item.score_override)
        if item.section_name is not None:
            values["section_name"] = item.section_name.strip()
        await db.execute(
            sql_update(PaperQuestion)
            .where(PaperQuestion.id == item.id, PaperQuestion.paper_id == paper_id)
            .values(**values)
        )

    await _recalc_paper_stats(paper, db)
    await db.flush()
    return await get_paper_detail(paper_id, db, admin)


@router.delete("/{paper_id}/questions/{paper_question_id}", response_model=PaperDetailResponse)
async def remove_paper_question(
    paper_id: int,
    paper_question_id: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> PaperDetailResponse:
    paper_res = await db.execute(select(Paper).where(Paper.id == paper_id))
    paper = paper_res.scalar_one_or_none()
    if not paper:
        raise HTTPException(status_code=404, detail="试卷不存在。")

    res = await db.execute(
        sql_delete(PaperQuestion).where(
            PaperQuestion.id == paper_question_id,
            PaperQuestion.paper_id == paper_id,
        )
    )
    if res.rowcount == 0:
        raise HTTPException(status_code=404, detail="题目未挂载到该试卷。")

    await _recalc_paper_stats(paper, db)
    await db.flush()
    return await get_paper_detail(paper_id, db, admin)
