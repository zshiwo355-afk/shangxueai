from __future__ import annotations

import asyncio
import json
import logging
import secrets
import time
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from .auth import md5_password
from .config import get_settings
from .db import session_scope
from .models import User, WecomSyncBatch, WecomSyncEntry
from .wecom_client import WecomApiError, WecomClient
from .wecom_support import (
    apply_wecom_member_to_user,
    get_wecom_member_mobile,
    get_wecom_userid,
    serialize_user_snapshot,
)


_settings = get_settings()
_wecom_client = WecomClient()
logger = logging.getLogger(__name__)


# 进程内的预览缓存：preview_token -> (preview_payload, expires_at_epoch)
# 仅在 5 分钟内有效，确保管理员"预览 → 执行"是同一份快照。
_preview_cache: dict[str, tuple[dict[str, Any], float]] = {}
_PREVIEW_TTL_SECONDS = 300.0


def _purge_expired_previews() -> None:
    if not _preview_cache:
        return
    now = time.time()
    for key, (_, expires_at) in list(_preview_cache.items()):
        if expires_at <= now:
            _preview_cache.pop(key, None)


def _make_item(
    *,
    action: str,
    reason: str = "",
    local_user: User | None = None,
    member: dict[str, Any] | None = None,
    match_type: str = "",
    department_name_map: dict[int, str] | None = None,
) -> dict[str, Any]:
    member = member or {}
    local_name = ""
    local_username = ""
    local_role = ""
    local_user_id = None
    if local_user:
        local_user_id = int(local_user.id)
        local_name = local_user.real_name or local_user.display_name or local_user.username
        local_username = local_user.username or ""
        local_role = local_user.role or ""
    department = ""
    if department_name_map and isinstance(member.get("department"), list):
        department = ",".join(
            department_name_map.get(int(item), "")
            for item in member.get("department", [])
            if str(item).isdigit()
        ).strip(",")
    return {
        "action": action,
        "reason": reason,
        "match_type": match_type,
        "local_user_id": local_user_id,
        "local_username": local_username,
        "local_name": local_name,
        "local_role": local_role,
        "wecom_userid": get_wecom_userid(member),
        "wecom_name": str(member.get("name") or "").strip(),
        "mobile": get_wecom_member_mobile(member),
        "department": department,
        "position": str(member.get("position") or "").strip(),
        "member": member,
        "local_snapshot": serialize_user_snapshot(local_user),
    }


def _sync_protected_statuses() -> set[str]:
    raw_values = (_settings.wecom_sync_protected_statuses or "试岗,离职").split(",")
    return {item.strip() for item in raw_values if item.strip()}


def _is_sync_protected_user(user: User) -> bool:
    return (user.employment_status or "").strip() in _sync_protected_statuses()


def _next_daily_sync_at(now: datetime | None = None) -> datetime:
    current = now or datetime.now()
    hour = max(0, min(23, int(_settings.wecom_daily_sync_hour or 8)))
    minute = max(0, min(59, int(_settings.wecom_daily_sync_minute or 0)))
    scheduled = current.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if scheduled <= current:
        scheduled += timedelta(days=1)
    return scheduled


