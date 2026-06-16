from __future__ import annotations

from datetime import datetime
from typing import Any

LIVE_STATUSES = {"draft", "scheduled", "live", "replay", "ended", "disabled", "published"}
PUBLIC_STATUSES = {"scheduled", "live", "replay", "ended"}

STATUS_LABELS = {
    "draft": "草稿",
    "scheduled": "预约中",
    "live": "直播中",
    "replay": "回放中",
    "ended": "已结束",
    "disabled": "已下架",
}


def normalized_status(value: str | None) -> str:
    status = (value or "draft").strip().lower()
    return status if status in LIVE_STATUSES else "draft"


def resolve_live_status(room: Any, *, now: datetime | None = None) -> str:
    current = now or datetime.now()
    status = normalized_status(getattr(room, "status", "draft"))
    content_type = (getattr(room, "content_type", "recorded") or "recorded").strip().lower()
    start_time = getattr(room, "start_time", None)

    if status in {"draft", "disabled", "ended"}:
        return status

    if status == "published":
        status = "scheduled" if start_time and start_time > current else "replay"

    if content_type != "live_stream":
        if status == "scheduled" and start_time and start_time <= current:
            return "replay"
        if status == "live":
            return "replay"
        return status

    if status == "scheduled" and start_time and start_time <= current:
        return "live"
    return status


def status_label(status: str | None) -> str:
    return STATUS_LABELS.get(normalized_status(status), status or "")


def default_publish_status(room: Any, *, now: datetime | None = None) -> str:
    current = now or datetime.now()
    start_time = getattr(room, "start_time", None)
    if start_time and start_time > current:
        return "scheduled"
    return "replay"


def is_public_status(status: str | None) -> bool:
    return normalized_status(status) in PUBLIC_STATUSES
