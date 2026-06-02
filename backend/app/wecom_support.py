from __future__ import annotations

import json
import re
from datetime import datetime
from typing import Any

from .models import User


_MOBILE_CLEAN_RE = re.compile(r"[^\d+]")


def normalize_mobile(raw: str | None) -> str:
    text = _MOBILE_CLEAN_RE.sub("", (raw or "").strip())
    if text.startswith("+86"):
        text = text[3:]
    elif text.startswith("86") and len(text) > 11:
        text = text[2:]
    return text


def get_wecom_userid(member: dict[str, Any]) -> str:
    return str(member.get("userid") or member.get("UserId") or "").strip()


def get_wecom_member_mobile(member: dict[str, Any]) -> str:
    return normalize_mobile(str(member.get("mobile") or member.get("Mobile") or "").strip())


def is_wecom_member_active(member: dict[str, Any]) -> bool:
    raw = member.get("status")
    try:
        return int(raw) == 1
    except (TypeError, ValueError):
        return True


def get_wecom_department_text(
    member: dict[str, Any],
    department_name_map: dict[int, str] | None = None,
) -> str:
    department_ids = member.get("department") or member.get("department_ids") or []
    if not isinstance(department_ids, list):
        return ""
    if not department_name_map:
        return ",".join(str(item) for item in department_ids if str(item).strip())
    names = [
        department_name_map.get(int(item), "")
        for item in department_ids
        if str(item).strip().isdigit()
    ]
    return ",".join(name for name in names if name)


def serialize_user_snapshot(user: User | None) -> dict[str, Any] | None:
    if not user:
        return None
    return {
        "id": int(user.id),
        "username": user.username or "",
        "display_name": user.display_name or "",
        "real_name": user.real_name or "",
        "department": user.department or "",
        "position": user.position or "",
        "role": user.role or "",
        "is_newcomer": bool(user.is_newcomer),
        "employment_status": user.employment_status or "",
        "status": user.status or "",
        "disabled": bool(user.disabled),
        "wecom_userid": user.wecom_userid or "",
        "wecom_synced_at": user.wecom_synced_at.isoformat() if user.wecom_synced_at else None,
    }


def apply_wecom_member_to_user(
    user: User,
    member: dict[str, Any],
    *,
    department_name_map: dict[int, str] | None = None,
    bind_userid: bool = True,
    mark_disabled: bool = True,
    synced_at: datetime | None = None,
) -> None:
    user.display_name = str(member.get("name") or user.display_name or user.username).strip()
    user.real_name = str(member.get("name") or user.real_name or user.username).strip()
    user.department = get_wecom_department_text(member, department_name_map)
    user.position = str(member.get("position") or "").strip()
    if bind_userid:
        resolved_wecom_userid = get_wecom_userid(member)
        user.wecom_userid = resolved_wecom_userid or None
    user.wecom_synced_at = synced_at or datetime.now()
    user.wecom_raw_json = json.dumps(member, ensure_ascii=False)
    if mark_disabled:
        if is_wecom_member_active(member):
            user.status = "active"
            user.disabled = False
        else:
            user.status = "inactive"
            user.disabled = True
            user.employment_status = "离职"
