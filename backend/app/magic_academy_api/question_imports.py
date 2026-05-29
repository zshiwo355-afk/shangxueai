from __future__ import annotations

import json
from datetime import datetime
from typing import Any

from fastapi import Depends, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import require_admin
from ..db import get_db
from ..models import MagicQuestion, MagicVideoQuizPoint, QuestionImportJob, User
from ..paper_importers import (
    ParsedRow,
    build_docx_template,
    build_excel_template,
    parse_docx,
    parse_excel,
    rows_from_json,
    rows_to_json,
    validate_row,
)
from . import router
from ._utils import _json_dumps
from ._video_helpers import _bump_video_quiz_version

MAX_IMPORT_FILE_SIZE = 20 * 1024 * 1024
ALLOWED_VIDEO_IMPORT_TYPES = {"single", "multiple", "judge", "blank"}


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


async def _read_upload_with_limit(file: UploadFile, *, limit: int = MAX_IMPORT_FILE_SIZE) -> bytes:
    try:
      file.file.seek(0, 2)
      size = file.file.tell()
      file.file.seek(0)
      if size > limit:
          raise HTTPException(status_code=413, detail="上传文件不能超过 20MB。")
    except HTTPException:
      raise
    except (AttributeError, OSError):
      await file.seek(0)
    content = await file.read(limit + 1)
    if len(content) > limit:
      raise HTTPException(status_code=413, detail="上传文件不能超过 20MB。")
    return content


def _filter_video_rows(rows: list[ParsedRow]) -> list[ParsedRow]:
    filtered: list[ParsedRow] = []
    for row in rows:
        next_row = ParsedRow(
            idx=row.idx,
            ok=row.ok,
            data=dict(row.data or {}) if row.data else None,
            errors=list(row.errors or []),
            raw=dict(row.raw or {}) if row.raw else None,
        )
        qtype = str((next_row.data or {}).get("question_type") or "").strip().lower()
        if qtype and qtype not in ALLOWED_VIDEO_IMPORT_TYPES:
            next_row.ok = False
            next_row.errors.append("视频答题仅支持单选、多选、判断、填空题，暂不支持简答题。")
        filtered.append(next_row)
    return filtered


def _summarize(rows: list[ParsedRow]) -> tuple[int, int, int]:
    total = len(rows)
    valid = sum(1 for row in rows if row.ok)
    invalid = total - valid
    return total, valid, invalid


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


async def _get_quiz_point_or_404(db: AsyncSession, point_id: int) -> MagicVideoQuizPoint:
    point = await db.get(MagicVideoQuizPoint, point_id)
    if not point:
        raise HTTPException(status_code=404, detail="答题节点不存在。")
    return point


@router.get("/quiz-imports/template")
async def download_video_quiz_import_template(
    fmt: str = "xlsx",
    admin: User = Depends(require_admin),
):
    del admin
    safe_fmt = (fmt or "xlsx").lower()
    if safe_fmt == "xlsx":
        data = build_excel_template()
        media_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        filename = "magic_video_quiz_template.xlsx"
    elif safe_fmt == "docx":
        try:
            data = build_docx_template()
        except RuntimeError as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc
        media_type = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        filename = "magic_video_quiz_template.docx"
    else:
        raise HTTPException(status_code=400, detail="模板格式仅支持 xlsx / docx。")

    def _iter():
        yield data

    headers = {"Content-Disposition": f'attachment; filename="{filename}"'}
    return StreamingResponse(_iter(), media_type=media_type, headers=headers)


