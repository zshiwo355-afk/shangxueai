from __future__ import annotations

import json
import logging
import secrets
import time
from collections import defaultdict
from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .auth import md5_password
from .config import get_settings
from .employee_open_client import EmployeeOpenApiError, EmployeeOpenClient
from .models import User, WecomSyncBatch, WecomSyncEntry
from .wecom_support import normalize_mobile, serialize_user_snapshot


_settings = get_settings()
_client = EmployeeOpenClient()
logger = logging.getLogger(__name__)

_preview_cache: dict[str, tuple[dict[str, Any], float]] = {}
_PREVIEW_TTL_SECONDS = 300.0


def _purge_expired_previews() -> None:
    if not _preview_cache:
        return
    now = time.time()
    for key, (_, expires_at) in list(_preview_cache.items()):
        if expires_at <= now:
            _preview_cache.pop(key, None)


def _sync_protected_statuses() -> set[str]:
    raw_values = (_settings.wecom_sync_protected_statuses or "试岗,离职").split(",")
    return {item.strip() for item in raw_values if item.strip()}


def _is_sync_protected_user(user: User) -> bool:
    return (user.employment_status or "").strip() in _sync_protected_statuses()


def _source_wecom_userid(employee: dict[str, Any]) -> str:
    return str(employee.get("wecom_userid") or "").strip()


def _source_mobile(employee: dict[str, Any]) -> str:
    return normalize_mobile(str(employee.get("mobile") or "").strip())


def _source_department(employee: dict[str, Any]) -> str:
    return str(employee.get("department_name") or "").strip()


def _source_position(employee: dict[str, Any]) -> str:
    return str(employee.get("position") or "").strip()


def _source_job_level(employee: dict[str, Any]) -> str:
    """Map HR `rank_name` (e.g. M3 / P0 / L1) into local job_level.

    M* -> M线, P* -> P线, L* -> L线. Empty/unknown returns "" so callers
    can decide to keep the existing local value instead of overwriting.
    """
    rank = str(employee.get("rank_name") or "").strip().upper()
    if not rank:
        return ""
    head = rank[0]
    if head == "M":
        return "M线"
    if head == "P":
        return "P线"
    if head == "L":
        return "L线"
    return ""


def _source_name(employee: dict[str, Any]) -> str:
    return str(employee.get("name") or "").strip()


def _normalize_name(raw: str | None) -> str:
    return "".join((raw or "").split()).casefold()


def _mobile_password_text(mobile: str | None) -> str:
    normalized = normalize_mobile(mobile)
    if not normalized:
        return ""
    return normalized[-6:]


def _mobile_password_md5(mobile: str | None) -> str:
    raw = _mobile_password_text(mobile)
    return md5_password(raw) if raw else ""


def _local_name_candidates(user: User) -> set[str]:
    return {
        value
        for value in (
            _normalize_name(user.real_name),
            _normalize_name(user.display_name),
        )
        if value
    }


def _names_match(employee: dict[str, Any], user: User) -> bool:
    source_name = _normalize_name(_source_name(employee))
    return bool(source_name and source_name in _local_name_candidates(user))


def _local_name_matches(
    employee: dict[str, Any],
    local_by_name: dict[str, list[User]],
) -> list[User]:
    source_name = _normalize_name(_source_name(employee))
    if not source_name:
        return []
    deduped: dict[int, User] = {}
    for user in local_by_name.get(source_name, []):
        deduped[int(user.id)] = user
    return list(deduped.values())


def _same_name_different_mobile_matches(
    employee: dict[str, Any],
    local_by_name: dict[str, list[User]],
) -> list[User]:
    source_mobile = _source_mobile(employee)
    if not source_mobile:
        return []
    return [
        user
        for user in _local_name_matches(employee, local_by_name)
        if normalize_mobile(user.username or "") != source_mobile
    ]


def _source_external_user_id(employee: dict[str, Any]) -> int | None:
    raw = employee.get("external_user_id")
    try:
        return int(raw)
    except (TypeError, ValueError):
        return None


def _source_hr_status(employee: dict[str, Any]) -> int | None:
    raw = employee.get("status")
    try:
        return int(raw)
    except (TypeError, ValueError):
        return None


