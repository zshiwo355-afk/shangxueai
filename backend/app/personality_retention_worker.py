from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta

from sqlalchemy import delete, select

from .db import session_scope
from .models import PersonalitySubmission


logger = logging.getLogger(__name__)


async def _apply_retention() -> tuple[int, int]:
    now = datetime.now()
    async with session_scope() as session:
        deleted = await session.execute(
            delete(PersonalitySubmission).where(
                PersonalitySubmission.status == "draft",
                PersonalitySubmission.saved_at < now - timedelta(days=7),
            )
        )
        rows = (
            await session.execute(
                select(PersonalitySubmission).where(
                    PersonalitySubmission.status == "submitted",
                    PersonalitySubmission.submitted_at < now - timedelta(days=365),
                    PersonalitySubmission.anonymized_at.is_(None),
                )
            )
        ).scalars().all()
        for row in rows:
            row.respondent_name = ""
            row.respondent_phone = ""
            row.respondent_age = None
            row.respondent_gender = ""
            row.respondent_position = ""
            row.profile_json = "{}"
            row.is_official = False
            row.anonymized_at = now
        return int(deleted.rowcount or 0), len(rows)


async def personality_retention_worker(stop_event: asyncio.Event) -> None:
    while not stop_event.is_set():
        try:
            deleted, anonymized = await _apply_retention()
            if deleted or anonymized:
                logger.info(
                    "personality retention applied: drafts_deleted=%d submissions_anonymized=%d",
                    deleted,
                    anonymized,
                )
        except Exception:  # noqa: BLE001
            logger.exception("personality retention worker failed")
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=6 * 60 * 60)
        except asyncio.TimeoutError:
            continue
