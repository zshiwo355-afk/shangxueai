"""题库批量导入：上传 → 解析预览 → 行内编辑 → 确认入库 → 模板下载。

入库时若带 ?paper_id=xxx，则在写入题库的同时把这批题挂到对应试卷上，
并重算该试卷的题数与总分（用于「试卷管理」里直接导入题目）。
"""
from __future__ import annotations

import json
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .auth import require_admin
from .db import get_db
from .models import Paper, PaperQuestion, QuestionBank, QuestionImportJob, User
from .paper_importers import (
    ParsedRow,
    build_docx_template,
    build_excel_template,
    parse_docx,
    parse_excel,
    rows_from_json,
    rows_to_json,
    validate_row,
)

router = APIRouter(prefix="/api/admin/question-imports", tags=["admin-question-imports"])


# ---------------- DTO ----------------


class JobSummary(BaseModel):
    total: int
    valid: int
    invalid: int


class JobResponse(BaseModel):
    job_id: int
    source: str
    original_name: str
    summary: JobSummary
    rows: list[dict[str, Any]]
    committed: bool = False
    committed_count: int = 0
    committed_at: str | None = None


class UpdateRowPayload(BaseModel):
    data: dict[str, Any]


# ---------------- helpers ----------------


def _job_to_response(job: QuestionImportJob) -> JobResponse:
    rows = json.loads(job.rows_json or "[]")
    return JobResponse(
        job_id=job.id,
        source=job.source,
        original_name=job.original_name or "",
        summary=JobSummary(
            total=job.total_rows,
            valid=job.valid_rows,
            invalid=job.invalid_rows,
        ),
        rows=rows,
        committed=bool(job.committed),
        committed_count=int(job.committed_count or 0),
        committed_at=job.committed_at.isoformat() if job.committed_at else None,
    )


def _summarize(rows: list[ParsedRow]) -> tuple[int, int, int]:
    total = len(rows)
    valid = sum(1 for r in rows if r.ok)
    invalid = total - valid
    return total, valid, invalid


# ---------------- routes ----------------


@router.get("/template")
async def download_template(
    fmt: str = "xlsx",
    admin: User = Depends(require_admin),
):
    del admin
    fmt = (fmt or "xlsx").lower()
    if fmt == "xlsx":
        data = build_excel_template()
        media_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        filename = "question_bank_template.xlsx"
    elif fmt == "docx":
        try:
            data = build_docx_template()
        except RuntimeError as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc
        media_type = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        filename = "question_bank_template.docx"
    else:
        raise HTTPException(status_code=400, detail="模板格式仅支持 xlsx / docx。")

    def _iter():
        yield data

    headers = {"Content-Disposition": f'attachment; filename="{filename}"'}
    return StreamingResponse(_iter(), media_type=media_type, headers=headers)