def _source_employment_status(employee: dict[str, Any]) -> int | None:
    raw = employee.get("employment_status")
    try:
        return int(raw)
    except (TypeError, ValueError):
        return None


def _source_local_employment_status(employee: dict[str, Any]) -> str:
    """Map HR roster status into local employment_status dictionary values.

    HR `status`: 1 = 在职, 2 = 试用期.
    Local dictionary keeps `转正 / 试用 / 离职`.
    """
    code = _source_hr_status(employee)
    if code is None:
        return ""
    if code == 2:
        return "试用"
    if code == 1:
        return "转正"
    return ""


def _source_is_active(employee: dict[str, Any]) -> bool:
    """Map source employment_status into local account enabled state.

    Source `employment_status`: 1 = active, 2 = disabled, 3 = left.
    Null means no WeCom binding, so keep the account enabled when the
    employee is still returned by the HR roster API.
    """
    source_account_status = _source_employment_status(employee)
    if source_account_status is None:
        return True
    return source_account_status == 1


def _apply_employee_to_user(user: User, employee: dict[str, Any], *, synced_at: datetime) -> None:
    name = _source_name(employee)
    local_employment_status = _source_local_employment_status(employee)
    user.display_name = name or user.display_name or user.username
    user.real_name = name or user.real_name or user.username
    user.department = _source_department(employee)
    user.position = _source_position(employee)
    job_level = _source_job_level(employee)
    if job_level:
        user.job_level = job_level
    rank_name = str(employee.get("rank_name") or "").strip()
    if rank_name:
        user.rank_name = rank_name
    userid = _source_wecom_userid(employee)
    user.wecom_userid = userid or None
    user.wecom_synced_at = synced_at
    user.wecom_raw_json = json.dumps(employee, ensure_ascii=False)
    if local_employment_status:
        user.employment_status = local_employment_status
    if _source_is_active(employee):
        user.status = "active"
        user.disabled = False
    else:
        user.status = "inactive"
        user.disabled = True
        if not local_employment_status:
            user.employment_status = "离职"


def _make_item(
    *,
    action: str,
    employee: dict[str, Any] | None = None,
    local_user: User | None = None,
    match_type: str = "",
    reason: str = "",
) -> dict[str, Any]:
    employee = employee or {}
    local_snapshot = serialize_user_snapshot(local_user)
    local_user_id = int(local_user.id) if local_user else None
    local_name = ""
    local_username = ""
    local_role = ""
    if local_user:
        local_name = local_user.real_name or local_user.display_name or local_user.username
        local_username = local_user.username or ""
        local_role = local_user.role or ""
    return {
        "action": action,
        "reason": reason,
        "match_type": match_type,
        "local_user_id": local_user_id,
        "local_username": local_username,
        "local_name": local_name,
        "local_role": local_role,
        "external_user_id": _source_external_user_id(employee),
        "source_hr_status": _source_hr_status(employee),
        "source_employment_status": _source_employment_status(employee),
        "source_name": _source_name(employee),
        "wecom_name": _source_name(employee),
        "wecom_userid": _source_wecom_userid(employee),
        "mobile": _source_mobile(employee),
        "department": _source_department(employee),
        "position": _source_position(employee),
        "rank_name": str(employee.get("rank_name") or "").strip(),
        "job_level": _source_job_level(employee),
        "employee": employee,
        "local_snapshot": local_snapshot,
    }


