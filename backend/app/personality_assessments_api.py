from __future__ import annotations

import hashlib
import json
import re
import secrets
from datetime import datetime
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from .auth import require_admin
from .config import get_settings
from .db import get_db
from .llm import call_llm_json
from .llm_errors import LLMError
from .models import PersonalityForm, PersonalitySubmission, User
from .personality_scoring import (
    build_answer_details,
    get_public_questionnaire,
    get_rules,
    score_assessment,
    validate_partial_answers,
)


admin_router = APIRouter(
    prefix="/api/admin/personality-assessments", tags=["admin-personality-assessments"]
)
public_router = APIRouter(
    prefix="/api/public/personality-forms", tags=["public-personality-assessments"]
)

AI_PROMPT_VERSION = "personality-report-v3"
FIELD_KEY_PATTERN = re.compile(r"^[a-z][a-z0-9_]{0,31}$")


class InfoField(BaseModel):
    key: str = Field(..., min_length=1, max_length=32)
    label: str = Field(..., min_length=1, max_length=40)
    type: Literal["text", "phone", "number", "select"] = "text"
    required: bool = False
    enabled: bool = True
    options: list[str] = Field(default_factory=list, max_length=20)


class FormCreatePayload(BaseModel):
    title: str = Field(..., min_length=1, max_length=255)
    description: str = Field(default="", max_length=2000)
    info_fields: list[InfoField] | None = None


class FormUpdatePayload(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=2000)
    info_fields: list[InfoField] | None = None


class FormStatusPayload(BaseModel):
    status: Literal["active", "disabled"]


class DraftCreatePayload(BaseModel):
    profile: dict[str, Any] = Field(default_factory=dict)


class DraftSavePayload(BaseModel):
    profile: dict[str, Any] | None = None
    answers: dict[str, Any] | None = None


class DraftSubmitPayload(BaseModel):
    profile: dict[str, Any] | None = None
    answers: dict[str, Any]


class AIAnalysisPayload(BaseModel):
    regenerate: bool = False


def _json_load(raw: str | None, fallback: Any) -> Any:
    try:
        return json.loads(raw or "")
    except (TypeError, json.JSONDecodeError):
        return fallback


