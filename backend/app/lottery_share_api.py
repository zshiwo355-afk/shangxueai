"""Short-lived employee-only card preview; outgoing cards keep customer URLs."""
from __future__ import annotations

import hashlib
import hmac
import logging
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import parse_qs, quote, urlsplit, urlunsplit

import httpx
import jwt
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from . import lottery_api as lottery
from .access import is_admin_like
from .auth import get_current_user
from .db import get_db
from .lottery_service import effective_campaign_status, utcnow_naive
from .lottery_policy import remaining_link_chances
from .models import LotteryCampaign, LotteryInviteLink, User
from .wechat_client import WechatApiError

logger = logging.getLogger(__name__)
router = APIRouter(tags=["lottery-employee-share"])
settings = lottery.settings
SHARE_TTL_SECONDS = 15 * 60
_AUDIENCE = "lottery-employee-share-preview"
_PURPOSE = "lottery-card-preview"
_MENU_APIS = [
    "showOptionMenu", "showMenuItems", "hideMenuItems",
    "updateAppMessageShareData", "onMenuShareAppMessage",
]


class SharePreviewPayload(BaseModel):
    ticket: str = Field(min_length=20, max_length=4096)
    url: str = Field(min_length=1, max_length=4096)


class DirectSharePayload(BaseModel):
    url: str = Field(min_length=1, max_length=4096)


def _ticket_key() -> bytes:
    # A preview bearer must never be accepted by the application's login JWT.
    return hmac.new(
        settings.jwt_secret.encode("utf-8"),
        b"shangxue:lottery:employee-share-preview:v1", hashlib.sha256,
    ).digest()


def _configured_origin() -> str:
    raw = settings.resolved_wecom_frontend_base_url.strip()
    try:
        parsed = urlsplit(raw)
        valid = (
            parsed.scheme in {"http", "https"} and parsed.hostname
            and not parsed.username and not parsed.password
            and parsed.path in {"", "/"} and not parsed.query and not parsed.fragment
        )
        # Accessing port validates malformed authorities.
        parsed.port
    except ValueError:
        valid = False
    if not valid:
        raise HTTPException(status_code=503, detail="请管理员配置正确的前端网站地址后再分享卡片。")
    return urlunsplit((parsed.scheme, parsed.netloc, "", "", ""))


def _sign_url(raw: str, public_code: str) -> str:
    origin = urlsplit(_configured_origin())
    try:
        parsed = urlsplit(raw.strip())
        same_origin = (
            parsed.scheme.lower() == origin.scheme.lower()
            and parsed.hostname == origin.hostname
            and (parsed.port if parsed.port is not None else (443 if parsed.scheme == "https" else 80))
            == (origin.port if origin.port is not None else (443 if origin.scheme == "https" else 80))
        )
        valid = (
            same_origin and not parsed.username and not parsed.password
            # The old path remains valid for already-issued 15-minute tickets.
            # A customer-specific path must match this exact signed ticket.
            and parsed.path in {"/lottery-share", f"/lottery-share/{quote(public_code, safe='')}"}
            and "ticket" not in parse_qs(parsed.query, keep_blank_values=True)
            and not any(ord(character) < 32 for character in raw)
        )
    except ValueError:
        valid = False
    if not valid:
        raise HTTPException(status_code=403, detail="分享签名地址无效，请从员工二维码重新打开。")
    return urlunsplit((parsed.scheme, parsed.netloc, parsed.path, parsed.query, ""))


def _issue_ticket(user: User, link: LotteryInviteLink) -> tuple[str, datetime]:
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(seconds=SHARE_TTL_SECONDS)
    token = jwt.encode({
        "sub": str(user.id), "aud": _AUDIENCE, "purpose": _PURPOSE,
        "link_id": int(link.id), "public_code": link.public_code,
        "iat": now, "exp": expires_at, "jti": secrets.token_urlsafe(12),
    }, _ticket_key(), algorithm="HS256")
    return token, expires_at