async def build_employee_sync_preview(
    db: AsyncSession,
    *,
    initial_mode: bool = True,
) -> dict[str, Any]:
    if not _settings.employee_sync_ready:
        raise EmployeeOpenApiError("第三方员工同步未启用。")

    employees = await _client.fetch_employees()
    users = (await db.execute(select(User).order_by(User.id.asc()))).scalars().all()

    local_by_wecom: dict[str, User] = {
        (user.wecom_userid or "").strip(): user
        for user in users
        if (user.wecom_userid or "").strip()
    }
    local_by_mobile: dict[str, list[User]] = defaultdict(list)
    local_by_name: dict[str, list[User]] = defaultdict(list)
    for user in users:
        mobile = normalize_mobile(user.username or "")
        if mobile:
            local_by_mobile[mobile].append(user)
        for name in _local_name_candidates(user):
            local_by_name[name].append(user)

    source_by_mobile: dict[str, list[dict[str, Any]]] = defaultdict(list)
    source_by_name: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for employee in employees:
        mobile = _source_mobile(employee)
        if mobile:
            source_by_mobile[mobile].append(employee)
        name = _normalize_name(_source_name(employee))
        if name:
            source_by_name[name].append(employee)

    items: list[dict[str, Any]] = []
    summary = defaultdict(int)
    seen_local_user_ids: set[int] = set()
    seen_wecom_userids: set[str] = set()

    for employee in employees:
        wecom_userid = _source_wecom_userid(employee)
        mobile = _source_mobile(employee)
        local_user = local_by_wecom.get(wecom_userid) if wecom_userid else None

        if not mobile and not wecom_userid:
            items.append(
                _make_item(
                    action="skip_missing_identity",
                    employee=employee,
                    reason="第三方这条员工数据没有手机号和企微 userid，本次不会同步。",
                )
            )
            summary["skipped"] += 1
            continue

        if mobile and len(source_by_mobile[mobile]) > 1:
            items.append(
                _make_item(
                    action="conflict",
                    employee=employee,
                    reason="第三方接口里有多个员工使用同一个手机号，需要先让对方清理。",
                )
            )
            summary["conflict"] += 1
            continue

        local_matches = local_by_mobile.get(mobile, []) if mobile else []
        same_name_diff_mobile_matches = _same_name_different_mobile_matches(employee, local_by_name)
        if len(same_name_diff_mobile_matches) == 1 and not local_matches:
            local_user = same_name_diff_mobile_matches[0]
            items.append(
                _make_item(
                    action="update_by_name",
                    employee=employee,
                    local_user=local_user,
                    match_type="name",
                    reason="姓名相同但手机号不同；将以第三方新手机号更新原本地账号，并重置密码为新手机号后六位。",
                )
            )
            summary["update_by_name"] += 1
            seen_local_user_ids.add(int(local_user.id))
            if wecom_userid:
                seen_wecom_userids.add(wecom_userid)
            continue

        if len(same_name_diff_mobile_matches) > 1 and not local_matches:
            items.append(
                _make_item(
                    action="conflict",
                    employee=employee,
                    match_type="name",
                    reason="本地存在多个同名账号，且手机号不同，无法唯一确认该更新哪一个账号；本条跳过，其他记录可继续同步。",
                )
            )
            summary["conflict"] += 1
            continue

        if local_user is not None:
            reason = ""
            local_mobile = normalize_mobile(local_user.username or "")
            if mobile and local_mobile != mobile:
                mobile_conflict = next(
                    (
                        user
                        for user in local_by_mobile.get(mobile, [])
                        if int(user.id) != int(local_user.id)
                    ),
                    None,
                )
                if mobile_conflict is not None:
                    items.append(
                        _make_item(
                            action="conflict",
                            employee=employee,
                            local_user=local_user,
                            match_type="wecom_userid",
                            reason="已绑定账号的第三方手机号已变更，但新手机号已被本地其他账号占用；本条跳过，需人工处理。",
                        )
                    )
                    summary["conflict"] += 1
                    seen_local_user_ids.add(int(local_user.id))
                    if wecom_userid:
                        seen_wecom_userids.add(wecom_userid)
                    continue
                reason = "已绑定账号手机号将更新为第三方手机号，并重置密码为新手机号后六位。"
            items.append(
                _make_item(
                    action="update_bound",
                    employee=employee,
                    local_user=local_user,
                    match_type="wecom_userid",
                    reason=reason,
                )
            )
            summary["update_bound"] += 1
            seen_local_user_ids.add(int(local_user.id))
            if wecom_userid:
                seen_wecom_userids.add(wecom_userid)
            continue

        if len(local_matches) == 1:
            local_user = local_matches[0]
            if not _names_match(employee, local_user):
                items.append(
                    _make_item(
                        action="conflict",
                        employee=employee,
                        local_user=local_user,
                        match_type="mobile",
                        reason="手机号相同，但第三方姓名和本地姓名不一致；本条跳过，其他记录可继续同步。",
                    )
                )
                summary["conflict"] += 1
                continue
            bound_wecom_userid = (local_user.wecom_userid or "").strip()
            if bound_wecom_userid and bound_wecom_userid != wecom_userid:
                items.append(
                    _make_item(
                        action="conflict",
                        employee=employee,
                        local_user=local_user,
                        match_type="mobile",
                        reason="手机号和姓名一致，但本地已绑定另一个企微 userid；本条跳过，其他记录可继续同步。",
                    )
                )
                summary["conflict"] += 1
                continue
            items.append(
                _make_item(
                    action="bind_by_mobile",
                    employee=employee,
                    local_user=local_user,
                    match_type="mobile",
                )
            )
            summary["bind_by_mobile"] += 1
            seen_local_user_ids.add(int(local_user.id))
            if wecom_userid:
                seen_wecom_userids.add(wecom_userid)
            continue

        if len(local_matches) > 1:
            name_matches = [user for user in local_matches if _names_match(employee, user)]
            if len(name_matches) == 1:
                local_user = name_matches[0]
                bound_wecom_userid = (local_user.wecom_userid or "").strip()
                if bound_wecom_userid and bound_wecom_userid != wecom_userid:
                    items.append(
                        _make_item(
                            action="conflict",
                            employee=employee,
                            local_user=local_user,
                            match_type="mobile_name",
                            reason="手机号和姓名能匹配到本地账号，但本地已绑定另一个企微 userid；本条跳过，其他记录可继续同步。",
                        )
                    )
                    summary["conflict"] += 1
                    continue
                items.append(
                    _make_item(
                        action="bind_by_mobile",
                        employee=employee,
                        local_user=local_user,
                        match_type="mobile_name",
                    )
                )
                summary["bind_by_mobile"] += 1
                seen_local_user_ids.add(int(local_user.id))
                if wecom_userid:
                    seen_wecom_userids.add(wecom_userid)
                continue
            items.append(
                _make_item(
                    action="conflict",
                    employee=employee,
                    match_type="mobile",
                    reason="本地存在多个相同手机号账号，且姓名不能唯一确认；本条跳过，其他记录可继续同步。",
                )
            )
            summary["conflict"] += 1
            continue

        same_name_matches = same_name_diff_mobile_matches if mobile else []
        if len(same_name_matches) == 1:
            local_user = same_name_matches[0]
            bound_wecom_userid = (local_user.wecom_userid or "").strip()
            if bound_wecom_userid and bound_wecom_userid != wecom_userid:
                items.append(
                    _make_item(
                        action="conflict",
                        employee=employee,
                        local_user=local_user,
                        match_type="name",
                        reason="姓名相同，但本地账号已绑定另一个企微 userid；本条跳过，其他记录可继续同步。",
                    )
                )
                summary["conflict"] += 1
                continue
            items.append(
                _make_item(
                    action="update_by_name",
                    employee=employee,
                    local_user=local_user,
                    match_type="name",
                    reason="姓名和本地账号相同，但手机号不同；将更新原账号手机号，并把密码重置为新手机号后六位。",
                )
            )
            summary["update_by_name"] += 1
            seen_local_user_ids.add(int(local_user.id))
            if wecom_userid:
                seen_wecom_userids.add(wecom_userid)
            continue

        if len(same_name_matches) > 1:
            items.append(
                _make_item(
                    action="conflict",
                    employee=employee,
                    match_type="name",
                    reason="本地存在多个同名账号，且手机号不同，无法唯一确认该更新哪一个账号；本条跳过，其他记录可继续同步。",
                )
            )
            summary["conflict"] += 1
            continue

        reason = "第三方有这个员工，但本地还没有对应账号；执行同步会自动新建。"
        items.append(
            _make_item(
                action="pending_create",
                employee=employee,
                reason=reason,
            )
        )
        summary["pending_create"] += 1
        if wecom_userid:
            seen_wecom_userids.add(wecom_userid)

    for user in users:
        if (user.role or "user") != "user":
            continue
        bound_wecom_userid = (user.wecom_userid or "").strip()
        if int(user.id) in seen_local_user_ids or (bound_wecom_userid and bound_wecom_userid in seen_wecom_userids):
            continue
        local_mobile = normalize_mobile(user.username or "")
        if local_mobile and len(source_by_mobile.get(local_mobile, [])) > 1:
            items.append(
                _make_item(
                    action="conflict",
                    employee=source_by_mobile[local_mobile][0],
                    local_user=user,
                    match_type="mobile",
                    reason="第三方接口里有多个员工使用这个手机号；本地账号暂不自动更新，请先让对方清理手机号。",
                )
            )
            summary["conflict"] += 1
            continue
        same_name_sources: list[dict[str, Any]] = []
        for name in _local_name_candidates(user):
            same_name_sources.extend(source_by_name.get(name, []))
        same_name_sources = [
            employee
            for employee in same_name_sources
            if _source_mobile(employee) != normalize_mobile(user.username or "")
        ]
        same_name_source = same_name_sources[0] if same_name_sources else None
        same_name_source_mobile = _source_mobile(same_name_source) if same_name_source else ""
        if same_name_source and same_name_source_mobile and len(source_by_mobile[same_name_source_mobile]) > 1:
            items.append(
                _make_item(
                    action="conflict",
                    employee=same_name_source,
                    local_user=user,
                    match_type="name",
                    reason="第三方接口里有多个员工使用同一个新手机号；无法判断该手机号应更新给哪一个同名本地账号，请先让对方清理手机号。",
                )
            )
            summary["conflict"] += 1
            continue
        if not bound_wecom_userid:
            if same_name_source:
                items.append(
                    _make_item(
                        action="update_by_name",
                        employee=same_name_source,
                        local_user=user,
                        match_type="name",
                        reason="第三方存在同名员工且手机号不同；将更新原本地账号手机号，并把密码重置为新手机号后六位。",
                    )
                )
                summary["update_by_name"] += 1
                continue
            if initial_mode:
                items.append(
                    _make_item(
                        action="local_unbound",
                        employee=same_name_source,
                        local_user=user,
                        reason="本地有这个账号，但第三方员工列表里没有匹配到；初始化模式只提示，不处理。",
                    )
                )
                summary["local_unbound"] += 1
                continue

        if same_name_source:
            source_mobile = _source_mobile(same_name_source) or "空手机号"
            source_name = _source_name(same_name_source) or "同名员工"
            items.append(
                _make_item(
                    action="local_unbound",
                    employee=same_name_source,
                    local_user=user,
                    reason=(
                        f"第三方存在同名员工 {source_name}，但手机号是 {source_mobile}，"
                        "和本地账号手机号不同；本地旧账号不会自动置离职。"
                    ),
                )
            )
            summary["local_unbound"] += 1
            continue

        # Protected statuses only guard local accounts that are absent from the source list.
        # Once the employee appears in the third-party data, the earlier matching branches
        # bind/update the account normally and refresh its employment status from HR data.
        should_mark_left = (
            (not initial_mode)
            and _settings.wecom_sync_disabled_users
            and not _is_sync_protected_user(user)
        )
        action = "mark_left" if should_mark_left else "local_unbound"
        if initial_mode:
            reason = "本地有这个账号，但第三方员工列表里没有匹配到；初始化模式只提示，不处理。"
        elif _is_sync_protected_user(user):
            reason = "本地账号处于同步保护状态，即使第三方缺失也不会自动置离职。"
        elif not _settings.wecom_sync_disabled_users:
            reason = "当前配置为第三方缺失时不自动禁用，只记录待确认。"
        else:
            reason = "第三方员工列表里已找不到该绑定账号；执行同步会置为离职并禁用。"
        items.append(
            _make_item(
                action=action,
                local_user=user,
                reason=reason,
            )
        )
        summary[action] += 1

    return {
        "initial_mode": bool(initial_mode),
        "total_source_users": len(employees),
        "summary": dict(summary),
        "items": items,
    }


