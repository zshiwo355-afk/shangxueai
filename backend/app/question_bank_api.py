"""题库（question_bank）管理：管理员 CRUD + 分页筛选。"""
from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import delete as sql_delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from .auth import require_admin
from .db import get_db
from .models import QuestionBank, User
from .paper_grading import (
    QUESTION_TYPES,
    parse_answer,
    parse_options,
    question_type_label,
)

router = APIRouter(prefix="/api/admin/question-bank", tags=["admin-question-bank"])


# ---------------- DTO ----------------


class QuestionDTO(BaseModel):
    id: int
    question_type: str
    question_type_label: str
    stem: str
    options: list[str]
    correct_answer: list[str]
    default_score: float
    category: str
    tag: str
    difficulty: str
    explanation: str
    status: str
    source: str
    created_at: str = ""
    updated_at: str = ""


class QuestionCreate(BaseModel):
    question_type: str = Field(..., max_length=16)
    stem: str = Field(..., min_length=1)
    options: list[str] = Field(default_factory=list)
    correct_answer: list[str] = Field(default_factory=list)
    default_score: float = 5.0
    category: str = Field(default="", max_length=128)
    tag: str = Field(default="", max_length=255)
    difficulty: str = Field(default="", max_length=32)
    explanation: str = Field(default="")
    status: str = Field(default="active", max_length=16)

    @field_validator("question_type")
    @classmethod
    def _check_type(cls, v: str) -> str:
        v = (v or "").strip().lower()
        if v not in QUESTION_TYPES:
            raise ValueError(f"题型必须是 {QUESTION_TYPES} 之一")
        return v

    @field_validator("default_score")
    @classmethod
    def _check_score(cls, v: float) -> float:
        if v is None or v <= 0:
            raise ValueError("分值必须大于 0")
        return float(v)


