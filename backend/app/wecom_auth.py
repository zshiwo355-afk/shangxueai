from __future__ import annotations

import json
import secrets
import string
import time
from typing import Any
from urllib.parse import quote

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .config import get_settings
from .models import User
from .wecom_client import WecomApiError, WecomClient
from .wecom_support import (
    apply_wecom_member_to_user,
    get_wecom_member_mobile,
    get_wecom_userid,
    is_wecom_member_active,
)


class WecomAuthError(RuntimeError):
    def __init__(self, message: str, *, code: str = "wecom_auth_failed") -> None:
        super().__init__(message)
        self.code = code


_settings = get_settings()
_wecom_client = WecomClient()
_STATE_ALPHABET = string.ascii_letters + string.digits
_state_cache: dict[str, tuple[str, float]] = {}


def build_auth_user_payload(user: User) -> dict[str, Any]:
    return {
        "id": user.id,
        "username": user.username,
        "display_name": user.real_name or user.display_name or user.username,
        "real_name": user.real_name or "",
        "department": user.department or "",
        "position": user.position or "",
        "job_level": user.job_level or "M线",
        "role": user.role,
        "is_newcomer": bool(user.is_newcomer),
        "employment_status": user.employment_status or "",
        "guide_completed_at": user.guide_completed_at.isoformat() if user.guide_completed_at else None,
        "status": user.status or "active",
        "wecom_userid": user.wecom_userid or "",
    }


def _encode_state(redirect: str) -> str:
    state = "".join(secrets.choice(_STATE_ALPHABET) for _ in range(32))
    clean_redirect = redirect if redirect and redirect.startswith("/") else "/home"
    _state_cache[state] = (
        clean_redirect,
        time.time() + max(60, int(_settings.wecom_state_ttl_seconds or 600)),
    )
    # Keep the in-memory cache bounded; WeCom requires a short state value.
    if len(_state_cache) > 1000:
        now = time.time()
        for key, (_, expires_at) in list(_state_cache.items()):
            if expires_at <= now:
                _state_cache.pop(key, None)
    return state


def decode_state(state: str) -> str:
    key = (state or "").strip()
    entry = _state_cache.get(key)
    if not entry:
        raise WecomAuthError("企业微信登录状态无效，请重新发起登录。", code="wecom_invalid_state")
    redirect, expires_at = entry
    now = time.time()
    if expires_at <= now:
        _state_cache.pop(key, None)
        raise WecomAuthError("企业微信登录状态已过期，请重新发起登录。", code="wecom_invalid_state")
    if not redirect.startswith("/"):
        redirect = "/home"
    # 不在这里 pop：移动端常见 history.back / 双击触发，导致同一个 state 短时间内被
    # 命中两次，第二次就拿不到 redirect。这里保留到 TTL 自然过期，回调本身已经
    # 通过 code 单次有效来防重放。
    return redirect


def build_authorize_url(redirect: str) -> str:
    state = _encode_state(redirect)
    return (
        "https://open.weixin.qq.com/connect/oauth2/authorize"
        f"?appid={quote(_settings.wecom_corp_id)}"
        f"&redirect_uri={quote(_settings.wecom_redirect_uri, safe='')}"
        "&response_type=code"
        "&scope=snsapi_base"
        f"&state={quote(state, safe='')}"
        "#wechat_redirect"
    )


def build_frontend_callback_redirect(
    *,
    redirect: str,
    token: str = "",
    expires_at: int | None = None,
    user: dict[str, Any] | None = None,
    error: str = "",
    error_code: str = "",
) -> str:
    base = _settings.wecom_frontend_callback_url.strip() or "/login"
    fragment_parts = [f"redirect={quote(redirect or '/home', safe='')}"]
    if token:
        fragment_parts.append(f"token={quote(token, safe='')}")
    if expires_at:
        fragment_parts.append(f"expires_at={expires_at}")
    if user is not None:
        fragment_parts.append(
            "user=" + quote(json.dumps(user, ensure_ascii=False), safe="")
        )
    if error:
        fragment_parts.append(f"error={quote(error, safe='')}")
    if error_code:
        fragment_parts.append(f"error_code={quote(error_code, safe='')}")
    return f"{base}#{'&'.join(fragment_parts)}"


async def login_by_code(
    db: AsyncSession,
    *,
    code: str,
) -> tuple[User, dict[str, Any]]:
    if not _settings.wecom_login_ready:
        raise WecomAuthError("企业微信登录未启用。", code="wecom_disabled")
    try:
        userinfo = await _wecom_client.get_userinfo_by_code(code)
        userid = get_wecom_userid(userinfo)
        if not userid:
            raise WecomAuthError("企业微信未返回可用的用户身份。", code="wecom_missing_userid")
        member = await _wecom_client.get_member(userid)
        if not is_wecom_member_active(member):
            raise WecomAuthError("企业微信账号已停用，无法登录。", code="wecom_user_inactive")
        # 登录这里允许走 5 分钟的部门缓存，早高峰大量员工同时登录时不会
        # 把 list_departments 接口打满；同步任务会主动刷缓存。
        department_name_map = await _wecom_client.get_department_name_map(use_cache=True)
    except WecomApiError as exc:
        raise WecomAuthError(str(exc), code="wecom_api_error") from exc

    mobile = get_wecom_member_mobile(member)
    user = (
        await db.execute(select(User).where(User.wecom_userid == userid))
    ).scalar_one_or_none()
    if user is None and mobile:
        user = (
            await db.execute(select(User).where(User.username == mobile))
        ).scalar_one_or_none()
    if user is None:
        raise WecomAuthError("账号未开通，请联系管理员。", code="wecom_account_not_found")
    if user.disabled or (user.status or "").lower() == "inactive":
        raise WecomAuthError("账号已被禁用，请联系管理员。", code="wecom_account_disabled")

    apply_wecom_member_to_user(
        user,
        member,
        department_name_map=department_name_map,
        bind_userid=True,
        mark_disabled=False,
    )
    await db.flush()
    return user, member