async def build_wecom_sync_preview(
    db: AsyncSession,
    *,
    initial_mode: bool = True,
) -> dict[str, Any]:
    if not _settings.wecom_sync_ready:
        raise WecomApiError("企业微信功能未启用。")
    members, department_name_map = await _wecom_client.fetch_all_members()
    users = (await db.execute(select(User).order_by(User.id.asc()))).scalars().all()

    local_by_wecom: dict[str, User] = {
        (user.wecom_userid or "").strip(): user
        for user in users
        if (user.wecom_userid or "").strip()
    }
    local_by_mobile: dict[str, list[User]] = defaultdict(list)
    for user in users:
        local_by_mobile[(user.username or "").strip()].append(user)

    wecom_by_mobile: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for member in members:
        mobile = get_wecom_member_mobile(member)
        if mobile:
            wecom_by_mobile[mobile].append(member)

    items: list[dict[str, Any]] = []
    seen_wecom_userids: set[str] = set()
    seen_local_user_ids: set[int] = set()
    summary = defaultdict(int)

    for member in members:
        userid = get_wecom_userid(member)
        mobile = get_wecom_member_mobile(member)
        local_user = local_by_wecom.get(userid)
        if not mobile:
            items.append(
                _make_item(
                    action="skip_missing_mobile",
                    reason="企业微信用户缺少手机号，无法自动匹配。",
                    member=member,
                    department_name_map=department_name_map,
                )
            )
            summary["skip_missing_mobile"] += 1
            continue
        if len(wecom_by_mobile[mobile]) > 1:
            items.append(
                _make_item(
                    action="conflict",
                    reason="企业微信中存在重复手机号，需先清理通讯录。",
                    member=member,
                    department_name_map=department_name_map,
                )
            )
            summary["conflict"] += 1
            continue
        local_matches = local_by_mobile.get(mobile, [])
        if local_user is not None:
            items.append(
                _make_item(
                    action="update_bound",
                    local_user=local_user,
                    member=member,
                    match_type="wecom_userid",
                    department_name_map=department_name_map,
                )
            )
            summary["update_bound"] += 1
            seen_wecom_userids.add(userid)
            seen_local_user_ids.add(int(local_user.id))
            continue
        if len(local_matches) == 1:
            local_user = local_matches[0]
            if (local_user.wecom_userid or "").strip() and (local_user.wecom_userid or "").strip() != userid:
                items.append(
                    _make_item(
                        action="conflict",
                        reason="本地账号已绑定其他企业微信 userid，需要管理员确认。",
                        local_user=local_user,
                        member=member,
                        match_type="mobile",
                        department_name_map=department_name_map,
                    )
                )
                summary["conflict"] += 1
                continue
            items.append(
                _make_item(
                    action="bind_by_mobile",
                    local_user=local_user,
                    member=member,
                    match_type="mobile",
                    department_name_map=department_name_map,
                )
            )
            summary["bind_by_mobile"] += 1
            seen_wecom_userids.add(userid)
            seen_local_user_ids.add(int(local_user.id))
            continue
        if len(local_matches) > 1:
            items.append(
                _make_item(
                    action="conflict",
                    reason="本地存在多个相同手机号账号，无法自动绑定。",
                    member=member,
                    match_type="mobile",
                    department_name_map=department_name_map,
                )
            )
            summary["conflict"] += 1
            continue
        items.append(
            _make_item(
                action="pending_create",
                reason="企业微信有用户，本地尚未开通账号。",
                member=member,
                department_name_map=department_name_map,
            )
        )
        summary["pending_create"] += 1
        seen_wecom_userids.add(userid)

    for user in users:
        if (user.role or "user") != "user":
            continue
        bound_userid = (user.wecom_userid or "").strip()
        if int(user.id) in seen_local_user_ids or (bound_userid and bound_userid in seen_wecom_userids):
            continue
        should_mark_left = (
            (not initial_mode)
            and _settings.wecom_sync_disabled_users
            and not _is_sync_protected_user(user)
        )
        action = "mark_left" if should_mark_left else "local_unbound"
        reason = (
            "本地账号为同步保护状态，日常同步发现企微缺失时不自动置为离职。"
            if not initial_mode and _is_sync_protected_user(user)
            else
            "日常同步发现企微缺失，但当前配置为不自动禁用，仅记录待确认。"
            if not initial_mode and not _settings.wecom_sync_disabled_users
            else "首次初始化仅提示未匹配本地账号，不自动置为离职。"
            if initial_mode
            else "企业微信未找到该绑定账号，将置为离职/禁用。"
        )
        items.append(
            _make_item(
                action=action,
                reason=reason,
                local_user=user,
            )
        )
        summary[action] += 1

    return {
        "initial_mode": bool(initial_mode),
        "summary": dict(summary),
        "total_wecom_users": len(members),
        "department_name_map": department_name_map,
        "items": items,
    }


def _store_preview(payload: dict[str, Any]) -> str:
    _purge_expired_previews()
    token = secrets.token_urlsafe(16)
    _preview_cache[token] = (payload, time.time() + _PREVIEW_TTL_SECONDS)
    return token


def consume_preview(token: str) -> dict[str, Any] | None:
    """取出预览缓存。execute 用完即丢，避免被同一个 token 触发两次同步。"""
    if not token:
        return None
    entry = _preview_cache.pop(token.strip(), None)
    if not entry:
        return None
    payload, expires_at = entry
    if expires_at <= time.time():
        return None
    return payload


async def build_wecom_sync_preview_with_token(
    db: AsyncSession,
    *,
    initial_mode: bool = True,
) -> tuple[dict[str, Any], str]:
    preview = await build_wecom_sync_preview(db, initial_mode=initial_mode)
    token = _store_preview(preview)
    return preview, token


