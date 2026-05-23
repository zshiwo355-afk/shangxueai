from __future__ import annotations

import mimetypes
from datetime import date, timedelta
from pathlib import Path
from typing import Any

from fastapi import Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..access import get_user_whitelist_permissions
from ..auth import get_current_user, require_admin
from ..db import get_db
from ..magic_academy_schemas import (
    AudioMakeupPayload,
    AudioMakeupSettingPayload,
    MagicAudioUploadPayload,
)
from ..models import MagicAudioMakeupSetting, MagicAudioUpload, User
from . import router
from ._utils import (
    AUDIO_EXTENSIONS,
    DEFAULT_AUDIO_MAKEUP_DAYS,
    MAX_AUDIO_SIZE,
    SOURCE_AUDIO_MAKEUP,
    SOURCE_AUDIO_USER_UPLOAD,
    SOURCE_WHITELIST_AUTO,
    _iso,
    _month_last_day,
    _now,
    _parse_month,
    _safe_filename,
    _user_name,
    _expected_days,
    _xlsx_response,
)
from ._video_helpers import _ensure_auto_audio_checkin


def _serialize_audio_record(item: MagicAudioUpload, user_map: dict[int, User] | None = None) -> dict[str, Any]:
    owner = user_map.get(item.user_id) if user_map else None
    source = item.source or SOURCE_AUDIO_USER_UPLOAD
    source_label = (
        "补卡" if source == SOURCE_AUDIO_MAKEUP
        else "白名单自动打卡" if source == SOURCE_WHITELIST_AUTO
        else "用户上传"
    )
    return {
        "id": item.id,
        "user_id": item.user_id,
        "user_name": _user_name(owner) if owner else "",
        "department": (owner.department or "") if owner else "",
        "file_name": item.file_name or "",
        "file_size": int(item.file_size or 0),
        "file_type": item.mime_type or "",
        "remark": item.remark or "",
        "uploaded_date": _iso(item.uploaded_date),
        "uploaded_time": _iso(item.uploaded_on),
        "status": "已上传",
        "source": source,
        "source_label": source_label,
        "is_makeup": source == SOURCE_AUDIO_MAKEUP,
        "auto_checkin_by_whitelist": bool(item.auto_checkin_by_whitelist),
    }


def _build_audio_calendar_payload(
    month_start: date,
    month_last_day_value: date,
    uploads: list[MagicAudioUpload],
    user_map: dict[int, User] | None = None,
    aggregate_users: bool = False,
) -> list[dict[str, Any]]:
    grouped: dict[str, list[MagicAudioUpload]] = {}
    for item in uploads:
        key = item.uploaded_date.isoformat() if item.uploaded_date else None
        if not key:
            continue
        grouped.setdefault(key, []).append(item)
    today = date.today().isoformat()
    days: list[dict[str, Any]] = []
    cursor = month_start
    while cursor <= month_last_day_value:
        key = cursor.isoformat()
        items = grouped.get(key, [])
        uploaded_users = sorted({item.user_id for item in items})
        days.append({
            "date": key,
            "is_today": key == today,
            "is_future": key > today,
            "uploaded": bool(items),
            "count": len(items),
            "uploaded_user_count": len(uploaded_users),
            "records": [_serialize_audio_record(item, user_map) for item in items],
            "user_ids": uploaded_users if aggregate_users else [],
        })
        cursor += timedelta(days=1)
    return days


def _serialize_audio_makeup_setting(row: MagicAudioMakeupSetting | None) -> dict[str, Any]:
    return {
        "enabled": bool(row.enabled) if row else False,
        "make_up_days": int(row.make_up_days or 0) if row else DEFAULT_AUDIO_MAKEUP_DAYS,
        "description": (
            f"仅允许补最近 {int(row.make_up_days or 0)} 天内未完成的读书打卡"
            if row and bool(row.enabled) and int(row.make_up_days or 0) > 0
            else "当前未开启补卡"
        ),
    }


async def _get_audio_makeup_setting(
    db: AsyncSession,
    *,
    create: bool = False,
) -> MagicAudioMakeupSetting | None:
    result = await db.execute(
        select(MagicAudioMakeupSetting).order_by(MagicAudioMakeupSetting.id.asc()).limit(1)
    )
    row = result.scalar_one_or_none()
    if row or not create:
        return row
    row = MagicAudioMakeupSetting(enabled=False, make_up_days=DEFAULT_AUDIO_MAKEUP_DAYS)
    db.add(row)
    await db.flush()
    await db.refresh(row)
    return row


