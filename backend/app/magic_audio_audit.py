from __future__ import annotations

import json
from datetime import datetime
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from .models import MagicAudioUpload, MagicAudioUploadLog, User

AUDIO_LOG_UPLOAD_COMPLETED = "upload_completed"
AUDIO_LOG_UPLOAD_FAILED = "upload_failed"
AUDIO_LOG_MANUAL_DELETE = "manual_delete"
AUDIO_LOG_SYSTEM_DELETE = "system_delete"


def _now() -> datetime:
    return datetime.now()


def _json_default(value: Any) -> str:
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value)


def _snapshot_upload(row: MagicAudioUpload) -> dict[str, Any]:
    return {
        "id": int(row.id) if row.id else None,
        "user_id": int(row.user_id) if row.user_id else None,
        "reading_content_id": int(row.reading_content_id) if row.reading_content_id else None,
        "file_name": row.file_name or "",
        "file_path": row.file_path or "",
        "file_size": int(row.file_size or 0),
        "mime_type": row.mime_type or "",
        "audio_object_key": row.audio_object_key or "",
        "audio_url": row.audio_url or "",
        "image_object_key": row.image_object_key or "",
        "image_url": row.image_url or "",
        "image_file_name": row.image_file_name or "",
        "image_mime_type": row.image_mime_type or "",
        "image_size": int(row.image_size or 0),
        "remark": row.remark or "",
        "source": row.source or "",
        "auto_checkin_by_whitelist": bool(row.auto_checkin_by_whitelist),
        "uploaded_date": row.uploaded_date.isoformat() if row.uploaded_date else None,
        "uploaded_on": row.uploaded_on.isoformat() if row.uploaded_on else None,
        "is_deleted": bool(row.is_deleted),
        "deleted_at": row.deleted_at.isoformat() if row.deleted_at else None,
    }


async def log_audio_upload_event(
    db: AsyncSession,
    row: MagicAudioUpload,
    *,
    action: str,
    operator: User | None = None,
    operator_user_id: int | None = None,
    operator_role: str = "",
    reason: str = "",
    extra: dict[str, Any] | None = None,
) -> MagicAudioUploadLog:
    if operator is not None:
        operator_user_id = int(operator.id)
        operator_role = operator.role or operator_role
    snapshot = _snapshot_upload(row)
    if extra:
        snapshot["extra"] = extra
    log = MagicAudioUploadLog(
        audio_upload_id=int(row.id) if row.id else None,
        user_id=int(row.user_id) if row.user_id else None,
        reading_content_id=int(row.reading_content_id) if row.reading_content_id else None,
        action=action,
        source=row.source or "",
        operator_user_id=operator_user_id,
        operator_role=operator_role or "",
        reason=(reason or "")[:255],
        has_audio=bool((row.audio_object_key or "").strip()),
        has_image=bool((row.image_object_key or "").strip()),
        file_name=row.file_name or "",
        file_size=int(row.file_size or 0),
        mime_type=row.mime_type or "",
        audio_object_key=row.audio_object_key or "",
        image_object_key=row.image_object_key or "",
        image_file_name=row.image_file_name or "",
        image_size=int(row.image_size or 0),
        uploaded_date=row.uploaded_date,
        uploaded_on=row.uploaded_on,
        deleted_at=row.deleted_at,
        snapshot_json=json.dumps(snapshot, ensure_ascii=False, default=_json_default),
        created_at=_now(),
    )
    db.add(log)
    await db.flush()
    return log


async def log_audio_upload_failure(
    db: AsyncSession,
    *,
    user: User,
    oss_object_key: str,
    upload_id: str,
    reason: str = "",
) -> MagicAudioUploadLog:
    snapshot = {
        "oss_object_key": oss_object_key,
        "upload_id": upload_id,
        "reason": reason,
    }
    log = MagicAudioUploadLog(
        audio_upload_id=None,
        user_id=int(user.id),
        reading_content_id=None,
        action=AUDIO_LOG_UPLOAD_FAILED,
        source="",
        operator_user_id=int(user.id),
        operator_role=user.role or "",
        reason=(reason or "upload failed")[:255],
        has_audio=bool((oss_object_key or "").strip()),
        audio_object_key=oss_object_key or "",
        snapshot_json=json.dumps(snapshot, ensure_ascii=False, default=_json_default),
        created_at=_now(),
    )
    db.add(log)
    await db.flush()
    return log