def _store_preview(payload: dict[str, Any]) -> str:
    _purge_expired_previews()
    token = secrets.token_urlsafe(24)
    _preview_cache[token] = (payload, time.time() + _PREVIEW_TTL_SECONDS)
    return token


def consume_preview(token: str) -> dict[str, Any] | None:
    if not token.strip():
        return None
    _purge_expired_previews()
    entry = _preview_cache.pop(token.strip(), None)
    if not entry:
        return None
    payload, expires_at = entry
    if expires_at <= time.time():
        return None
    return payload


async def build_employee_sync_preview_with_token(
    db: AsyncSession,
    *,
    initial_mode: bool = True,
) -> tuple[dict[str, Any], str]:
    preview = await build_employee_sync_preview(db, initial_mode=initial_mode)
    token = _store_preview(preview)
    return preview, token


async def _find_unique_same_name_different_mobile_user(
    db: AsyncSession,
    employee: dict[str, Any],
) -> User | None:
    source_mobile = _source_mobile(employee)
    if not source_mobile or not _source_name(employee):
        return None
    users = (await db.execute(select(User).order_by(User.id.asc()))).scalars().all()
    matches = [
        user
        for user in users
        if (user.role or "user") == "user"
        and _names_match(employee, user)
        and normalize_mobile(user.username or "") != source_mobile
    ]
    return matches[0] if len(matches) == 1 else None