class QuestionUpdate(BaseModel):
    question_type: str | None = None
    stem: str | None = None
    options: list[str] | None = None
    correct_answer: list[str] | None = None
    default_score: float | None = None
    category: str | None = None
    tag: str | None = None
    difficulty: str | None = None
    explanation: str | None = None
    status: str | None = None

    @field_validator("question_type")
    @classmethod
    def _check_type(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = v.strip().lower()
        if v not in QUESTION_TYPES:
            raise ValueError(f"题型必须是 {QUESTION_TYPES} 之一")
        return v

    @field_validator("default_score")
    @classmethod
    def _check_score(cls, v: float | None) -> float | None:
        if v is None:
            return None
        if v <= 0:
            raise ValueError("分值必须大于 0")
        return float(v)


class ListResponse(BaseModel):
    items: list[QuestionDTO]
    total: int
    page: int
    page_size: int


# ---------------- helpers ----------------


def _to_dto(q: QuestionBank) -> QuestionDTO:
    return QuestionDTO(
        id=q.id,
        question_type=q.question_type,
        question_type_label=question_type_label(q.question_type),
        stem=q.stem,
        options=parse_options(q.options_json),
        correct_answer=parse_answer(q.correct_answer_json),
        default_score=float(q.default_score or 0),
        category=q.category or "",
        tag=q.tag or "",
        difficulty=q.difficulty or "",
        explanation=q.explanation or "",
        status=q.status or "active",
        source=q.source or "manual",
        created_at=q.created_at.isoformat() if q.created_at else "",
        updated_at=q.updated_at.isoformat() if q.updated_at else "",
    )


def _validate_options_for_type(qtype: str, options: list[str], correct: list[str]) -> None:
    qtype = (qtype or "").lower()
    if qtype in {"single", "multiple"}:
        if len([o for o in options if o]) < 2:
            raise HTTPException(status_code=400, detail="选择题至少需要 2 个选项。")
        valid_letters = {chr(ord("A") + i) for i in range(len(options))}
        bad = [c for c in correct if c not in valid_letters]
        if bad:
            raise HTTPException(status_code=400, detail=f"正确答案 {','.join(bad)} 不在选项范围内。")
        if qtype == "single" and len(correct) != 1:
            raise HTTPException(status_code=400, detail="单选题正确答案应只有 1 个。")
        if qtype == "multiple" and len(correct) < 1:
            raise HTTPException(status_code=400, detail="多选题正确答案不能为空。")
    elif qtype == "judge":
        if not correct or correct[0] not in {"对", "错"}:
            raise HTTPException(status_code=400, detail="判断题答案必须是 对/错。")
    elif qtype == "blank":
        if not correct:
            raise HTTPException(status_code=400, detail="填空题需要至少 1 个参考答案。")
    # short_answer 允许 correct 为空


# ---------------- routes ----------------


@router.get("", response_model=ListResponse)
async def list_questions(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    question_type: str | None = Query(None),
    category: str | None = Query(None),
    keyword: str | None = Query(None),
    status_: str | None = Query(None, alias="status"),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> ListResponse:
    del admin
    stmt = select(QuestionBank)
    count_stmt = select(func.count()).select_from(QuestionBank)

    if question_type:
        stmt = stmt.where(QuestionBank.question_type == question_type)
        count_stmt = count_stmt.where(QuestionBank.question_type == question_type)
    if category:
        stmt = stmt.where(QuestionBank.category == category)
        count_stmt = count_stmt.where(QuestionBank.category == category)
    if status_:
        stmt = stmt.where(QuestionBank.status == status_)
        count_stmt = count_stmt.where(QuestionBank.status == status_)
    if keyword:
        kw = f"%{keyword.strip()}%"
        cond = or_(QuestionBank.stem.like(kw), QuestionBank.tag.like(kw), QuestionBank.category.like(kw))
        stmt = stmt.where(cond)
        count_stmt = count_stmt.where(cond)

    stmt = stmt.order_by(QuestionBank.id.desc()).limit(page_size).offset((page - 1) * page_size)

    rows = (await db.execute(stmt)).scalars().all()
    total = (await db.execute(count_stmt)).scalar_one()

    return ListResponse(
        items=[_to_dto(r) for r in rows],
        total=int(total),
        page=page,
        page_size=page_size,
    )


@router.get("/categories", response_model=list[str])
async def list_categories(
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> list[str]:
    del admin
    stmt = (
        select(QuestionBank.category)
        .where(QuestionBank.category != "")
        .distinct()
        .order_by(QuestionBank.category)
    )
    rows = (await db.execute(stmt)).scalars().all()
    return [r for r in rows if r]


@router.get("/{question_id}", response_model=QuestionDTO)
async def get_question(
    question_id: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> QuestionDTO:
    del admin
    res = await db.execute(select(QuestionBank).where(QuestionBank.id == question_id))
    q = res.scalar_one_or_none()
    if not q:
        raise HTTPException(status_code=404, detail="题目不存在。")
    return _to_dto(q)


@router.post("", response_model=QuestionDTO)
async def create_question(
    payload: QuestionCreate,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> QuestionDTO:
    options = [(o or "").strip() for o in payload.options]
    correct = [(c or "").strip() for c in payload.correct_answer]
    _validate_options_for_type(payload.question_type, options, correct)

    q = QuestionBank(
        question_type=payload.question_type,
        stem=payload.stem.strip(),
        options_json=json.dumps(options, ensure_ascii=False),
        correct_answer_json=json.dumps(correct, ensure_ascii=False),
        default_score=payload.default_score,
        category=payload.category.strip(),
        tag=payload.tag.strip(),
        difficulty=payload.difficulty.strip(),
        explanation=payload.explanation.strip(),
        status=payload.status or "active",
        source="manual",
        created_by=admin.id,
    )
    db.add(q)
    await db.flush()
    await db.refresh(q)
    return _to_dto(q)


@router.put("/{question_id}", response_model=QuestionDTO)
async def update_question(
    question_id: int,
    payload: QuestionUpdate,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> QuestionDTO:
    del admin
    res = await db.execute(select(QuestionBank).where(QuestionBank.id == question_id))
    q = res.scalar_one_or_none()
    if not q:
        raise HTTPException(status_code=404, detail="题目不存在。")

    new_qtype = (payload.question_type or q.question_type).lower()
    new_options = (
        [(o or "").strip() for o in payload.options]
        if payload.options is not None
        else parse_options(q.options_json)
    )
    new_correct = (
        [(c or "").strip() for c in payload.correct_answer]
        if payload.correct_answer is not None
        else parse_answer(q.correct_answer_json)
    )
    _validate_options_for_type(new_qtype, new_options, new_correct)

    q.question_type = new_qtype
    if payload.stem is not None:
        q.stem = payload.stem.strip()
    if payload.options is not None:
        q.options_json = json.dumps(new_options, ensure_ascii=False)
    if payload.correct_answer is not None:
        q.correct_answer_json = json.dumps(new_correct, ensure_ascii=False)
    if payload.default_score is not None:
        q.default_score = payload.default_score
    if payload.category is not None:
        q.category = payload.category.strip()
    if payload.tag is not None:
        q.tag = payload.tag.strip()
    if payload.difficulty is not None:
        q.difficulty = payload.difficulty.strip()
    if payload.explanation is not None:
        q.explanation = payload.explanation.strip()
    if payload.status is not None:
        q.status = payload.status
    await db.flush()
    await db.refresh(q)
    return _to_dto(q)


@router.delete("/{question_id}")
async def delete_question(
    question_id: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    del admin
    res = await db.execute(sql_delete(QuestionBank).where(QuestionBank.id == question_id))
    if res.rowcount == 0:
        raise HTTPException(status_code=404, detail="题目不存在。")
    return {"success": True}