async def _try_acquire_sync_lock(db: AsyncSession, *, lock_name: str, timeout_seconds: int = 0) -> bool:
    """MySQL GET_LOCK 排他：所有 worker 共享同一个连接级锁。

    成功返回 True，失败返回 False。失败时调用方应直接放弃此次 sync，
    避免 daily 任务在 4-worker 场景重复执行。
    """
    bind = db.get_bind()
    if "mysql" not in (bind.dialect.name or "").lower():
        # 非 MySQL（比如本地用 SQLite 跑单测）就不上锁，直接放行。
        return True
    row = (await db.execute(text("SELECT GET_LOCK(:name, :t)"), {"name": lock_name, "t": int(timeout_seconds)})).scalar()
    return bool(row == 1)


async def _release_sync_lock(db: AsyncSession, *, lock_name: str) -> None:
    bind = db.get_bind()
    if "mysql" not in (bind.dialect.name or "").lower():
        return
    try:
        await db.execute(text("SELECT RELEASE_LOCK(:name)"), {"name": lock_name})
    except Exception:  # noqa: BLE001
        logger.exception("release sync lock failed: %s", lock_name)


async def execute_wecom_sync(
    db: AsyncSession,
    *,
    actor: User | None,
    initial_mode: bool = True,
    mode: str = "manual",
    preview: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if preview is None:
        preview = await build_wecom_sync_preview(db, initial_mode=initial_mode)
    else:
        # 调用方传入预览快照（来自 preview token），按预览的 initial_mode 执行，
        # 避免预览/执行两次拉企微通讯录、避免人/状态在两次拉取之间漂移。
        initial_mode = bool(preview.get("initial_mode", initial_mode))
    department_name_map = preview.get("department_name_map") or {}
    batch = WecomSyncBatch(
        mode=mode,
        initial_mode=bool(initial_mode),
        total_wecom_users=int(preview["total_wecom_users"]),
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
        member = item.get("member") or {}
        before = serialize_user_snapshot(local_user)
        action = str(item.get("action") or "")
        status = "skipped"
        reason = str(item.get("reason") or "")
        created_user: User | None = None

        if action in {"update_bound", "bind_by_mobile"} and local_user is not None:
            apply_wecom_member_to_user(
                local_user,
                member,
                department_name_map=department_name_map,
                bind_userid=True,
                synced_at=now,
            )
            status = "applied"
            counters["matched"] += 1
            counters["updated"] += 1
            if action == "bind_by_mobile":
                counters["bound"] += 1
        elif action == "pending_create" and _settings.wecom_auto_create_user:
            mobile = item.get("mobile") or ""
            if mobile:
                created_user = User(
                    username=mobile,
                    password_md5=md5_password(secrets.token_hex(8)),
                    display_name=item.get("wecom_name") or mobile,
                    real_name=item.get("wecom_name") or mobile,
                    department=item.get("department") or "",
                    position=item.get("position") or "",
                    role="user",
                    is_newcomer=False,
                    employment_status="",
                    status="active",
                    disabled=False,
                    wecom_userid=item.get("wecom_userid") or None,
                    wecom_synced_at=now,
                    wecom_raw_json=json.dumps(member, ensure_ascii=False),
                )
                db.add(created_user)
                await db.flush()
                status = "created"
                counters["created"] += 1
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


async def run_scheduled_wecom_sync_once() -> dict[str, Any] | None:
    if not _settings.wecom_sync_ready or not _settings.wecom_daily_sync_enabled:
        return None
    lock_name = f"wecom_daily_sync:{_settings.wecom_corp_id or 'default'}"
    async with session_scope() as db:
        # MySQL GET_LOCK 在多 worker / 多机部署下保证当天只有一份 daily 同步在跑。
        # timeout=0 → 拿不到锁立刻返回，本次 worker 跳过即可，不阻塞其他流程。
        acquired = await _try_acquire_sync_lock(db, lock_name=lock_name, timeout_seconds=0)
        if not acquired:
            logger.info("daily WeCom sync skipped: lock held by another worker")
            return None
        try:
            return await execute_wecom_sync(
                db,
                actor=None,
                initial_mode=False,
                mode="daily",
            )
        finally:
            await _release_sync_lock(db, lock_name=lock_name)


async def wecom_daily_sync_worker(stop_event: asyncio.Event) -> None:
    while not stop_event.is_set():
        wait_seconds = max(1.0, (_next_daily_sync_at() - datetime.now()).total_seconds())
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=wait_seconds)
            continue
        except TimeoutError:
            pass
        if stop_event.is_set():
            break
        try:
            result = await run_scheduled_wecom_sync_once()
            if result:
                logger.info("daily WeCom sync completed: %s", result)
        except Exception:  # noqa: BLE001
            logger.exception("daily WeCom sync failed")