async def execute_employee_sync(
    db: AsyncSession,
    *,
    actor: User | None = None,
    mode: str = "manual",
    initial_mode: bool = True,
    preview: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if preview is None:
        preview = await build_employee_sync_preview(db, initial_mode=initial_mode)
    else:
        preview_initial_mode = bool(preview.get("initial_mode", initial_mode))
        if preview_initial_mode != bool(initial_mode):
            preview = await build_employee_sync_preview(db, initial_mode=initial_mode)
        else:
            initial_mode = preview_initial_mode

    batch = WecomSyncBatch(
        mode=mode,
        initial_mode=bool(initial_mode),
        total_wecom_users=int(preview["total_source_users"]),
        executed_by=int(actor.id) if actor is not None else None,
        summary_json=json.dumps(preview["summary"], ensure_ascii=False),
    )
    db.add(batch)
    await db.flush()

    counters = defaultdict(int)
    now = datetime.now()

    for item in preview["items"]:
        local_user_id = item.get("local_user_id")
        local_user = await db.get(User, local_user_id) if local_user_id else None
        employee = item.get("employee") or {}
        before = serialize_user_snapshot(local_user)
        action = str(item.get("action") or "")
        reason = str(item.get("reason") or "")
        status = "skipped"
        created_user: User | None = None

        if action in {"local_unbound", "pending_create", "update_bound"}:
            same_name_user = await _find_unique_same_name_different_mobile_user(db, employee)
            if same_name_user is not None and (
                action in {"local_unbound", "pending_create"}
                or local_user is None
                or int(same_name_user.id) != int(local_user.id)
            ):
                local_user = same_name_user
                before = serialize_user_snapshot(local_user)
                action = "update_by_name"
                reason = "执行同步时按姓名唯一匹配到本地旧手机号账号；将以第三方新手机号更新原账号，并重置密码为新手机号后六位。"

        if action in {"update_bound", "bind_by_mobile"} and local_user is not None:
            can_apply_bound_update = True
            if action == "update_bound":
                mobile = item.get("mobile") or _source_mobile(employee)
                local_mobile = normalize_mobile(local_user.username or "")
                if mobile and local_mobile != mobile:
                    password_md5 = _mobile_password_md5(mobile)
                    conflict_user = (
                        await db.execute(
                            select(User)
                            .where(User.username == mobile, User.id != int(local_user.id))
                            .limit(1)
                        )
                    ).scalar_one_or_none()
                    if not password_md5:
                        reason = "已绑定账号的第三方手机号不可用，无法更新本地登录手机号和密码。"
                        can_apply_bound_update = False
                        counters["skipped"] += 1
                    elif conflict_user is not None:
                        reason = "执行同步时发现已绑定账号的新手机号已被本地其他账号占用，本条跳过，需人工处理。"
                        can_apply_bound_update = False
                        counters["conflict"] += 1
                    else:
                        local_user.username = mobile
                        local_user.password_md5 = password_md5
                        reason = reason or "已绑定账号手机号已更新，密码已重置为新手机号后六位。"
            if can_apply_bound_update:
                _apply_employee_to_user(local_user, employee, synced_at=now)
                status = "applied"
                counters["matched"] += 1
                counters["updated"] += 1
                if action == "bind_by_mobile":
                    counters["bound"] += 1
        elif action == "update_by_name" and local_user is not None:
            mobile = item.get("mobile") or ""
            password_md5 = _mobile_password_md5(mobile)
            conflict_user = None
            if mobile:
                conflict_user = (
                    await db.execute(
                        select(User)
                        .where(User.username == mobile, User.id != int(local_user.id))
                        .limit(1)
                    )
                ).scalar_one_or_none()
            if not mobile or not password_md5:
                reason = "第三方员工缺少可用手机号，无法按新手机号更新本地账号。"
                counters["skipped"] += 1
            elif conflict_user is not None:
                reason = "执行同步时发现新手机号已被本地其他账号占用，本条跳过，需人工处理。"
                counters["conflict"] += 1
            else:
                incoming_wecom_userid = _source_wecom_userid(employee)
                if incoming_wecom_userid:
                    bound_user = (
                        await db.execute(
                            select(User)
                            .where(User.wecom_userid == incoming_wecom_userid, User.id != int(local_user.id))
                            .limit(1)
                        )
                    ).scalar_one_or_none()
                    if bound_user is not None:
                        bound_user.wecom_userid = None
                local_user.username = mobile
                local_user.password_md5 = password_md5
                _apply_employee_to_user(local_user, employee, synced_at=now)
                status = "applied"
                counters["matched"] += 1
                counters["updated"] += 1
        elif action == "pending_create" and _settings.employee_sync_auto_create_user:
            mobile = item.get("mobile") or ""
            password_md5 = _mobile_password_md5(mobile)
            if mobile and password_md5:
                created_user = User(
                    username=mobile,
                    password_md5=password_md5,
                    display_name=item.get("source_name") or mobile,
                    real_name=item.get("source_name") or mobile,
                    department=item.get("department") or "",
                    position=item.get("position") or "",
                    job_level=_source_job_level(employee) or "M线",
                    rank_name=str(employee.get("rank_name") or "").strip(),
                    role="user",
                    is_newcomer=False,
                    employment_status=_source_local_employment_status(employee),
                    status="active" if _source_is_active(employee) else "inactive",
                    disabled=not _source_is_active(employee),
                    wecom_userid=item.get("wecom_userid") or None,
                    wecom_synced_at=now,
                    wecom_raw_json=json.dumps(employee, ensure_ascii=False),
                )
                db.add(created_user)
                await db.flush()
                status = "created"
                counters["created"] += 1
            else:
                counters["skipped"] += 1
        elif action == "mark_left" and local_user is not None and not initial_mode:
            local_user.employment_status = "离职"
            local_user.status = "inactive"
            local_user.disabled = True
            local_user.wecom_synced_at = now
            status = "applied"
            counters["left"] += 1
            counters["disabled"] += 1
        elif action == "conflict":
            counters["conflict"] += 1
        else:
            counters["skipped"] += 1

        after = serialize_user_snapshot(created_user or local_user)
        db.add(
            WecomSyncEntry(
                batch_id=int(batch.id),
                user_id=int((created_user or local_user).id) if (created_user or local_user) else None,
                wecom_userid=str(item.get("wecom_userid") or "").strip() or None,
                mobile=str(item.get("mobile") or "").strip() or None,
                match_type=str(item.get("match_type") or "").strip() or None,
                action=action,
                status=status,
                reason=reason,
                before_json=json.dumps(before, ensure_ascii=False) if before is not None else None,
                after_json=json.dumps(after, ensure_ascii=False) if after is not None else None,
            )
        )

    batch.matched_count = int(counters["matched"])
    batch.bound_count = int(counters["bound"])
    batch.updated_count = int(counters["updated"])
    batch.created_count = int(counters["created"])
    batch.left_count = int(counters["left"])
    batch.disabled_count = int(counters["disabled"])
    batch.conflict_count = int(counters["conflict"])
    batch.skipped_count = int(counters["skipped"])
    batch.finished_at = now
    await db.flush()
    return {
        "batch_id": int(batch.id),
        "initial_mode": bool(initial_mode),
        "summary": {
            "matched": int(counters["matched"]),
            "bound": int(counters["bound"]),
            "updated": int(counters["updated"]),
            "created": int(counters["created"]),
            "left": int(counters["left"]),
            "disabled": int(counters["disabled"]),
            "conflict": int(counters["conflict"]),
            "skipped": int(counters["skipped"]),
        },
    }
