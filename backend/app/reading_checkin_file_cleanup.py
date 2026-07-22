from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path

from sqlalchemy import or_, select, text

from .config import get_settings
from .db import engine, session_scope
from .magic_academy_api._oss import _delete_oss_object
from .magic_academy_api._utils import UPLOAD_ROOT
from .magic_audio_audit import AUDIO_LOG_MEDIA_PURGED, log_audio_upload_event
from .models import MagicAudioUpload

logger = logging.getLogger("app.reading_checkin_file_cleanup")

CLEANUP_POLL_SECONDS = 6 * 60 * 60
CLEANUP_BATCH_SIZE = 200
CLEANUP_LOCK_NAME = "shangxue:reading_checkin_file_cleanup"


@dataclass(slots=True)
class ReadingCheckinCleanupResult:
    scanned: int = 0
    purged: int = 0
    failed: int = 0


def _resolve_local_upload_path(raw_path: str) -> Path | None:
    text_value = (raw_path or "").strip()
    if not text_value:
        return None
    root = UPLOAD_ROOT.resolve()
    candidate = Path(text_value)
    target = candidate.resolve() if candidate.is_absolute() else (root / candidate).resolve()
    try:
        target.relative_to(root)
    except ValueError:
        return None
    return target


def _delete_local_upload(raw_path: str) -> None:
    target = _resolve_local_upload_path(raw_path)
    if target is not None and target.is_file():
        target.unlink()


async def _purge_upload_media(upload_id: int, *, cutoff: datetime, retention_days: int) -> bool:
    async with session_scope() as db:
        row = await db.get(MagicAudioUpload, upload_id)
        if row is None or row.media_purged_at is not None or row.uploaded_on >= cutoff:
            return False

        audio_key = (row.audio_object_key or "").strip()
        image_key = (row.image_object_key or "").strip()
        local_path = (row.file_path or "").strip()
        try:
            for object_key in dict.fromkeys(item for item in (audio_key, image_key) if item):
                await asyncio.to_thread(_delete_oss_object, object_key)
            if local_path:
                await asyncio.to_thread(_delete_local_upload, local_path)
        except Exception:  # noqa: BLE001
            logger.exception("reading check-in media cleanup failed upload_id=%s", upload_id)
            return False

        purged_at = datetime.now()
        await log_audio_upload_event(
            db,
            row,
            action=AUDIO_LOG_MEDIA_PURGED,
            operator_user_id=None,
            operator_role="system",
            reason="retention_expired",
            extra={"retention_days": retention_days, "purged_at": purged_at.isoformat()},
        )
        row.audio_object_key = ""
        row.audio_url = ""
        row.image_object_key = ""
        row.image_url = ""
        row.file_path = ""
        row.media_purged_at = purged_at
        await db.flush()
        return True


async def run_reading_checkin_file_cleanup_once(
    *,
    now: datetime | None = None,
    batch_size: int = CLEANUP_BATCH_SIZE,
) -> ReadingCheckinCleanupResult:
    settings = get_settings()
    retention_days = max(int(settings.reading_checkin_file_retention_days or 30), 1)
    cutoff = (now or datetime.now()) - timedelta(days=retention_days)
    result = ReadingCheckinCleanupResult()

    async with engine.connect() as lock_connection:
        acquired = await lock_connection.scalar(
            text("SELECT GET_LOCK(:lock_name, 0)"),
            {"lock_name": CLEANUP_LOCK_NAME},
        )
        if acquired != 1:
            logger.info("reading check-in cleanup skipped: another worker holds the lock")
            return result
        try:
            async with session_scope() as db:
                upload_ids = (
                    await db.execute(
                        select(MagicAudioUpload.id)
                        .where(
                            MagicAudioUpload.media_purged_at.is_(None),
                            MagicAudioUpload.uploaded_on < cutoff,
                            or_(
                                MagicAudioUpload.audio_object_key != "",
                                MagicAudioUpload.image_object_key != "",
                                MagicAudioUpload.audio_url != "",
                                MagicAudioUpload.image_url != "",
                                MagicAudioUpload.file_path != "",
                            ),
                        )
                        .order_by(MagicAudioUpload.uploaded_on.asc(), MagicAudioUpload.id.asc())
                        .limit(max(int(batch_size or CLEANUP_BATCH_SIZE), 1))
                    )
                ).scalars().all()

            result.scanned = len(upload_ids)
            for raw_id in upload_ids:
                if await _purge_upload_media(
                    int(raw_id),
                    cutoff=cutoff,
                    retention_days=retention_days,
                ):
                    result.purged += 1
                else:
                    result.failed += 1
        finally:
            await lock_connection.execute(
                text("SELECT RELEASE_LOCK(:lock_name)"),
                {"lock_name": CLEANUP_LOCK_NAME},
            )

    logger.info(
        "reading check-in media cleanup finished cutoff=%s scanned=%s purged=%s failed=%s",
        cutoff.isoformat(),
        result.scanned,
        result.purged,
        result.failed,
    )
    return result


async def reading_checkin_file_cleanup_worker(stop_event: asyncio.Event) -> None:
    logger.info(
        "reading_checkin_file_cleanup_worker started, poll every %ss",
        CLEANUP_POLL_SECONDS,
    )
    while not stop_event.is_set():
        try:
            await run_reading_checkin_file_cleanup_once()
        except Exception:  # noqa: BLE001
            logger.exception("reading check-in media cleanup worker failed")

        try:
            await asyncio.wait_for(stop_event.wait(), timeout=CLEANUP_POLL_SECONDS)
        except (TimeoutError, asyncio.TimeoutError):
            continue


__all__ = [
    "ReadingCheckinCleanupResult",
    "reading_checkin_file_cleanup_worker",
    "run_reading_checkin_file_cleanup_once",
]