@router.post("/upload", response_model=JobResponse)
async def upload_file(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> JobResponse:
    filename = file.filename or ""
    suffix = filename.lower().rsplit(".", 1)[-1] if "." in filename else ""
    content = await file.read()

    if suffix in {"xlsx", "xls"}:
        rows = parse_excel(content)
        source = "excel"
    elif suffix in {"docx"}:
        try:
            rows = parse_docx(content)
        except RuntimeError as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc
        source = "docx"
    else:
        raise HTTPException(status_code=400, detail="仅支持 .xlsx / .docx 格式。")

    total, valid, invalid = _summarize(rows)

    job = QuestionImportJob(
        created_by=admin.id,
        source=source,
        original_name=filename,
        total_rows=total,
        valid_rows=valid,
        invalid_rows=invalid,
        rows_json=rows_to_json(rows),
        committed=False,
        committed_count=0,
    )
    db.add(job)
    await db.flush()
    await db.refresh(job)
    return _job_to_response(job)


@router.get("/{job_id}", response_model=JobResponse)
async def get_job(
    job_id: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> JobResponse:
    del admin
    res = await db.execute(select(QuestionImportJob).where(QuestionImportJob.id == job_id))
    job = res.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="导入任务不存在。")
    return _job_to_response(job)


@router.put("/{job_id}/rows/{row_idx}", response_model=JobResponse)
async def update_row(
    job_id: int,
    row_idx: int,
    payload: UpdateRowPayload,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> JobResponse:
    del admin
    res = await db.execute(select(QuestionImportJob).where(QuestionImportJob.id == job_id))
    job = res.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="导入任务不存在。")
    if job.committed:
        raise HTTPException(status_code=400, detail="任务已入库，无法编辑。")

    rows = rows_from_json(job.rows_json)
    target = next((r for r in rows if r.idx == row_idx), None)
    if target is None:
        raise HTTPException(status_code=404, detail=f"第 {row_idx} 行不存在。")

    ok, errors, normalized = validate_row(payload.data)
    target.ok = ok
    target.errors = errors
    target.data = normalized
    target.raw = payload.data

    job.rows_json = rows_to_json(rows)
    job.total_rows, job.valid_rows, job.invalid_rows = _summarize(rows)
    await db.flush()
    await db.refresh(job)
    return _job_to_response(job)


@router.post("/{job_id}/commit", response_model=JobResponse)
async def commit_job(
    job_id: int,
    paper_id: int | None = Query(None, description="可选；指定后会把这批题同时挂到该试卷"),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> JobResponse:
    res = await db.execute(select(QuestionImportJob).where(QuestionImportJob.id == job_id))
    job = res.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="导入任务不存在。")
    if job.committed:
        raise HTTPException(status_code=400, detail="任务已入库，请勿重复提交。")

    # 若指定 paper_id，先校验试卷存在
    paper: Paper | None = None
    if paper_id is not None:
        paper = (
            await db.execute(select(Paper).where(Paper.id == paper_id))
        ).scalar_one_or_none()
        if not paper:
            raise HTTPException(status_code=404, detail="试卷不存在。")

    rows = rows_from_json(job.rows_json)
    valid_rows = [r for r in rows if r.ok and r.data]
    if not valid_rows:
        raise HTTPException(status_code=400, detail="没有可入库的合法题目。")

    inserted_ids: list[int] = []
    for row in valid_rows:
        d = row.data or {}
        q = QuestionBank(
            question_type=d.get("question_type", ""),
            stem=d.get("stem", ""),
            options_json=json.dumps(d.get("options", []), ensure_ascii=False),
            correct_answer_json=json.dumps(d.get("correct_answer", []), ensure_ascii=False),
            default_score=float(d.get("default_score", 5) or 5),
            category=d.get("category", "") or "",
            tag=d.get("tag", "") or "",
            difficulty=d.get("difficulty", "") or "",
            explanation=d.get("explanation", "") or "",
            status="active",
            source=job.source,
            created_by=admin.id,
        )
        db.add(q)
        await db.flush()  # 拿到自增 id
        inserted_ids.append(q.id)

    # 挂到指定试卷
    if paper is not None and inserted_ids:
        cur_max = (
            await db.execute(
                select(func.coalesce(func.max(PaperQuestion.sort_order), 0)).where(
                    PaperQuestion.paper_id == paper.id
                )
            )
        ).scalar_one()
        next_order = int(cur_max) + 10
        for qid in inserted_ids:
            db.add(
                PaperQuestion(
                    paper_id=paper.id,
                    question_id=qid,
                    sort_order=next_order,
                    section_name="",
                )
            )
            next_order += 10
        await db.flush()
        # 重算 paper 的 question_count / total_score
        rows_pq = (
            await db.execute(
                select(PaperQuestion, QuestionBank)
                .join(QuestionBank, QuestionBank.id == PaperQuestion.question_id)
                .where(PaperQuestion.paper_id == paper.id)
            )
        ).all()
        paper.question_count = len(rows_pq)
        paper.total_score = float(
            sum(
                float(pq.score_override) if pq.score_override is not None else float(qb.default_score or 0)
                for (pq, qb) in rows_pq
            )
        )

    job.committed = True
    job.committed_count = len(inserted_ids)
    job.committed_at = datetime.now()
    await db.flush()
    await db.refresh(job)
    return _job_to_response(job)