def _read_ticket(ticket: str) -> dict[str, Any]:
    try:
        payload = jwt.decode(ticket, _ticket_key(), algorithms=["HS256"], audience=_AUDIENCE,
                             options={"require": ["sub", "aud", "purpose", "link_id", "public_code", "iat", "exp"]})
        if (payload.get("purpose") != _PURPOSE or type(payload["link_id"]) is not int
                or payload["link_id"] <= 0 or not str(payload["sub"]).isdigit()
                or int(payload["sub"]) <= 0 or not isinstance(payload["public_code"], str)
                or not payload["public_code"]):
            raise jwt.InvalidTokenError("invalid preview purpose or identity")
        return payload
    except jwt.ExpiredSignatureError as exc:
        raise HTTPException(status_code=410, detail="员工分享二维码已过期，请回到员工页面重新生成。") from exc
    except jwt.InvalidTokenError as exc:
        raise HTTPException(status_code=403, detail="员工分享凭证无效，请重新生成二维码。") from exc


async def _share_context(
    db: AsyncSession, link_id: int, user: User | None, *, public_code: str | None = None,
) -> tuple[LotteryCampaign, LotteryInviteLink]:
    if not user or user.disabled:
        raise HTTPException(status_code=403, detail="员工账号已停用，无法继续分享。")
    try:
        link = await lottery._link_or_404(db, link_id)
        if public_code is not None and link.public_code != public_code:
            raise HTTPException(status_code=410, detail="该客户链接已失效。")
        if not is_admin_like(user) and int(link.created_by_user_id) != int(user.id):
            raise HTTPException(status_code=403, detail="只能分享自己创建的客户链接。")
        campaign = await lottery._campaign_or_404(db, int(link.campaign_id))
    except HTTPException as exc:
        if exc.status_code == 404:
            raise HTTPException(status_code=410, detail="活动或客户链接已失效，无法继续分享。") from exc
        raise
    await lottery._staff_access(db, campaign, user)
    if effective_campaign_status(campaign) not in {"published", "not_started"}:
        raise HTTPException(status_code=410, detail="活动未发布、已暂停或已结束，暂不能分享。")
    if link.status != "active" or (link.expires_at and utcnow_naive() > link.expires_at):
        raise HTTPException(status_code=410, detail="该客户链接已停用或过期。")
    return campaign, link


def _metadata(campaign: LotteryCampaign, link: LotteryInviteLink, request: Request) -> dict[str, Any]:
    return {
        "share": lottery.share_payload(campaign, link, request),
        "customer_name": link.customer_name,
        "remaining_chances": remaining_link_chances(link),
        "chance_limit": 1,
    }


def _no_cache(response: Response) -> None:
    response.headers["Cache-Control"] = "no-store"
    response.headers["Referrer-Policy"] = "no-referrer"


@router.post("/api/lottery/links/{link_id}/share-session")
async def create_share_session(
    link_id: int, request: Request, response: Response,
    db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user),
) -> dict[str, Any]:
    origin = _configured_origin()
    campaign, link = await _share_context(db, link_id, user)
    ticket, expires_at = _issue_ticket(user, link)
    _no_cache(response)
    return {
        **_metadata(campaign, link, request),
        "preview_url": f"{origin}/lottery-share/{quote(link.public_code, safe='')}#ticket={ticket}",
        "expires_at": lottery._iso(expires_at),
    }


def _empty_sdk() -> dict[str, Any]:
    return {"enabled": False, "corp_id": "", "app_id": "", "agent_id": 0,
            "timestamp": 0, "nonce_str": "", "signature": "", "js_api_list": []}