def _json_dump(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _default_info_fields() -> list[dict[str, Any]]:
    return [
        {"key": "name", "label": "姓名", "type": "text", "required": True, "enabled": True, "options": []},
        {"key": "phone", "label": "手机号码", "type": "phone", "required": True, "enabled": True, "options": []},
        {"key": "age", "label": "年龄", "type": "number", "required": True, "enabled": True, "options": []},
        {"key": "gender", "label": "性别", "type": "select", "required": True, "enabled": True, "options": ["男", "女", "不便透露"]},
        {"key": "position", "label": "应聘岗位", "type": "text", "required": False, "enabled": True, "options": []},
    ]


def _normalize_info_fields(fields: list[InfoField] | None) -> list[dict[str, Any]]:
    raw_fields = fields if fields is not None else [InfoField(**item) for item in _default_info_fields()]
    if len(raw_fields) > 12:
        raise HTTPException(status_code=400, detail="信息字段最多 12 个。")
    normalized: list[dict[str, Any]] = []
    seen: set[str] = set()
    for field in raw_fields:
        key = field.key.strip().lower()
        if not FIELD_KEY_PATTERN.fullmatch(key) or key in seen:
            raise HTTPException(status_code=400, detail=f"信息字段标识无效或重复：{key}")
        label = field.label.strip()
        options = [str(option).strip()[:40] for option in field.options if str(option).strip()]
        if field.type == "select" and not options:
            raise HTTPException(status_code=400, detail=f"“{label}”至少需要一个选项。")
        seen.add(key)
        normalized.append(
            {
                "key": key,
                "label": label,
                "type": field.type,
                "required": bool(field.required),
                "enabled": bool(field.enabled),
                "options": options,
            }
        )
    by_key = {field["key"]: field for field in normalized}
    for key, label, field_type in (("name", "姓名", "text"), ("phone", "手机号码", "phone")):
        field = by_key.get(key)
        if not field:
            field = {
                "key": key,
                "label": label,
                "type": field_type,
                "required": True,
                "enabled": True,
                "options": [],
            }
            normalized.insert(0 if key == "name" else 1, field)
        field.update({"type": field_type, "required": True, "enabled": True})
    return normalized


def _normalize_phone(value: Any) -> str:
    return re.sub(r"[^0-9+]", "", str(value or "").strip())[:32]


def _validate_profile(profile: dict[str, Any], fields: list[dict[str, Any]]) -> dict[str, Any]:
    cleaned: dict[str, Any] = {}
    for field in fields:
        if not field.get("enabled", True):
            continue
        key = field["key"]
        value = profile.get(key)
        if isinstance(value, str):
            value = value.strip()
        if field.get("required") and (value is None or value == ""):
            raise HTTPException(status_code=400, detail=f"请填写{field['label']}。")
        if value is None or value == "":
            cleaned[key] = ""
            continue
        if field["type"] == "number":
            try:
                value = int(value)
            except (TypeError, ValueError) as exc:
                raise HTTPException(status_code=400, detail=f"{field['label']}必须是整数。") from exc
            if key == "age" and not 16 <= value <= 100:
                raise HTTPException(status_code=400, detail="年龄应在 16 至 100 岁之间。")
        elif field["type"] == "phone":
            value = _normalize_phone(value)
            if len(re.sub(r"\D", "", value)) < 6:
                raise HTTPException(status_code=400, detail=f"{field['label']}格式不正确。")
        else:
            value = str(value)[:255]
        if field["type"] == "select" and value not in field["options"]:
            raise HTTPException(status_code=400, detail=f"{field['label']}选项无效。")
        cleaned[key] = value
    return cleaned


def _snapshot(form: PersonalityForm) -> dict[str, Any]:
    return {
        "schema_version": int(form.schema_version),
        "title": form.title,
        "description": form.description or "",
        "info_fields": _json_load(form.info_fields_json, _default_info_fields()),
        "rules_version": form.rules_version,
        "questionnaire": get_public_questionnaire(form.rules_version),
    }


def _form_dict(form: PersonalityForm, submission_count: int = 0) -> dict[str, Any]:
    return {
        "id": int(form.id),
        "title": form.title,
        "description": form.description or "",
        "public_code": form.public_code,
        "public_path": f"/assessment/{form.public_code}",
        "status": form.status,
        "info_fields": _json_load(form.info_fields_json, _default_info_fields()),
        "schema_version": int(form.schema_version),
        "rules_version": form.rules_version,
        "question_count": len(get_rules(form.rules_version)["questions"]),
        "scoring_locked": True,
        "submission_count": int(submission_count),
        "created_at": form.created_at.isoformat() if form.created_at else None,
        "updated_at": form.updated_at.isoformat() if form.updated_at else None,
        "disabled_at": form.disabled_at.isoformat() if form.disabled_at else None,
    }


def _submission_summary(row: PersonalitySubmission) -> dict[str, Any]:
    score = _json_load(row.score_json, {})
    return {
        "id": int(row.id),
        "form_id": int(row.form_id),
        "attempt_no": int(row.attempt_no),
        "status": row.status,
        "name": row.respondent_name or ("已匿名" if row.anonymized_at else ""),
        "phone": row.respondent_phone,
        "position": row.respondent_position,
        "rules_version": score.get("rules_version"),
        "overall_score": score.get("overall_score"),
        "profile_label": score.get("profile_label"),
        "credibility": score.get("credibility"),
        "risk_count": len(score.get("risks") or []),
        "is_official": bool(row.is_official),
        "has_ai_report": bool(row.ai_report_json),
        "duration_seconds": row.duration_seconds,
        "submitted_at": row.submitted_at.isoformat() if row.submitted_at else None,
        "anonymized_at": row.anonymized_at.isoformat() if row.anonymized_at else None,
    }


async def _active_form(db: AsyncSession, public_code: str) -> PersonalityForm:
    result = await db.execute(select(PersonalityForm).where(PersonalityForm.public_code == public_code))
    form = result.scalar_one_or_none()
    if not form:
        raise HTTPException(status_code=404, detail="测评链接不存在。")
    if form.status != "active":
        raise HTTPException(status_code=410, detail="该测评已停止收集答卷。")
    return form


async def _draft(
    db: AsyncSession, form_id: int, token: str
) -> PersonalitySubmission:
    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    result = await db.execute(
        select(PersonalitySubmission).where(
            PersonalitySubmission.form_id == form_id,
            PersonalitySubmission.draft_token_hash == token_hash,
        )
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="续填记录不存在或已过期。")
    return row


@public_router.get("/{public_code}")
async def get_public_form(
    public_code: str,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    form = await _active_form(db, public_code)
    return {"form": _snapshot(form), "public_code": form.public_code}


@public_router.post("/{public_code}/drafts")
async def create_public_draft(
    public_code: str,
    payload: DraftCreatePayload,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    form = await _active_form(db, public_code)
    snapshot = _snapshot(form)
    profile = _validate_profile(payload.profile, snapshot["info_fields"])
    phone = _normalize_phone(profile.get("phone"))
    previous_count = await db.scalar(
        select(func.count(PersonalitySubmission.id)).where(
            PersonalitySubmission.form_id == form.id,
            PersonalitySubmission.respondent_phone == phone,
            PersonalitySubmission.status == "submitted",
        )
    )
    raw_token = secrets.token_urlsafe(32)
    row = PersonalitySubmission(
        form_id=form.id,
        draft_token_hash=hashlib.sha256(raw_token.encode("utf-8")).hexdigest(),
        attempt_no=int(previous_count or 0) + 1,
        status="draft",
        respondent_name=str(profile.get("name") or "")[:128],
        respondent_phone=phone,
        respondent_age=profile.get("age") if isinstance(profile.get("age"), int) else None,
        respondent_gender=str(profile.get("gender") or "")[:16],
        respondent_position=str(profile.get("position") or "")[:128],
        profile_json=_json_dump(profile),
        form_snapshot_json=_json_dump(snapshot),
        answers_json="{}",
    )
    db.add(row)
    await db.flush()
    return {
        "draft_token": raw_token,
        "submission_id": int(row.id),
        "attempt_no": int(row.attempt_no),
        "form": snapshot,
    }


@public_router.get("/{public_code}/drafts/{draft_token}")
async def get_public_draft(
    public_code: str,
    draft_token: str,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    form = await _active_form(db, public_code)
    row = await _draft(db, form.id, draft_token)
    return {
        "submission_id": int(row.id),
        "status": row.status,
        "attempt_no": int(row.attempt_no),
        "profile": _json_load(row.profile_json, {}),
        "answers": _json_load(row.answers_json, {}),
        "form": _json_load(row.form_snapshot_json, _snapshot(form)),
    }


@public_router.put("/{public_code}/drafts/{draft_token}")
async def save_public_draft(
    public_code: str,
    draft_token: str,
    payload: DraftSavePayload,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    form = await _active_form(db, public_code)
    row = await _draft(db, form.id, draft_token)
    if row.status != "draft":
        return {"saved": True, "status": row.status}
    snapshot = _json_load(row.form_snapshot_json, _snapshot(form))
    if payload.profile is not None:
        profile = _validate_profile(payload.profile, snapshot["info_fields"])
        row.profile_json = _json_dump(profile)
        row.respondent_name = str(profile.get("name") or "")[:128]
        row.respondent_phone = _normalize_phone(profile.get("phone"))
        row.respondent_age = profile.get("age") if isinstance(profile.get("age"), int) else None
        row.respondent_gender = str(profile.get("gender") or "")[:16]
        row.respondent_position = str(profile.get("position") or "")[:128]
    if payload.answers is not None:
        try:
            validate_partial_answers(payload.answers, snapshot.get("rules_version", form.rules_version))
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        row.answers_json = _json_dump(payload.answers)
    row.saved_at = datetime.now()
    await db.flush()
    return {"saved": True, "status": "draft", "saved_at": row.saved_at.isoformat()}


@public_router.post("/{public_code}/drafts/{draft_token}/submit")
async def submit_public_draft(
    public_code: str,
    draft_token: str,
    payload: DraftSubmitPayload,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    form = await _active_form(db, public_code)
    row = await _draft(db, form.id, draft_token)
    if row.status == "submitted":
        return {"submitted": True, "submission_id": int(row.id)}
    snapshot = _json_load(row.form_snapshot_json, _snapshot(form))
    if payload.profile is not None:
        profile = _validate_profile(payload.profile, snapshot["info_fields"])
        row.profile_json = _json_dump(profile)
        row.respondent_name = str(profile.get("name") or "")[:128]
        row.respondent_phone = _normalize_phone(profile.get("phone"))
        row.respondent_age = profile.get("age") if isinstance(profile.get("age"), int) else None
        row.respondent_gender = str(profile.get("gender") or "")[:16]
        row.respondent_position = str(profile.get("position") or "")[:128]
    now = datetime.now()
    duration_seconds = max(0, int((now - row.started_at).total_seconds())) if row.started_at else None
    try:
        score = score_assessment(
            payload.answers,
            duration_seconds=duration_seconds,
            version=snapshot.get("rules_version", form.rules_version),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    row.answers_json = _json_dump(payload.answers)
    row.score_json = _json_dump(score)
    row.duration_seconds = duration_seconds
    row.status = "submitted"
    row.submitted_at = now
    row.saved_at = now
    await db.flush()
    return {"submitted": True, "submission_id": int(row.id)}


@admin_router.get("/forms")
async def list_forms(
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> list[dict[str, Any]]:
    del admin
    forms = (await db.execute(select(PersonalityForm).order_by(PersonalityForm.created_at.desc()))).scalars().all()
    count_rows = await db.execute(
        select(PersonalitySubmission.form_id, func.count(PersonalitySubmission.id))
        .where(PersonalitySubmission.status == "submitted")
        .group_by(PersonalitySubmission.form_id)
    )
    counts = {int(form_id): int(count) for form_id, count in count_rows.all()}
    return [_form_dict(form, counts.get(int(form.id), 0)) for form in forms]


@admin_router.get("/questionnaire")
async def get_admin_questionnaire(
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    """Return the locked question bank and scoring metadata for admin review."""
    del admin
    rules = get_rules()
    questions_by_id = {question["id"]: question for question in rules["questions"]}
    question_keys = (
        "id",
        "kind",
        "dimension",
        "direction",
        "weight",
        "prompt",
        "check_type",
        "expected_score",
        "compare_question_id",
        "compare_direction",
        "max_pass_score",
        "response_type",
        "norm_core",
        "options",
        "min_length",
        "max_length",
        "source_marker",
    )
    sections = []
    for section in rules["sections"]:
        sections.append(
            {
                "id": section["id"],
                "title": section["title"],
                "subtitle": section["subtitle"],
                "questions": [
                    {
                        key: questions_by_id[question_id][key]
                        for key in question_keys
                        if key in questions_by_id[question_id]
                    }
                    for question_id in section["question_ids"]
                ],
            }
        )
    return {
        "version": rules["version"],
        "title": rules["title"],
        "question_count": len(rules["questions"]),
        "estimated_minutes": rules["estimated_minutes"],
        "response_instruction": rules["response_instruction"],
        "response_options": rules["response_options"],
        "personality_dimensions": rules["personality_dimensions"],
        "behavior_dimensions": rules["behavior_dimensions"],
        "sections": sections,
        "overall_rule": "本版取消总分；人格展示五维特质与参考样本百分位，11道工作习惯题分组展示六项内部倾向，9道情境题只保留作答证据。",
        "scoring_locked": True,
        "disclaimer": rules["disclaimer"],
    }


@admin_router.post("/forms")
async def create_form(
    payload: FormCreatePayload,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    fields = _normalize_info_fields(payload.info_fields)
    row = PersonalityForm(
        title=payload.title.strip(),
        description=payload.description.strip(),
        public_code=secrets.token_urlsafe(18),
        status="active",
        info_fields_json=_json_dump(fields),
        schema_version=1,
        rules_version=get_rules()["version"],
        created_by=admin.id,
    )
    db.add(row)
    await db.flush()
    await db.refresh(row)
    return _form_dict(row)


@admin_router.get("/forms/{form_id}")
async def get_form(
    form_id: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    del admin
    row = await db.get(PersonalityForm, form_id)
    if not row:
        raise HTTPException(status_code=404, detail="表单不存在。")
    count = await db.scalar(
        select(func.count(PersonalitySubmission.id)).where(
            PersonalitySubmission.form_id == form_id,
            PersonalitySubmission.status == "submitted",
        )
    )
    return _form_dict(row, int(count or 0))


@admin_router.put("/forms/{form_id}")
async def update_form(
    form_id: int,
    payload: FormUpdatePayload,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    del admin
    row = await db.get(PersonalityForm, form_id)
    if not row:
        raise HTTPException(status_code=404, detail="表单不存在。")
    if payload.title is not None:
        row.title = payload.title.strip()
    if "description" in payload.model_fields_set:
        row.description = (payload.description or "").strip()
    if payload.info_fields is not None:
        new_fields = _normalize_info_fields(payload.info_fields)
        encoded = _json_dump(new_fields)
        if encoded != row.info_fields_json:
            row.info_fields_json = encoded
            row.schema_version = int(row.schema_version) + 1
    await db.flush()
    await db.refresh(row)
    return _form_dict(row)


@admin_router.post("/forms/{form_id}/status")
async def set_form_status(
    form_id: int,
    payload: FormStatusPayload,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    del admin
    row = await db.get(PersonalityForm, form_id)
    if not row:
        raise HTTPException(status_code=404, detail="表单不存在。")
    row.status = payload.status
    row.disabled_at = datetime.now() if payload.status == "disabled" else None
    await db.flush()
    await db.refresh(row)
    return _form_dict(row)


@admin_router.post("/forms/{form_id}/duplicate")
async def duplicate_form(
    form_id: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    source = await db.get(PersonalityForm, form_id)
    if not source:
        raise HTTPException(status_code=404, detail="表单不存在。")
    row = PersonalityForm(
        title=f"{source.title}（副本）",
        description=source.description,
        public_code=secrets.token_urlsafe(18),
        status="disabled",
        info_fields_json=source.info_fields_json,
        schema_version=source.schema_version,
        rules_version=source.rules_version,
        created_by=admin.id,
    )
    db.add(row)
    await db.flush()
    await db.refresh(row)
    return _form_dict(row)


@admin_router.get("/forms/{form_id}/submissions")
async def list_submissions(
    form_id: int,
    search: str = Query(default="", max_length=100),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    del admin
    if not await db.get(PersonalityForm, form_id):
        raise HTTPException(status_code=404, detail="表单不存在。")
    filters = [
        PersonalitySubmission.form_id == form_id,
        PersonalitySubmission.status == "submitted",
    ]
    keyword = search.strip()
    if keyword:
        filters.append(
            or_(
                PersonalitySubmission.respondent_name.contains(keyword),
                PersonalitySubmission.respondent_phone.contains(keyword),
                PersonalitySubmission.respondent_position.contains(keyword),
            )
        )
    total = await db.scalar(select(func.count(PersonalitySubmission.id)).where(*filters))
    rows = (
        await db.execute(
            select(PersonalitySubmission)
            .where(*filters)
            .order_by(PersonalitySubmission.submitted_at.desc(), PersonalitySubmission.id.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    ).scalars().all()
    return {
        "items": [_submission_summary(row) for row in rows],
        "total": int(total or 0),
        "page": page,
        "page_size": page_size,
    }


@admin_router.get("/submissions/{submission_id}")
async def get_submission(
    submission_id: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    del admin
    row = await db.get(PersonalitySubmission, submission_id)
    if not row or row.status != "submitted":
        raise HTTPException(status_code=404, detail="答卷不存在。")
    form = await db.get(PersonalityForm, row.form_id)
    answers = _json_load(row.answers_json, {})
    form_snapshot = _json_load(row.form_snapshot_json, {})
    score = _json_load(row.score_json, {})
    answer_details = build_answer_details(
        answers,
        score.get("rules_version")
        or form_snapshot.get("rules_version")
        or (form.rules_version if form else None),
    )
    snapshot_order = [
        question["id"]
        for section in (form_snapshot.get("questionnaire") or {}).get("sections", [])
        for question in section.get("questions", [])
    ]
    if snapshot_order:
        order_index = {question_id: index for index, question_id in enumerate(snapshot_order)}
        answer_details.sort(key=lambda item: order_index.get(item["question_id"], len(order_index)))
    return {
        **_submission_summary(row),
        "form_title": form.title if form else "已删除表单",
        "profile": _json_load(row.profile_json, {}),
        "answers": answers,
        "answer_details": answer_details,
        "score": score,
        "ai_report": _json_load(row.ai_report_json, None),
        "form_snapshot": form_snapshot,
    }


@admin_router.post("/submissions/{submission_id}/mark-official")
async def mark_submission_official(
    submission_id: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    del admin
    row = await db.get(PersonalitySubmission, submission_id)
    if not row or row.status != "submitted":
        raise HTTPException(status_code=404, detail="答卷不存在。")
    if not row.respondent_phone:
        raise HTTPException(status_code=400, detail="匿名答卷不能设为正式记录。")
    await db.execute(
        update(PersonalitySubmission)
        .where(
            PersonalitySubmission.form_id == row.form_id,
            PersonalitySubmission.respondent_phone == row.respondent_phone,
        )
        .values(is_official=False)
    )
    row.is_official = True
    await db.flush()
    return {"updated": True, "submission_id": int(row.id)}


def _string_list(value: Any, limit: int) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item).strip()[:500] for item in value if str(item).strip()][:limit]


@admin_router.post("/submissions/{submission_id}/ai-analysis")
async def generate_ai_analysis(
    submission_id: int,
    payload: AIAnalysisPayload,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    del admin
    row = await db.get(PersonalitySubmission, submission_id)
    if not row or row.status != "submitted":
        raise HTTPException(status_code=404, detail="答卷不存在。")
    if row.ai_report_json and not payload.regenerate:
        return _json_load(row.ai_report_json, {})
    score = _json_load(row.score_json, {})
    system = (
        "你是企业面试辅助分析员。只能基于系统提供的确定性结果与匿名开放题进行解释，不能重新计分，"
        "不能作心理诊断，不能给出录用或淘汰结论。不要猜测姓名、性别、年龄、电话等个人信息。"
        "输出合法 JSON，字段固定为 overall_summary、strengths、verification_points、interview_questions。"
        "strengths 必须3条，verification_points 必须3条，interview_questions 必须5条，后三项均为字符串数组。"
    )
    safe_payload = {
        "overall_basis": score.get("overall_basis"),
        "profile_label": score.get("profile_label"),
        "personality_scores": score.get("personality_scores"),
        "personality_context_scores": score.get("personality_context_scores"),
        "norm_percentiles": score.get("norm_percentiles"),
        "norm_reference": score.get("norm_reference"),
        "behavior_scores": score.get("behavior_scores"),
        "behavior_bands": score.get("behavior_bands"),
        "workplace_choices": score.get("workplace_choices"),
        "credibility": score.get("credibility"),
        "interview_signals": score.get("risks"),
        "open_responses": score.get("open_responses"),
        "disclaimer": score.get("disclaimer"),
    }
    try:
        result = await call_llm_json(
            get_settings(),
            [{"role": "user", "content": _json_dump(safe_payload)}],
            system=system,
            temperature=0.2,
            max_tokens=1600,
        )
    except LLMError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc
    strengths = _string_list(result.get("strengths"), 3)
    verification_points = _string_list(result.get("verification_points"), 3)
    interview_questions = _string_list(result.get("interview_questions"), 5)
    if len(strengths) != 3 or len(verification_points) != 3 or len(interview_questions) != 5:
        raise HTTPException(status_code=502, detail="AI 分析结构不完整，请重试。")
    report = {
        "overall_summary": str(result.get("overall_summary") or "").strip()[:1200],
        "strengths": strengths,
        "verification_points": verification_points,
        "interview_questions": interview_questions,
        "prompt_version": AI_PROMPT_VERSION,
        "generated_at": datetime.now().isoformat(),
    }
    row.ai_report_json = _json_dump(report)
    row.ai_prompt_version = AI_PROMPT_VERSION
    row.ai_generated_at = datetime.now()
    await db.flush()
    return report


@admin_router.post("/submissions/{submission_id}/anonymize")
async def anonymize_submission(
    submission_id: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    del admin
    row = await db.get(PersonalitySubmission, submission_id)
    if not row:
        raise HTTPException(status_code=404, detail="答卷不存在。")
    row.respondent_name = ""
    row.respondent_phone = ""
    row.respondent_age = None
    row.respondent_gender = ""
    row.respondent_position = ""
    row.profile_json = "{}"
    row.is_official = False
    row.anonymized_at = datetime.now()
    await db.flush()
    return {"anonymized": True, "submission_id": int(row.id)}