async def _has_audio_checkin_on_date(
    db: AsyncSession,
    user_id: int,
    target_date: date,
) -> bool:
    result = await db.execute(
        select(MagicAudioUpload.id).where(
            MagicAudioUpload.user_id == user_id,
            MagicAudioUpload.is_deleted.is_(False),
            MagicAudioUpload.uploaded_date == target_date,
        )
    )
    return result.scalar_one_or_none() is not None


def _evaluate_audio_makeup_date(
    target_date: date,
    *,
    today: date,
    setting: MagicAudioMakeupSetting | None,
    has_record: bool,
) -> tuple[bool, str]:
    if target_date > today:
        return False, "不能补未来日期。"
    if target_date == today:
        return False, "今日打卡请直接走正常打卡流程。"
    if not setting or not setting.enabled or int(setting.make_up_days or 0) <= 0:
        return False, "当前未开启补卡。"
    if has_record:
        return False, "该日期已完成打卡。"
    delta_days = (today - target_date).days
    if delta_days <= 0:
        return False, "不能补未来日期。"
    if delta_days > int(setting.make_up_days or 0):
        return False, "补卡时间已过期。"
    return True, ""


@router.get("/my/audios")
async def list_my_audios(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[dict[str, Any]]:
    whitelist_permissions = await get_user_whitelist_permissions(db, user.id)
    await _ensure_auto_audio_checkin(db, user, whitelist_permissions)
    result = await db.execute(
        select(MagicAudioUpload)
        .where(MagicAudioUpload.user_id == user.id, MagicAudioUpload.is_deleted.is_(False))
        .order_by(desc(MagicAudioUpload.uploaded_on))
    )
    return [_serialize_audio_record(item) for item in result.scalars().all()]


@router.get("/admin/audio-makeup-setting")
async def get_audio_makeup_setting(
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    del admin
    row = await _get_audio_makeup_setting(db)
    return _serialize_audio_makeup_setting(row)


@router.put("/admin/audio-makeup-setting")
async def update_audio_makeup_setting(
    payload: AudioMakeupSettingPayload,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    row = await _get_audio_makeup_setting(db, create=True)
    if not row:
        raise HTTPException(status_code=500, detail="补卡设置初始化失败。")
    row.enabled = payload.enabled
    row.make_up_days = int(payload.make_up_days or 0)
    row.updated_by = admin.id
    await db.flush()
    await db.refresh(row)
    return _serialize_audio_makeup_setting(row)


@router.get("/my/audios/makeup-options")
async def get_my_audio_makeup_options(
    month: str | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    whitelist_permissions = await get_user_whitelist_permissions(db, user.id)
    await _ensure_auto_audio_checkin(db, user, whitelist_permissions)
    setting = await _get_audio_makeup_setting(db)
    month_start, _ = _parse_month(month)
    month_last_day_value = _month_last_day(month_start)
    result = await db.execute(
        select(MagicAudioUpload)
        .where(
            MagicAudioUpload.user_id == user.id,
            MagicAudioUpload.is_deleted.is_(False),
            MagicAudioUpload.uploaded_date >= month_start,
            MagicAudioUpload.uploaded_date <= month_last_day_value,
        )
        .order_by(MagicAudioUpload.uploaded_on.asc())
    )
    uploads = result.scalars().all()
    uploaded_dates = {item.uploaded_date for item in uploads if item.uploaded_date}
    today = date.today()
    days = []
    cursor = month_start
    while cursor <= month_last_day_value:
        can_makeup, reason = _evaluate_audio_makeup_date(
            cursor,
            today=today,
            setting=setting,
            has_record=cursor in uploaded_dates,
        )
        days.append({
            "date": cursor.isoformat(),
            "can_makeup": can_makeup,
            "reason": reason,
            "has_record": cursor in uploaded_dates,
            "is_future": cursor > today,
            "is_expired": bool(reason == "补卡时间已过期。"),
        })
        cursor += timedelta(days=1)
    return {
        "month": month_start.strftime("%Y-%m"),
        "setting": _serialize_audio_makeup_setting(setting),
        "days": days,
    }


@router.post("/my/audios")
async def upload_my_audio(
    payload: MagicAudioUploadPayload,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    suffix = Path(payload.file_name or "").suffix.lower()
    if suffix not in AUDIO_EXTENSIONS:
        raise HTTPException(status_code=400, detail="音频格式不支持。")
    if int(payload.file_size or 0) > MAX_AUDIO_SIZE:
        raise HTTPException(status_code=400, detail="单个录音文件不能超过 50MB。")
    safe_name = _safe_filename(payload.file_name or f"audio{suffix}")
    now = _now()
    row = MagicAudioUpload(
        user_id=user.id,
        file_name=safe_name,
        file_path="",
        file_size=int(payload.file_size or 0),
        mime_type=(payload.mime_type or mimetypes.guess_type(safe_name)[0] or suffix.lstrip(".")).strip(),
        remark=(payload.remark or "").strip(),
        source=SOURCE_AUDIO_USER_UPLOAD,
        auto_checkin_by_whitelist=False,
        uploaded_on=now,
        uploaded_date=now.date(),
        is_deleted=False,
    )
    db.add(row)
    await db.flush()
    return {
        "id": row.id,
        "file_name": row.file_name,
        "file_size": int(row.file_size or 0),
        "file_type": row.mime_type,
        "remark": row.remark or "",
        "uploaded_date": _iso(row.uploaded_date),
        "uploaded_time": _iso(row.uploaded_on),
        "status": "已上传",
        "source": SOURCE_AUDIO_USER_UPLOAD,
        "source_label": "用户上传",
    }


@router.post("/my/audios/makeup")
async def submit_my_audio_makeup(
    payload: AudioMakeupPayload,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    suffix = Path(payload.file_name or "").suffix.lower()
    if suffix not in AUDIO_EXTENSIONS:
        raise HTTPException(status_code=400, detail="音频格式不支持。")
    if int(payload.file_size or 0) > MAX_AUDIO_SIZE:
        raise HTTPException(status_code=400, detail="单个录音文件不能超过 50MB。")
    whitelist_permissions = await get_user_whitelist_permissions(db, user.id)
    await _ensure_auto_audio_checkin(db, user, whitelist_permissions)
    today = date.today()
    target_date = payload.makeup_date
    setting = await _get_audio_makeup_setting(db)
    has_record = await _has_audio_checkin_on_date(db, user.id, target_date)
    can_makeup, reason = _evaluate_audio_makeup_date(
        target_date,
        today=today,
        setting=setting,
        has_record=has_record,
    )
    if not can_makeup:
        raise HTTPException(status_code=400, detail=reason)
    safe_name = _safe_filename(payload.file_name or f"audio{suffix}")
    row = MagicAudioUpload(
        user_id=user.id,
        file_name=safe_name,
        file_path="",
        file_size=int(payload.file_size or 0),
        mime_type=(payload.mime_type or mimetypes.guess_type(safe_name)[0] or suffix.lstrip(".")).strip(),
        remark=(payload.remark or "").strip(),
        source=SOURCE_AUDIO_MAKEUP,
        auto_checkin_by_whitelist=False,
        uploaded_on=_now(),
        uploaded_date=target_date,
        is_deleted=False,
    )
    db.add(row)
    await db.flush()
    await db.refresh(row)
    return _serialize_audio_record(row)


@router.delete("/my/audios/{audio_id}")
async def delete_my_audio(
    audio_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, bool]:
    row = await db.get(MagicAudioUpload, audio_id)
    if not row or row.user_id != user.id:
        raise HTTPException(status_code=404, detail="录音不存在。")
    row.is_deleted = True
    row.deleted_at = _now()
    await db.flush()
    return {"success": True}


@router.get("/my/audios/calendar")
async def get_my_audio_calendar(
    month: str | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    whitelist_permissions = await get_user_whitelist_permissions(db, user.id)
    await _ensure_auto_audio_checkin(db, user, whitelist_permissions)
    month_start, _ = _parse_month(month)
    month_last_day_value = _month_last_day(month_start)
    result = await db.execute(
        select(MagicAudioUpload)
        .where(
            MagicAudioUpload.user_id == user.id,
            MagicAudioUpload.is_deleted.is_(False),
            MagicAudioUpload.uploaded_date >= month_start,
            MagicAudioUpload.uploaded_date <= month_last_day_value,
        )
        .order_by(MagicAudioUpload.uploaded_on.asc())
    )
    uploads = result.scalars().all()
    return {
        "month": month_start.strftime("%Y-%m"),
        "days": _build_audio_calendar_payload(month_start, month_last_day_value, uploads),
    }


async def _build_audio_stats(
    db: AsyncSession,
    month_text: str | None,
    department: str | None,
    user_id: int | None,
) -> list[dict[str, Any]]:
    month_start, month_end = _parse_month(month_text)
    expected = _expected_days(month_start, month_end)
    user_stmt = select(User).where(User.role == "user", User.disabled.is_(False))
    if department:
        user_stmt = user_stmt.where(User.department == department)
    if user_id:
        user_stmt = user_stmt.where(User.id == user_id)
    user_stmt = user_stmt.order_by(User.id.asc())
    user_result = await db.execute(user_stmt)
    users = user_result.scalars().all()
    if not users:
        return []
    user_ids = [item.id for item in users]
    upload_result = await db.execute(
        select(MagicAudioUpload)
        .where(
            MagicAudioUpload.user_id.in_(user_ids),
            MagicAudioUpload.is_deleted.is_(False),
            MagicAudioUpload.uploaded_date >= month_start,
            MagicAudioUpload.uploaded_date <= month_end,
        )
        .order_by(MagicAudioUpload.uploaded_on.asc())
    )
    uploads = upload_result.scalars().all()
    grouped: dict[int, list[MagicAudioUpload]] = {}
    for item in uploads:
        grouped.setdefault(item.user_id, []).append(item)
    rows = []
    for target in users:
        items = grouped.get(target.id, [])
        upload_days = {item.uploaded_date.isoformat() for item in items if item.uploaded_date}
        upload_count = len(items)
        makeup_count = sum(1 for item in items if (item.source or "") == SOURCE_AUDIO_MAKEUP)
        missing = max(expected - len(upload_days), 0)
        rows.append({
            "user_id": target.id,
            "name": _user_name(target),
            "department": target.department or "",
            "month": month_start.strftime("%Y-%m"),
            "expected_upload_days": expected,
            "actual_upload_days": len(upload_days),
            "actual_upload_count": upload_count,
            "makeup_count": makeup_count,
            "missing_count": missing,
            "upload_rate": round((len(upload_days) / expected) * 100, 2) if expected > 0 else 0,
            "last_upload_time": _iso(items[-1].uploaded_on) if items else None,
        })
    return rows


@router.get("/admin/audio-stats")
async def get_audio_stats(
    month: str | None = None,
    department: str | None = None,
    user_id: int | None = None,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> list[dict[str, Any]]:
    del admin
    return await _build_audio_stats(db, month, department, user_id)


@router.get("/admin/audios/calendar")
async def get_admin_audio_calendar(
    month: str | None = None,
    department: str | None = None,
    user_id: int | None = None,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    del admin
    month_start, _ = _parse_month(month)
    month_last_day_value = _month_last_day(month_start)
    user_stmt = select(User).where(User.role == "user", User.disabled.is_(False))
    if department:
        user_stmt = user_stmt.where(User.department == department)
    if user_id:
        user_stmt = user_stmt.where(User.id == user_id)
    user_stmt = user_stmt.order_by(User.id.asc())
    user_result = await db.execute(user_stmt)
    users = user_result.scalars().all()
    user_map = {item.id: item for item in users}
    user_ids = list(user_map)
    uploads: list[MagicAudioUpload] = []
    if user_ids:
        upload_result = await db.execute(
            select(MagicAudioUpload)
            .where(
                MagicAudioUpload.user_id.in_(user_ids),
                MagicAudioUpload.is_deleted.is_(False),
                MagicAudioUpload.uploaded_date >= month_start,
                MagicAudioUpload.uploaded_date <= month_last_day_value,
            )
            .order_by(MagicAudioUpload.uploaded_on.asc())
        )
        uploads = upload_result.scalars().all()
    return {
        "month": month_start.strftime("%Y-%m"),
        "user_id": user_id,
        "department": department or "",
        "scope": "user" if user_id else "all",
        "days": _build_audio_calendar_payload(month_start, month_last_day_value, uploads, user_map, aggregate_users=not user_id),
    }


@router.get("/admin/audio-stats/export")
async def export_audio_stats(
    month: str | None = None,
    department: str | None = None,
    user_id: int | None = None,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> StreamingResponse:
    del admin
    rows = await _build_audio_stats(db, month, department, user_id)
    export_rows = [
        [
            item["name"],
            item["department"],
            item["month"],
            item["expected_upload_days"],
            item["actual_upload_days"],
            item["actual_upload_count"],
            item["missing_count"],
            item["upload_rate"],
            item["last_upload_time"] or "",
        ]
        for item in rows
    ]
    return _xlsx_response(
        f"magic_audio_stats_{month or date.today().strftime('%Y-%m')}.xlsx",
        ["姓名", "部门", "月份", "应上传天数", "实际上传天数", "实际上传次数", "缺少次数", "上传率", "最后上传时间"],
        export_rows,
    )