async def _build_sdk(builder, sign_url: str, api_list: list[str], label: str) -> tuple[dict[str, Any], str]:
    try:
        sdk = await builder(sign_url)
        return {**sdk, "js_api_list": list(api_list)}, ""
    except (WechatApiError, httpx.HTTPError) as exc:
        # Transport exception text may contain access_token URLs; never return it.
        code = getattr(exc, "errcode", None)
        suffix = f"（错误码 {code}）" if code is not None else ""
        logger.warning("lottery preview SDK unavailable platform=%s error_type=%s code=%s", label, type(exc).__name__, code)
        return _empty_sdk(), f"{label}签名失败{suffix}，请管理员检查应用配置、可信域名和服务器 IP 白名单。"


@router.post("/api/public/lottery/share-preview")
async def resolve_share_preview(
    payload: SharePreviewPayload, request: Request, response: Response,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    ticket = _read_ticket(payload.ticket)
    sign_url = _sign_url(payload.url, ticket["public_code"])
    user = await db.get(User, int(ticket["sub"]))
    campaign, link = await _share_context(db, ticket["link_id"], user, public_code=ticket["public_code"])
    metadata = _metadata(campaign, link, request)
    bundle = await _sdk_bundle(sign_url, metadata)
    _no_cache(response)
    return {**metadata, "expires_at": lottery._iso(datetime.fromtimestamp(ticket["exp"], timezone.utc)), **bundle}


async def _sdk_bundle(sign_url: str, metadata: dict[str, Any]) -> dict[str, Any]:
    wechat_configured = bool(settings.wechat_mp_ready)
    sdk, agent_sdk, wechat_sdk = _empty_sdk(), _empty_sdk(), _empty_sdk()
    # Keep the response keys for already-open clients, but do not request any
    # corporate credentials or signatures for the WeChat-only lottery flow.
    wecom_error = "抽奖分享仅支持普通微信。"
    wechat_error = "普通微信使用原生转发；未配置公众号 JS-SDK 自定义卡片参数。"
    if wechat_configured:
        wechat_sdk, wechat_error = await _build_sdk(lottery._wechat_mp_client.build_js_sdk_config, sign_url, _MENU_APIS, "普通微信")
    return {
        "sdk": sdk, "agent_sdk": agent_sdk, "wechat_sdk": wechat_sdk,
        "diagnostics": {
            "sign_url": sign_url, "share_url": metadata["share"]["url"],
            "lottery_url": metadata["share"]["lottery_url"],
            "wecom": {"configured": False, "enabled": False, "reason": wecom_error},
            "wecom_agent": {"configured": False, "enabled": False, "reason": wecom_error},
            "wechat": {"configured": wechat_configured, "enabled": bool(wechat_sdk.get("enabled")), "reason": wechat_error},
        },
    }


def _direct_sign_url(raw: str) -> str:
    origin = urlsplit(_configured_origin())
    try:
        parsed = urlsplit(raw.strip())
        same_origin = parsed.scheme == origin.scheme and parsed.hostname == origin.hostname and (
            parsed.port if parsed.port is not None else (443 if parsed.scheme == "https" else 80)
        ) == (origin.port if origin.port is not None else (443 if origin.scheme == "https" else 80))
        valid = (same_origin and not parsed.username and not parsed.password
                 and parsed.path in {"/lottery-workspace", "/admin/lottery"}
                 and "ticket" not in parse_qs(parsed.query, keep_blank_values=True)
                 and not any(ord(character) < 32 for character in raw))
    except ValueError:
        valid = False
    if not valid:
        raise HTTPException(status_code=403, detail="请在员工客户抽奖页面或活动管理页面发起分享。")
    return urlunsplit((parsed.scheme, parsed.netloc, parsed.path, parsed.query, ""))


@router.post("/api/lottery/links/{link_id}/share-config")
async def direct_share_config(
    link_id: int, payload: DirectSharePayload, request: Request, response: Response,
    db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user),
) -> dict[str, Any]:
    sign_url = _direct_sign_url(payload.url)
    campaign, link = await _share_context(db, link_id, user)
    metadata = _metadata(campaign, link, request)
    bundle = await _sdk_bundle(sign_url, metadata)
    _no_cache(response)
    return {**metadata, **bundle}
