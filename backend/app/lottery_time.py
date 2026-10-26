"""Serialize lottery timestamps according to their actual write clock.

The deployed MySQL session uses Asia/Shanghai for CURRENT_TIMESTAMP. Application
deadlines, draw times and fulfilled_at are written in UTC and must not use this
formatter. No stored values are rewritten by this presentation-only conversion.
"""
from datetime import datetime, timedelta, timezone

from .config import get_settings


def format_db_timestamp(value: datetime | None, *, offset: str | None = None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        configured = offset or get_settings().lottery_db_timestamp_offset
        hours, minutes = map(int, configured[1:].split(":"))
        delta = timedelta(hours=hours, minutes=minutes)
        if configured.startswith("-"):
            delta = -delta
        value = value.replace(tzinfo=timezone(delta))
    return value.isoformat(timespec="seconds").replace("+00:00", "Z")