@router.post("/quiz-points/{point_id}/import/upload", response_model=JobResponse)
async def upload_video_quiz_import_file(
    point_id: int,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> JobResponse:
    await _get_quiz_point_or_404(db, point_id)
    filename = file.filename or ""
    suffix = filename.lower().rsplit(".", 1)[-1] if "." in filename else ""
    content = await _read_upload_with_limit(file)

    if suffix in {"xlsx", "xls"}:
        rows = parse_excel(content)
        source = "excel"
    elif suffix == "docx":
        try:
            rows = parse_docx(content)
        except RuntimeError as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc
        source = "docx"
    else:
        raise HTTPException(status_code=400, detail="仅支持 .xlsx / .docx 格式。")

    filtered_rows = _filter_video_rows(rows)
    total, valid, invalid = _summarize(filtered_rows)

    job = QuestionImportJob(
        created_by=admin.id,
        source=source,
        original_name=filename,
        total_rows=total,
        valid_rows=valid,
        invalid_rows=invalid,
        rows_json=rows_to_json(filtered_rows),
        committed=False,
        committed_count=0,
    )
    db.add(job)
    await db.flush()
    await db.refresh(job)
    return _job_to_response(job)


@router.get("/quiz-imports/{job_id}", response_model=JobResponse)
async def get_video_quiz_import_job(
    job_id: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> JobResponse:
    job = (
        await db.execute(
            select(QuestionImportJob).where(
                QuestionImportJob.id == job_id,
                QuestionImportJob.created_by == admin.id,
            )
        )
    ).scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="导入任务不存在。")
    return _job_to_response(job)


@router.put("/quiz-imports/{job_id}/rows/{row_idx}", response_model=JobResponse)
async def update_video_quiz_import_row(
    job_id: int,
    row_idx: int,
    payload: UpdateRowPayload,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> JobResponse:
    job = (
        await db.execute(
            select(QuestionImportJob).where(
                QuestionImportJob.id == job_id,
                QuestionImportJob.created_by == admin.id,
            )
        )
    ).scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="导入任务不存在。")
    if job.committed:
        raise HTTPException(status_code=400, detail="任务已提交，无法编辑。")

    rows = rows_from_json(job.rows_json)
    target = next((row for row in rows if row.idx == row_idx), None)
    if target is None:
        raise HTTPException(status_code=404, detail=f"第 {row_idx} 行不存在。")

    ok, errors, normalized = validate_row(payload.data)
    qtype = str((normalized or {}).get("question_type") or "").strip().lower()
    if qtype and qtype not in ALLOWED_VIDEO_IMPORT_TYPES:
        ok = False
        errors = list(errors) + ["视频答题仅支持单选、多选、判断、填空题，暂不支持简答题。"]
    target.ok = ok
    target.errors = errors
    target.data = normalized
    target.raw = payload.data

    filtered_rows = _filter_video_rows(rows)
    job.rows_json = rows_to_json(filtered_rows)
    job.total_rows, job.valid_rows, job.invalid_rows = _summarize(filtered_rows)
    await db.flush()
    await db.refresh(job)
    return _job_to_response(job)


@router.post("/quiz-points/{point_id}/import-jobs/{job_id}/commit", response_model=JobResponse)
async def commit_video_quiz_import_job(
    point_id: int,
    job_id: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> JobResponse:
    point = await _get_quiz_point_or_404(db, point_id)
    job = (
        await db.execute(
            select(QuestionImportJob).where(
                QuestionImportJob.id == job_id,
                QuestionImportJob.created_by == admin.id,
            )
        )
    ).scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="导入任务不存在。")
    if job.committed:
        raise HTTPException(status_code=400, detail="任务已提交，请勿重复操作。")

    rows = _filter_video_rows(rows_from_json(job.rows_json))
    valid_rows = [row for row in rows if row.ok and row.data]
    if not valid_rows:
        raise HTTPException(status_code=400, detail="没有可导入的合法题目。")

    current_max = await db.execute(
        select(func.coalesce(func.max(MagicQuestion.sort_order), 0)).where(MagicQuestion.quiz_point_id == point_id)
    )
    next_sort_order = int(current_max.scalar_one() or 0) + 10

    for row in valid_rows:
        data = row.data or {}
        question = MagicQuestion(
            quiz_point_id=point_id,
            question_type=data.get("question_type", ""),
            stem=data.get("stem", ""),
            options_json=_json_dumps(data.get("options", [])),
            correct_answer_json=_json_dumps(data.get("correct_answer", [])),
            score=float(data.get("default_score", 5) or 5),
            sort_order=next_sort_order,
            is_required=True,
        )
        db.add(question)
        next_sort_order += 10

    await db.flush()
    question_count = await db.execute(select(func.count(MagicQuestion.id)).where(MagicQuestion.quiz_point_id == point_id))
    point.question_count = int(question_count.scalar_one() or 0)
    await db.flush()
    await _bump_video_quiz_version(db, point.video_id)

    job.rows_json = rows_to_json(rows)
    job.total_rows, job.valid_rows, job.invalid_rows = _summarize(rows)
    job.committed = True
    job.committed_count = len(valid_rows)
    job.committed_at = datetime.now()
    await db.flush()
    await db.refresh(job)
    return _job_to_response(job)
