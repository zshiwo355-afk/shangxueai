"""双十一客户抽奖的公开、员工和管理员接口。"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import mimetypes
import re
import secrets
from datetime import datetime, timezone
from typing import Any, Literal
from urllib.parse import quote

import oss2
import httpx
from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import case, desc, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from .access import is_admin_like
from .auth import get_current_user, require_admin
from .config import get_settings
from .db import get_db
from .lottery_time import format_db_timestamp as _iso_db
from .lottery_policy import SINGLE_DRAW_LIMIT, remaining_link_chances, winner_display_name
from .lottery_service import (
    CAMPAIGN_STATUSES,
    PRIZE_TYPES,
    count_link_wins,
    effective_campaign_status,
    ensure_pending_claim_for_win,
    execute_draw,
    find_missing_lottery_claims,
    receipt_state,
    winning_summary,
    utcnow_naive,
    validate_probability_config,
)
from .magic_academy_api._oss import (
    MAX_READING_IMAGE_SIZE,
    _build_oss_bucket,
    _build_object_key_and_name,
    _build_oss_object_url,
    _build_public_base_url,
    _ensure_oss_settings,
    _upload_binary_to_oss,
    _validate_reading_image_payload,
)
from .magic_academy_api._video_helpers import _get_material_asset_or_403
from .models import (
    LotteryAuditLog,
    LotteryCampaign,
    LotteryCampaignStaff,
    LotteryClaim,
    LotteryDraw,
    LotteryInviteLink,
    LotteryLinkActionLog,
    LotteryPrize,
    User,
)
from .wechat_client import WechatApiError, WechatMpClient


logger = logging.getLogger(__name__)
settings = get_settings()

admin_router = APIRouter(prefix="/api/admin/lottery", tags=["lottery-admin"])
employee_router = APIRouter(prefix="/api/lottery", tags=["lottery-employee"])
public_router = APIRouter(prefix="/api/public/lottery", tags=["lottery-public"])

_wechat_mp_client = WechatMpClient()
_PHONE_RE = re.compile(r"^[0-9+()\-\s]{6,32}$")


def _iso(value: datetime | None) -> str | None:
    if not value:
        return None
    if value.tzinfo is None:
        return f"{value.isoformat(timespec='seconds')}Z"
    return value.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _page(items: list[dict[str, Any]], total: int, page: int, page_size: int) -> dict[str, Any]:
    return {"items": items, "total": int(total), "page": int(page), "page_size": int(page_size)}


def _parse_datetime(value: str | None, field_name: str) -> datetime | None:
    text = (value or "").strip()
    if not text:
        return None
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        if parsed.tzinfo is not None:
            parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)
        return parsed
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"{field_name}格式不正确。") from exc


def _public_base(request: Request) -> str:
    return (settings.resolved_wecom_frontend_base_url or str(request.base_url)).rstrip("/")


def _object_public_url(object_key: str) -> str:
    key = (object_key or "").strip()
    if not key:
        return ""
    oss_settings = _ensure_oss_settings()
    base = _build_public_base_url(
        oss_settings["bucket"],
        oss_settings["endpoint"],
        settings.oss_public_base_url,
    )
    return _build_oss_object_url(base, key)


async def _resolve_image_reference(
    db: AsyncSession,
    admin: User,
    *,
    material_asset_id: int | None,
    image_url: str | None,
    object_key: str | None,
) -> tuple[int | None, str, str]:
    if material_asset_id:
        asset = await _get_material_asset_or_403(
            db,
            int(material_asset_id),
            admin,
            expected_type="image",
        )
        if (asset.status or "active").strip().lower() != "active":
            raise HTTPException(status_code=400, detail="所选图片素材当前不可用。")
        key = (asset.object_key or "").strip()
        if not key:
            raise HTTPException(status_code=400, detail="所选图片素材缺少文件地址。")
        return int(asset.id), _object_public_url(key), key
    key = (object_key or "").strip()
    url = (image_url or "").strip() or _object_public_url(key)
    return None, url, key


def build_lottery_url(request: Request, public_code: str) -> str:
    return f"{_public_base(request)}/lottery/{quote(public_code, safe='')}"


def build_lottery_share_url(request: Request, public_code: str) -> str:
    # Bump the stable card revision when the server-side preview contract
    # changes. WeChat caches link previews aggressively by URL.
    return f"{_public_base(request)}/share/lottery/{quote(public_code, safe='')}?card=3"


def build_lottery_share_image_url(request: Request, public_code: str, config_version: int) -> str:
    code = quote(public_code, safe="")
    version = max(int(config_version or 1), 1)
    return f"{_public_base(request)}/api/public/lottery/{code}/share-image.jpg?v={version}"


def _campaign_status_label(status: str) -> str:
    return {
        "draft": "草稿",
        "not_started": "未开始",
        "published": "进行中",
        "paused": "已暂停",
        "ended": "已结束",
        "deleted": "已删除",
    }.get(status, status)


def campaign_to_dict(campaign: LotteryCampaign, *, public: bool = False) -> dict[str, Any]:
    deleted = campaign.deleted_at is not None
    effective = "deleted" if deleted else effective_campaign_status(campaign)
    result: dict[str, Any] = {
        "id": int(campaign.id),
        "slug": campaign.slug,
        "title": campaign.title,
        "description": campaign.description or "",
        "rules_text": campaign.rules_text or "",
        "status": effective if public or deleted else (campaign.status or "draft"),
        "effective_status": effective,
        "status_label": _campaign_status_label(effective),
        "start_at": _iso(campaign.start_at),
        "end_at": _iso(campaign.end_at),
        "max_chances_per_link": SINGLE_DRAW_LIMIT,
        "hero_image_url": campaign.hero_image_url or "",
        "share_title": campaign.share_title or "",
        "share_desc": campaign.share_desc or "",
        "share_image_url": campaign.share_image_url or "",
        "config_version": int(campaign.config_version or 1),
        "created_at": _iso_db(campaign.created_at),
        "updated_at": _iso_db(campaign.updated_at),
        "can_create_links": not deleted and effective in {"published", "not_started"},
    }
    if not public:
        result.update(
            {
                # Keep the legacy response field for old clients, but link
                # creation is unlimited for every authorized employee.
                "max_links_per_employee": 0,
                "hero_image_object_key": campaign.hero_image_object_key or "",
                "hero_image_material_asset_id": int(campaign.hero_image_material_asset_id)
                if campaign.hero_image_material_asset_id
                else None,
                "share_image_object_key": campaign.share_image_object_key or "",
                "share_image_material_asset_id": int(campaign.share_image_material_asset_id)
                if campaign.share_image_material_asset_id
                else None,
                "created_by": int(campaign.created_by),
                "updated_by": int(campaign.updated_by) if campaign.updated_by else None,
                "deleted_at": _iso(campaign.deleted_at),
            }
        )
    return result


def prize_to_dict(prize: LotteryPrize, *, public: bool = False) -> dict[str, Any]:
    result: dict[str, Any] = {
        "id": int(prize.id),
        "name": prize.name,
        "description": prize.description or "",
        "type": prize.type,
        "image_url": prize.image_url or "",
        "sort_order": int(prize.sort_order or 0),
    }
    if not public:
        result.update(
            {
                "campaign_id": int(prize.campaign_id),
                "image_object_key": prize.image_object_key or "",
                "image_material_asset_id": int(prize.image_material_asset_id)
                if prize.image_material_asset_id
                else None,
                "probability_ppm": int(prize.probability_ppm or 0),
                "probability_percent": round(int(prize.probability_ppm or 0) / 10_000, 4),
                "stock_total": int(prize.stock_total or 0),
                "stock_awarded": int(prize.stock_awarded or 0),
                "stock_remaining": max(int(prize.stock_total or 0) - int(prize.stock_awarded or 0), 0)
                if prize.type != "no_win"
                else None,
                "enabled": bool(prize.enabled),
                "created_at": _iso_db(prize.created_at),
                "updated_at": _iso_db(prize.updated_at),
            }
        )
    return result


def link_to_dict(
    link: LotteryInviteLink,
    *,
    request: Request | None = None,
    creator: User | None = None,
    public: bool = False,
    win_count: int = 0,
) -> dict[str, Any]:
    remaining = remaining_link_chances(link)
    result: dict[str, Any] = {
        "id": int(link.id),
        "code": link.public_code,
        "public_code": link.public_code,
        "customer_name": link.customer_name,
        "chance_total": int(link.chance_total or 0),
        "chance_used": int(link.chance_used or 0),
        "chance_limit": SINGLE_DRAW_LIMIT,
        "remaining_chances": remaining,
        "status": link.status or "active",
        "expires_at": _iso(link.expires_at),
        "last_draw_at": _iso(link.last_draw_at),
        "created_at": _iso_db(link.created_at),
    }
    if request:
        result["public_url"] = build_lottery_url(request, link.public_code)
        result["share_url"] = build_lottery_share_url(request, link.public_code)
    if not public:
        result.update(
            {
                "campaign_id": int(link.campaign_id),
                "customer_code": link.customer_code or "",
                "customer_note": link.customer_note or "",
                "created_by_user_id": int(link.created_by_user_id),
                "created_by_name": ((creator.real_name or creator.display_name or creator.username) if creator else ""),
                "last_opened_at": _iso(link.last_opened_at),
                "version": int(link.version or 1),
                "updated_at": _iso_db(link.updated_at),
                "receipt": receipt_to_dict(link, win_count, public=False),
            }
        )
    return result


def receipt_to_dict(link: LotteryInviteLink, win_count: int, *, public: bool = True) -> dict[str, Any]:
    result = receipt_state(link, win_count)
    if not public:
        result.update({
            "recipient_name": link.recipient_name or "",
            "recipient_phone": link.recipient_phone or "",
            "recipient_address": link.recipient_address or "",
            "submitted_at": _iso(link.receipt_submitted_at),
        })
    return result


def draw_to_dict(draw: LotteryDraw, claim: LotteryClaim | None = None) -> dict[str, Any]:
    return {
        "id": int(draw.id),
        "campaign_id": int(draw.campaign_id),
        "invite_link_id": int(draw.invite_link_id),
        "draw_sequence": int(draw.draw_sequence),
        "result_type": draw.result_type,
        "prize_id": int(draw.prize_id) if draw.prize_id else None,
        "prize_type": draw.prize_type_snapshot or "",
        "prize_name": draw.prize_name_snapshot or "",
        "prize_image_url": draw.prize_image_url_snapshot or "",
        # Any committed draw exhausts the current single-use policy, including
        # a replay of a historical draw that originally had more turns left.
        "remaining_chances": 0,
        "claim_required": draw.result_type == "win",
        "claim_status": claim.status if claim else ("unclaimed" if draw.result_type == "win" else "not_required"),
        "config_version": int(draw.config_version),
        "created_at": _iso(draw.created_at),
    }


def link_action_to_dict(item: LotteryLinkActionLog) -> dict[str, Any]:
    before_total = int(item.before_chance_total or 0)
    after_total = int(item.after_chance_total or 0)
    return {
        "id": int(item.id),
        "invite_link_id": int(item.invite_link_id),
        "campaign_id": int(item.campaign_id),
        "action": item.action,
        "before_chance_total": before_total,
        "after_chance_total": after_total,
        # 兼容前端较短字段名。
        "before_total": before_total,
        "after_total": after_total,
        "delta": int(item.delta or 0),
        "reason": item.reason or "",
        "operator_id": int(item.operator_id),
        "created_at": _iso_db(item.created_at),
    }


def claim_revision(claim: LotteryClaim) -> str:
    # Hash raw persisted values rather than presentation-time timezone strings.
    values = [
        int(claim.id), claim.status, claim.operator_id, claim.operator_remark or "",
        claim.recipient_name, claim.recipient_phone or "", claim.recipient_address or "",
        claim.fulfilled_at.isoformat() if claim.fulfilled_at else None,
        claim.updated_at.isoformat() if claim.updated_at else None,
    ]
    return hashlib.sha256(json.dumps(values, ensure_ascii=False, separators=(",", ":")).encode("utf-8")).hexdigest()


def claim_to_dict(claim: LotteryClaim, *, public: bool = False) -> dict[str, Any]:
    if public:
        return {
            "id": int(claim.id),
            "draw_id": int(claim.draw_id),
            "status": claim.status,
            "created_at": _iso_db(claim.created_at),
            "updated_at": _iso_db(claim.updated_at),
        }
    result = {
        "id": int(claim.id),
        "draw_id": int(claim.draw_id),
        "recipient_name": claim.recipient_name,
        "recipient_phone": claim.recipient_phone or "",
        "status": claim.status,
        "created_at": _iso_db(claim.created_at),
        "updated_at": _iso_db(claim.updated_at),
    }
    if not public:
        result.update(
            {
                "campaign_id": int(claim.campaign_id),
                "invite_link_id": int(claim.invite_link_id),
                "recipient_address": claim.recipient_address or "",
                "operator_id": int(claim.operator_id) if claim.operator_id else None,
                "operator_remark": claim.operator_remark or "",
                "fulfilled_at": _iso(claim.fulfilled_at),
                "revision": claim_revision(claim),
            }
        )
    return result


def share_payload(campaign: LotteryCampaign, link: LotteryInviteLink, request: Request) -> dict[str, str]:
    title = (campaign.share_title or "").strip() or campaign.title
    description = (campaign.share_desc or "").strip() or campaign.description or "点击参与客户专属抽奖"
    image_object_key = (campaign.share_image_object_key or "").strip() or (campaign.hero_image_object_key or "").strip()
    image = (
        build_lottery_share_image_url(request, link.public_code, int(campaign.config_version or 1))
        if image_object_key
        else ((campaign.share_image_url or "").strip() or (campaign.hero_image_url or "").strip())
    )
    return {
        "title": title,
        "description": description,
        "image": image,
        "url": build_lottery_share_url(request, link.public_code),
        "lottery_url": build_lottery_url(request, link.public_code),
    }


async def get_public_lottery_meta(db: AsyncSession, public_code: str, request: Request) -> dict[str, str] | None:
    row = (
        await db.execute(
            select(LotteryCampaign, LotteryInviteLink)
            .join(LotteryInviteLink, LotteryInviteLink.campaign_id == LotteryCampaign.id)
            .where(
                LotteryInviteLink.public_code == public_code,
                LotteryCampaign.deleted_at.is_(None),
            )
        )
    ).first()
    if not row:
        return None
    campaign, link = row
    if campaign.status == "draft":
        return None
    payload = share_payload(campaign, link, request)
    return {**payload, "live_url": payload["lottery_url"]}


async def _campaign_or_404(
    db: AsyncSession,
    campaign_id: int,
    *,
    lock: bool = False,
    allow_deleted: bool = False,
) -> LotteryCampaign:
    if lock:
        campaign = (
            await db.execute(
                select(LotteryCampaign).where(LotteryCampaign.id == campaign_id).with_for_update()
            )
        ).scalar_one_or_none()
    else:
        campaign = await db.get(LotteryCampaign, campaign_id)
    if not campaign or (campaign.deleted_at is not None and not allow_deleted):
        raise HTTPException(status_code=404, detail="抽奖活动不存在。")
    return campaign


async def _locked_prize_and_campaign(
    db: AsyncSession,
    prize_id: int,
) -> tuple[LotteryPrize, LotteryCampaign]:
    """按 campaign -> prize 的固定顺序加锁，避免发布与奖品编辑并发交错。"""

    campaign_id = (
        await db.execute(
            select(LotteryPrize.campaign_id).where(
                LotteryPrize.id == prize_id,
                LotteryPrize.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if campaign_id is None:
        raise HTTPException(status_code=404, detail="奖品不存在。")
    campaign = await _campaign_or_404(db, int(campaign_id), lock=True)
    prize = (
        await db.execute(
            select(LotteryPrize)
            .where(
                LotteryPrize.id == prize_id,
                LotteryPrize.campaign_id == int(campaign.id),
                LotteryPrize.deleted_at.is_(None),
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    if not prize:
        raise HTTPException(status_code=404, detail="奖品不存在。")
    return prize, campaign


async def _link_or_404(db: AsyncSession, link_id: int, *, lock: bool = False) -> LotteryInviteLink:
    stmt = select(LotteryInviteLink).where(LotteryInviteLink.id == link_id)
    if lock:
        stmt = stmt.with_for_update()
    link = (await db.execute(stmt)).scalar_one_or_none()
    if not link:
        raise HTTPException(status_code=404, detail="客户抽奖链接不存在。")
    return link


async def _staff_access(
    db: AsyncSession,
    campaign: LotteryCampaign,
    user: User,
    *,
    lock: bool = False,
) -> LotteryCampaignStaff | None:
    if is_admin_like(user):
        return None
    stmt = select(LotteryCampaignStaff).where(
        LotteryCampaignStaff.campaign_id == int(campaign.id),
        LotteryCampaignStaff.user_id == int(user.id),
        LotteryCampaignStaff.enabled.is_(True),
    )
    if lock:
        stmt = stmt.with_for_update()
    staff = (await db.execute(stmt)).scalar_one_or_none()
    if not staff:
        raise HTTPException(status_code=403, detail="你没有该抽奖活动的客户链接权限。")
    return staff


def _staff_chance_cap(campaign: LotteryCampaign, staff: LotteryCampaignStaff | None) -> int:
    return SINGLE_DRAW_LIMIT


def _staff_link_quota(campaign: LotteryCampaign, staff: LotteryCampaignStaff | None) -> int:
    # Old database values remain available in historical audit records; they
    # no longer restrict link creation, including before an activity is edited.
    return 0


async def _audit(
    db: AsyncSession,
    *,
    campaign_id: int | None,
    entity_type: str,
    entity_id: int | None,
    action: str,
    operator_id: int,
    before: dict[str, Any] | None = None,
    after: dict[str, Any] | None = None,
) -> None:
    db.add(
        LotteryAuditLog(
            campaign_id=campaign_id,
            entity_type=entity_type,
            entity_id=entity_id,
            action=action,
            before_json=json.dumps(before, ensure_ascii=False, default=str) if before is not None else None,
            after_json=json.dumps(after, ensure_ascii=False, default=str) if after is not None else None,
            operator_id=operator_id,
        )
    )


async def _campaign_stats(db: AsyncSession, campaign_id: int) -> dict[str, int]:
    link_count = int(
        (
            await db.execute(
                select(func.count()).select_from(LotteryInviteLink).where(
                    LotteryInviteLink.campaign_id == campaign_id
                )
            )
        ).scalar_one()
    )
    draw_count, win_count = (
        await db.execute(
            select(
                func.count(LotteryDraw.id),
                func.coalesce(func.sum(case((LotteryDraw.result_type == "win", 1), else_=0)), 0),
            ).where(LotteryDraw.campaign_id == campaign_id)
        )
    ).one()
    pending_claim_count = int(
        (
            await db.execute(
                select(func.count()).select_from(LotteryClaim).where(
                    LotteryClaim.campaign_id == campaign_id,
                    LotteryClaim.status.in_(["pending", "contacted"]),
                )
            )
        ).scalar_one()
    )
    return {
        "link_count": link_count,
        "draw_count": int(draw_count or 0),
        "win_count": int(win_count or 0),
        "pending_claim_count": pending_claim_count,
    }


def _ensure_prize_editable(campaign: LotteryCampaign) -> None:
    if campaign.status == "published":
        raise HTTPException(status_code=409, detail="新增、删除或启停奖品请先暂停活动；已发布活动可编辑奖品资料，概率请使用“调整概率”统一保存。")


class CampaignPayload(BaseModel):
    slug: str | None = Field(default=None, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")
    title: str = Field(..., min_length=1, max_length=120)
    description: str = Field(default="", max_length=500)
    rules_text: str = Field(default="", max_length=10000)
    start_at: str | None = None
    end_at: str | None = None
    max_chances_per_link: int = Field(default=SINGLE_DRAW_LIMIT, ge=1, le=SINGLE_DRAW_LIMIT)
    max_links_per_employee: int = Field(default=0, ge=0, le=100000)
    hero_image_url: str = Field(default="", max_length=2048)
    hero_image_object_key: str = Field(default="", max_length=1024)
    hero_image_material_asset_id: int | None = Field(default=None, ge=1)
    share_title: str = Field(default="", max_length=120)
    share_desc: str = Field(default="", max_length=300)
    share_image_url: str = Field(default="", max_length=2048)
    share_image_object_key: str = Field(default="", max_length=1024)
    share_image_material_asset_id: int | None = Field(default=None, ge=1)

    @field_validator("title", "description", "rules_text", "hero_image_url", "hero_image_object_key", "share_title", "share_desc", "share_image_url", "share_image_object_key", mode="before")
    @classmethod
    def _strip(cls, value: str) -> str:
        return (value or "").strip()


class CampaignUpdatePayload(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=500)
    rules_text: str | None = Field(default=None, max_length=10000)
    start_at: str | None = None
    end_at: str | None = None
    max_chances_per_link: int | None = Field(default=None, ge=1, le=SINGLE_DRAW_LIMIT)
    max_links_per_employee: int | None = Field(default=None, ge=0, le=100000)
    hero_image_url: str | None = Field(default=None, max_length=2048)
    hero_image_object_key: str | None = Field(default=None, max_length=1024)
    hero_image_material_asset_id: int | None = Field(default=None, ge=1)
    share_title: str | None = Field(default=None, max_length=120)
    share_desc: str | None = Field(default=None, max_length=300)
    share_image_url: str | None = Field(default=None, max_length=2048)
    share_image_object_key: str | None = Field(default=None, max_length=1024)
    share_image_material_asset_id: int | None = Field(default=None, ge=1)

    @field_validator("title", "description", "rules_text", "hero_image_url", "hero_image_object_key", "share_title", "share_desc", "share_image_url", "share_image_object_key", mode="before")
    @classmethod
    def _strip_optional(cls, value: str | None) -> str | None:
        return value.strip() if isinstance(value, str) else value


class CampaignStatusPayload(BaseModel):
    status: str

    @field_validator("status")
    @classmethod
    def _status(cls, value: str) -> str:
        status = (value or "").strip().lower()
        if status not in CAMPAIGN_STATUSES:
            raise ValueError("不支持的活动状态。")
        return status


class PrizeProbabilityPayload(BaseModel):
    prize_id: int = Field(..., ge=1, strict=True)
    probability_ppm: int = Field(..., ge=0, le=1_000_000, strict=True)


class CampaignProbabilitiesPayload(BaseModel):
    config_version: int = Field(..., ge=1, strict=True)
    probabilities: list[PrizeProbabilityPayload] = Field(..., min_length=1, max_length=12)


class PrizePayload(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    description: str = Field(default="", max_length=500)
    type: str = "physical"
    image_url: str = Field(default="", max_length=2048)
    image_object_key: str = Field(default="", max_length=1024)
    image_material_asset_id: int | None = Field(default=None, ge=1)
    probability_ppm: int = Field(default=0, ge=0, le=1_000_000)
    stock_total: int = Field(default=0, ge=0, le=1_000_000_000)
    enabled: bool = True
    sort_order: int = Field(default=0, ge=-100000, le=100000)

    @field_validator("name", "description", "image_url", "image_object_key", mode="before")
    @classmethod
    def _strip_text(cls, value: str) -> str:
        return (value or "").strip()

    @field_validator("type")
    @classmethod
    def _type(cls, value: str) -> str:
        value = (value or "physical").strip().lower()
        if value not in PRIZE_TYPES:
            raise ValueError("不支持的奖品类型。")
        return value


class PrizeUpdatePayload(BaseModel):
    config_version: int | None = Field(default=None, ge=1, strict=True)
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=500)
    type: str | None = None
    image_url: str | None = Field(default=None, max_length=2048)
    image_object_key: str | None = Field(default=None, max_length=1024)
    image_material_asset_id: int | None = Field(default=None, ge=1)
    probability_ppm: int | None = Field(default=None, ge=0, le=1_000_000)
    stock_total: int | None = Field(default=None, ge=0, le=1_000_000_000)
    enabled: bool | None = None
    sort_order: int | None = Field(default=None, ge=-100000, le=100000)

    @field_validator("name", "description", "type", "probability_ppm", "stock_total", "enabled", "sort_order", mode="before")
    @classmethod
    def _non_nullable_value(cls, value: Any) -> Any:
        # Optional fields may be omitted, but explicit null must not erase a
        # required database value or bypass live-configuration comparisons.
        if value is None:
            raise ValueError("奖品字段不能设为空值。")
        return value

    @field_validator("name", "description", "image_url", "image_object_key", mode="before")
    @classmethod
    def _strip_text(cls, value: str | None) -> str | None:
        return value.strip() if isinstance(value, str) else value

    @field_validator("type")
    @classmethod
    def _type(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip().lower()
        if value not in PRIZE_TYPES:
            raise ValueError("不支持的奖品类型。")
        return value


class PrizeStatusPayload(BaseModel):
    enabled: bool


class StaffAssignment(BaseModel):
    user_id: int = Field(..., ge=1)
    enabled: bool = True
    link_quota: int = Field(default=0, ge=0, le=100000)
    # Retain acceptance of a historical value when revoking an old assignment.
    # Enabled assignments are validated against the current policy below.
    max_chances_per_link: int = Field(default=SINGLE_DRAW_LIMIT, ge=0, le=100)


class StaffPayload(BaseModel):
    assignments: list[StaffAssignment] = Field(default_factory=list, max_length=10000)


class LinkCreatePayload(BaseModel):
    campaign_id: int = Field(..., ge=1)
    customer_name: str = Field(..., min_length=1, max_length=120)
    customer_code: str = Field(default="", max_length=120)
    customer_note: str = Field(default="", max_length=500)
    chance_total: int = Field(default=SINGLE_DRAW_LIMIT, ge=1, le=SINGLE_DRAW_LIMIT, strict=True)
    expires_at: str | None = None

    @field_validator("customer_name", "customer_code", "customer_note", mode="before")
    @classmethod
    def _strip_text(cls, value: str) -> str:
        return (value or "").strip()


class LinkActionPayload(BaseModel):
    action: Literal["adjust", "disable", "enable"]
    chance_total: int | None = Field(default=None, ge=1, le=100)
    reason: str = Field(default="", max_length=500)


class DrawPayload(BaseModel):
    request_id: str = Field(..., min_length=8, max_length=64, pattern=r"^[A-Za-z0-9._:-]+$")
    expected_draw_sequence: int | None = Field(default=None, ge=1, strict=True)


class ClaimPayload(BaseModel):
    recipient_name: str = Field(..., min_length=1, max_length=120)
    recipient_phone: str = Field(..., min_length=6, max_length=32)
    recipient_address: str | None = Field(default="", max_length=500)

    @field_validator("recipient_name", "recipient_address", mode="before")
    @classmethod
    def _strip_text(cls, value: str | None) -> str:
        return (value or "").strip()

    @field_validator("recipient_phone")
    @classmethod
    def _phone(cls, value: str) -> str:
        value = (value or "").strip()
        if not _PHONE_RE.fullmatch(value) or len(re.sub(r"\D", "", value)) < 6:
            raise ValueError("联系电话格式不正确。")
        return value


class ReceiptPayload(ClaimPayload):
    recipient_address: str = Field(..., min_length=1, max_length=500)


class ClaimStatusPayload(BaseModel):
    status: Literal["pending", "contacted", "fulfilled", "cancelled"]
    remark: str = Field(default="", max_length=500)
    expected_revision: str = Field(..., min_length=64, max_length=64, pattern=r"^[0-9a-f]{64}$")


@admin_router.post("/upload-image")
async def upload_lottery_image(
    file: UploadFile = File(...),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    """上传抽奖活动或奖品图片到 OSS，保存时再绑定到具体业务记录。"""
    del admin
    file_name = (file.filename or "lottery-image.jpg").strip() or "lottery-image.jpg"
    raw = await file.read(MAX_READING_IMAGE_SIZE + 1)
    mime_type = (file.content_type or "").strip() or mimetypes.guess_type(file_name)[0] or "image/jpeg"
    extension = _validate_reading_image_payload(file_name, len(raw), mime_type)
    object_key, _stored_name = _build_object_key_and_name(file_name, extension)
    await asyncio.to_thread(_upload_binary_to_oss, object_key, raw, mime_type)
    return {
        "url": _object_public_url(object_key),
        "object_key": object_key,
        "mime_type": mime_type,
        "file_name": file_name,
        "file_size": len(raw),
    }


@admin_router.get("/campaigns")
async def admin_campaigns(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    keyword: str = Query("", max_length=120),
    status: str = Query("", max_length=16),
    include_deleted: bool = Query(False),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
) -> dict[str, Any]:
    filters = [] if include_deleted else [LotteryCampaign.deleted_at.is_(None)]
    if keyword.strip():
        filters.append(LotteryCampaign.title.like(f"%{keyword.strip()}%"))
    if status.strip().lower() == "deleted":
        filters.append(LotteryCampaign.deleted_at.is_not(None))
    elif status.strip():
        filters.append(LotteryCampaign.status == status.strip().lower())
        filters.append(LotteryCampaign.deleted_at.is_(None))
    total = int((await db.execute(select(func.count()).select_from(LotteryCampaign).where(*filters))).scalar_one())
    rows = list(
        (
            await db.execute(
                select(LotteryCampaign)
                .where(*filters)
                .order_by(desc(LotteryCampaign.created_at), desc(LotteryCampaign.id))
                .offset((page - 1) * page_size)
                .limit(page_size)
            )
        ).scalars()
    )
    items: list[dict[str, Any]] = []
    for campaign in rows:
        item = campaign_to_dict(campaign)
        item.update(await _campaign_stats(db, int(campaign.id)))
        items.append(item)
    return _page(items, total, page, page_size)


@admin_router.post("/campaigns")
async def create_campaign(
    payload: CampaignPayload,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    slug = (payload.slug or "").strip() or f"double11-{secrets.token_hex(5)}"
    if (await db.execute(select(LotteryCampaign.id).where(LotteryCampaign.slug == slug))).scalar_one_or_none():
        raise HTTPException(status_code=409, detail="活动标识已存在。")
    start_at = _parse_datetime(payload.start_at, "开始时间")
    end_at = _parse_datetime(payload.end_at, "结束时间")
    if start_at and end_at and start_at >= end_at:
        raise HTTPException(status_code=400, detail="结束时间必须晚于开始时间。")
    hero_asset_id, hero_url, hero_key = await _resolve_image_reference(
        db,
        admin,
        material_asset_id=payload.hero_image_material_asset_id,
        image_url=payload.hero_image_url,
        object_key=payload.hero_image_object_key,
    )
    share_asset_id, share_url, share_key = await _resolve_image_reference(
        db,
        admin,
        material_asset_id=payload.share_image_material_asset_id,
        image_url=payload.share_image_url,
        object_key=payload.share_image_object_key,
    )
    if not share_url and hero_url:
        share_asset_id, share_url, share_key = hero_asset_id, hero_url, hero_key
    campaign = LotteryCampaign(
        slug=slug,
        title=payload.title.strip(),
        description=payload.description,
        rules_text=payload.rules_text,
        start_at=start_at,
        end_at=end_at,
        max_chances_per_link=payload.max_chances_per_link,
        max_links_per_employee=0,
        hero_image_url=hero_url,
        hero_image_object_key=hero_key,
        hero_image_material_asset_id=hero_asset_id,
        share_title=payload.share_title,
        share_desc=payload.share_desc,
        share_image_url=share_url,
        share_image_object_key=share_key,
        share_image_material_asset_id=share_asset_id,
        created_by=int(admin.id),
        updated_by=int(admin.id),
    )
    db.add(campaign)
    await db.flush()
    # MySQL cannot RETURNING server-default timestamps.  Refresh explicitly so
    # response serialization never triggers implicit async IO (MissingGreenlet).
    await db.refresh(campaign)
    await _audit(db, campaign_id=int(campaign.id), entity_type="campaign", entity_id=int(campaign.id), action="create", operator_id=int(admin.id), after=campaign_to_dict(campaign))
    return {"item": campaign_to_dict(campaign)}


@admin_router.get("/campaigns/{campaign_id}")
async def admin_campaign_detail(
    campaign_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
) -> dict[str, Any]:
    campaign = await _campaign_or_404(db, campaign_id, allow_deleted=True)
    prizes = list((await db.execute(select(LotteryPrize).where(LotteryPrize.campaign_id == campaign_id, LotteryPrize.deleted_at.is_(None)).order_by(LotteryPrize.sort_order, LotteryPrize.id))).scalars())
    item = {**campaign_to_dict(campaign), "prizes": [prize_to_dict(prize) for prize in prizes]}
    item.update(await _campaign_stats(db, campaign_id))
    return {"item": item}


@admin_router.delete("/campaigns/{campaign_id}")
async def delete_campaign(
    campaign_id: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    # Logical deletion disables participation without losing customer, draw,
    # fulfilment or audit history. Repeated DELETE requests are idempotent.
    campaign = await _campaign_or_404(db, campaign_id, lock=True, allow_deleted=True)
    if campaign.deleted_at is not None:
        return {"item": campaign_to_dict(campaign)}
    before = campaign_to_dict(campaign)
    campaign.deleted_at = utcnow_naive()
    campaign.status = "ended"
    campaign.updated_by = int(admin.id)
    campaign.config_version = int(campaign.config_version or 1) + 1
    await db.flush()
    await db.refresh(campaign)
    after = campaign_to_dict(campaign)
    await _audit(db, campaign_id=campaign_id, entity_type="campaign", entity_id=campaign_id, action="delete", operator_id=int(admin.id), before=before, after=after)
    return {"item": after}


@admin_router.put("/campaigns/{campaign_id}")
async def update_campaign(
    campaign_id: int,
    payload: CampaignUpdatePayload,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    campaign = await _campaign_or_404(db, campaign_id, lock=True)
    before = campaign_to_dict(campaign)
    values = payload.model_dump(exclude_unset=True)
    if "max_links_per_employee" in values:
        # Accept cached/legacy clients without restoring the retired quota.
        values["max_links_per_employee"] = 0
    hero_fields = {"hero_image_material_asset_id", "hero_image_url", "hero_image_object_key"}
    if hero_fields.intersection(values):
        asset_id, image_url, object_key = await _resolve_image_reference(
            db,
            admin,
            material_asset_id=values.get("hero_image_material_asset_id", campaign.hero_image_material_asset_id),
            image_url=values.get("hero_image_url", campaign.hero_image_url),
            object_key=values.get("hero_image_object_key", campaign.hero_image_object_key),
        )
        values.update(
            hero_image_material_asset_id=asset_id,
            hero_image_url=image_url,
            hero_image_object_key=object_key,
        )
    share_fields = {"share_image_material_asset_id", "share_image_url", "share_image_object_key"}
    if share_fields.intersection(values):
        asset_id, image_url, object_key = await _resolve_image_reference(
            db,
            admin,
            material_asset_id=values.get("share_image_material_asset_id", campaign.share_image_material_asset_id),
            image_url=values.get("share_image_url", campaign.share_image_url),
            object_key=values.get("share_image_object_key", campaign.share_image_object_key),
        )
        values.update(
            share_image_material_asset_id=asset_id,
            share_image_url=image_url,
            share_image_object_key=object_key,
        )
    for key, value in values.items():
        if key == "start_at":
            value = _parse_datetime(value, "开始时间")
        elif key == "end_at":
            value = _parse_datetime(value, "结束时间")
        elif isinstance(value, str):
            value = value.strip()
        setattr(campaign, key, value)
    if campaign.start_at and campaign.end_at and campaign.start_at >= campaign.end_at:
        raise HTTPException(status_code=400, detail="结束时间必须晚于开始时间。")
    campaign.updated_by = int(admin.id)
    campaign.config_version = int(campaign.config_version or 1) + 1
    await db.flush()
    await db.refresh(campaign)
    after = campaign_to_dict(campaign)
    await _audit(db, campaign_id=campaign_id, entity_type="campaign", entity_id=campaign_id, action="update", operator_id=int(admin.id), before=before, after=after)
    return {"item": after}


@admin_router.post("/campaigns/{campaign_id}/status")
async def update_campaign_status(
    campaign_id: int,
    payload: CampaignStatusPayload,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    campaign = await _campaign_or_404(db, campaign_id, lock=True)
    before = campaign_to_dict(campaign)
    current_status = campaign.status or "draft"
    if payload.status == current_status:
        return {"item": before}
    allowed_transitions = {
        "draft": {"published", "ended"},
        "published": {"paused", "ended"},
        "paused": {"published", "ended"},
        "ended": set(),
    }
    if payload.status not in allowed_transitions.get(current_status, set()):
        raise HTTPException(
            status_code=409,
            detail=f"活动状态不能从“{_campaign_status_label(current_status)}”变更为“{_campaign_status_label(payload.status)}”。",
        )
    if effective_campaign_status(campaign) == "ended" and payload.status != "ended":
        raise HTTPException(status_code=409, detail="活动时间已结束，只能将状态设为已结束。")
    if payload.status == "published":
        if campaign.start_at and campaign.end_at and campaign.start_at >= campaign.end_at:
            raise HTTPException(status_code=409, detail="活动时间配置不正确。")
        if campaign.end_at and campaign.end_at <= utcnow_naive():
            raise HTTPException(status_code=409, detail="活动结束时间已过，请先调整活动时间。")
        prizes = list((await db.execute(select(LotteryPrize).where(LotteryPrize.campaign_id == campaign_id, LotteryPrize.enabled.is_(True), LotteryPrize.deleted_at.is_(None)))).scalars())
        validate_probability_config(prizes)
    campaign.status = payload.status
    campaign.updated_by = int(admin.id)
    campaign.config_version = int(campaign.config_version or 1) + 1
    await db.flush()
    await db.refresh(campaign)
    after = campaign_to_dict(campaign)
    await _audit(db, campaign_id=campaign_id, entity_type="campaign", entity_id=campaign_id, action="status", operator_id=int(admin.id), before=before, after=after)
    return {"item": after}


@admin_router.get("/campaigns/{campaign_id}/prizes")
async def list_prizes(
    campaign_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
) -> dict[str, Any]:
    await _campaign_or_404(db, campaign_id, allow_deleted=True)
    rows = list((await db.execute(select(LotteryPrize).where(LotteryPrize.campaign_id == campaign_id, LotteryPrize.deleted_at.is_(None)).order_by(LotteryPrize.sort_order, LotteryPrize.id))).scalars())
    return {"items": [prize_to_dict(item) for item in rows]}


@admin_router.put("/campaigns/{campaign_id}/probabilities")
async def update_campaign_probabilities(
    campaign_id: int,
    payload: CampaignProbabilitiesPayload,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    # Draws and all configuration writes lock campaign before prize rows.
    # Thus a draw observes either the complete old or complete new allocation.
    campaign = await _campaign_or_404(db, campaign_id, lock=True)
    if int(campaign.config_version or 1) != payload.config_version:
        raise HTTPException(status_code=409, detail="活动配置已被其他操作更新，请刷新后重新调整概率。")
    prizes = list((await db.execute(
        select(LotteryPrize)
        .where(LotteryPrize.campaign_id == campaign_id, LotteryPrize.deleted_at.is_(None))
        .order_by(LotteryPrize.sort_order, LotteryPrize.id)
        .with_for_update()
    )).scalars())
    active = [prize for prize in prizes if prize.enabled]
    requested = {item.prize_id: item.probability_ppm for item in payload.probabilities}
    if len(requested) != len(payload.probabilities):
        raise HTTPException(status_code=400, detail="概率配置中存在重复奖品。")
    if set(requested) != {int(prize.id) for prize in active}:
        raise HTTPException(status_code=409, detail="请提交当前活动全部启用奖品的概率，奖品配置可能已变化，请刷新后重试。")
    # Validate detached values first: even failed validation must not leave a
    # partially edited ORM collection available to later code in this request.
    candidates = [LotteryPrize(
        id=int(prize.id), name=prize.name, type=prize.type,
        enabled=True, deleted_at=None, probability_ppm=requested[int(prize.id)],
        stock_total=prize.stock_total, stock_awarded=prize.stock_awarded,
    ) for prize in active]
    validate_probability_config(candidates)
    before = {"config_version": int(campaign.config_version or 1), "prizes": [prize_to_dict(prize) for prize in active]}
    for prize in active:
        prize.probability_ppm = requested[int(prize.id)]
        prize.updated_by = int(admin.id)
    campaign.updated_by = int(admin.id)
    campaign.config_version = int(campaign.config_version or 1) + 1
    await db.flush()
    await db.refresh(campaign)
    # MySQL update timestamps are expired by flush; refresh before serialization.
    for prize in active:
        await db.refresh(prize)
    after = {"config_version": int(campaign.config_version), "prizes": [prize_to_dict(prize) for prize in active]}
    await _audit(db, campaign_id=campaign_id, entity_type="campaign", entity_id=campaign_id, action="probabilities", operator_id=int(admin.id), before=before, after=after)
    return {"item": campaign_to_dict(campaign), "items": [prize_to_dict(prize) for prize in prizes]}


@admin_router.post("/campaigns/{campaign_id}/prizes")
async def create_prize(
    campaign_id: int,
    payload: PrizePayload,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    campaign = await _campaign_or_404(db, campaign_id, lock=True)
    _ensure_prize_editable(campaign)
    asset_id, image_url, object_key = await _resolve_image_reference(
        db,
        admin,
        material_asset_id=payload.image_material_asset_id,
        image_url=payload.image_url,
        object_key=payload.image_object_key,
    )
    prize_values = payload.model_dump()
    prize_values.update(
        image_material_asset_id=asset_id,
        image_url=image_url,
        image_object_key=object_key,
    )
    prize = LotteryPrize(campaign_id=campaign_id, created_by=int(admin.id), updated_by=int(admin.id), **prize_values)
    db.add(prize)
    campaign.config_version = int(campaign.config_version or 1) + 1
    await db.flush()
    await db.refresh(prize)
    after = prize_to_dict(prize)
    await _audit(db, campaign_id=campaign_id, entity_type="prize", entity_id=int(prize.id), action="create", operator_id=int(admin.id), after=after)
    return {"item": after}


@admin_router.put("/prizes/{prize_id}")
async def update_prize(
    prize_id: int,
    payload: PrizeUpdatePayload,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    prize, campaign = await _locked_prize_and_campaign(db, prize_id)
    current_version = int(campaign.config_version or 1)
    if campaign.status == "published" and payload.config_version is None:
        raise HTTPException(status_code=409, detail="请刷新活动后重新编辑奖品，以获取最新配置版本。")
    if payload.config_version is not None and payload.config_version != current_version:
        raise HTTPException(status_code=409, detail="活动配置已被其他操作更新，请刷新后重新编辑奖品。")
    before = prize_to_dict(prize)
    values = payload.model_dump(exclude_unset=True, exclude={"config_version"})
    if campaign.status == "published":
        if "probability_ppm" in values and values["probability_ppm"] != int(prize.probability_ppm or 0):
            raise HTTPException(status_code=409, detail="已发布活动的概率请使用“调整概率”统一保存。")
        if "enabled" in values and values["enabled"] != bool(prize.enabled):
            raise HTTPException(status_code=409, detail="启用或停用奖品请先暂停活动。")
        # Cached clients may include unchanged values. Do not use those values
        # to overwrite the locked allocation or enabled state.
        values.pop("probability_ppm", None)
        values.pop("enabled", None)
    next_type = values.get("type", prize.type)
    if next_type == "no_win" and values.get("enabled") is True:
        raise HTTPException(status_code=409, detail="不能启用历史“未中奖”奖项，请明确修改为真实奖品并配置库存和概率。")
    next_stock_total = 0 if next_type == "no_win" else values.get("stock_total", prize.stock_total)
    # Draws lock the same campaign and prize rows. Validate the freshly locked
    # awarded count before resolving images or assigning any ORM attribute.
    if int(next_stock_total or 0) < int(prize.stock_awarded or 0):
        raise HTTPException(status_code=409, detail="总库存不能小于已中奖数量。")
    if next_type == "no_win":
        values["stock_total"] = 0
    image_fields = {"image_material_asset_id", "image_url", "image_object_key"}
    if image_fields.intersection(values):
        asset_id, image_url, object_key = await _resolve_image_reference(
            db,
            admin,
            material_asset_id=values.get("image_material_asset_id", prize.image_material_asset_id),
            image_url=values.get("image_url", prize.image_url),
            object_key=values.get("image_object_key", prize.image_object_key),
        )
        values.update(
            image_material_asset_id=asset_id,
            image_url=image_url,
            image_object_key=object_key,
        )
    for key, value in values.items():
        if isinstance(value, str):
            value = value.strip()
        setattr(prize, key, value)
    prize.updated_by = int(admin.id)
    campaign.updated_by = int(admin.id)
    campaign.config_version = current_version + 1
    await db.flush()
    await db.refresh(prize)
    after = prize_to_dict(prize)
    await _audit(db, campaign_id=int(prize.campaign_id), entity_type="prize", entity_id=prize_id, action="update", operator_id=int(admin.id), before={**before, "config_version": current_version}, after={**after, "config_version": int(campaign.config_version)})
    return {"item": after}


@admin_router.post("/prizes/{prize_id}/status")
async def update_prize_status(
    prize_id: int,
    payload: PrizeStatusPayload,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    prize, campaign = await _locked_prize_and_campaign(db, prize_id)
    _ensure_prize_editable(campaign)
    before = prize_to_dict(prize)
    if payload.enabled and prize.type == "no_win":
        raise HTTPException(status_code=409, detail="不能启用历史“未中奖”奖项，请配置真实奖品。")
    prize.enabled = payload.enabled
    prize.updated_by = int(admin.id)
    campaign.config_version = int(campaign.config_version or 1) + 1
    await db.flush()
    await db.refresh(prize)
    after = prize_to_dict(prize)
    await _audit(db, campaign_id=int(prize.campaign_id), entity_type="prize", entity_id=prize_id, action="enable" if payload.enabled else "disable", operator_id=int(admin.id), before=before, after=after)
    return {"item": after}


@admin_router.delete("/prizes/{prize_id}")
async def delete_prize(
    prize_id: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, bool]:
    prize, campaign = await _locked_prize_and_campaign(db, prize_id)
    _ensure_prize_editable(campaign)
    before = prize_to_dict(prize)
    prize.enabled = False
    prize.deleted_at = utcnow_naive()
    prize.updated_by = int(admin.id)
    campaign.config_version = int(campaign.config_version or 1) + 1
    await _audit(db, campaign_id=int(prize.campaign_id), entity_type="prize", entity_id=prize_id, action="delete", operator_id=int(admin.id), before=before)
    return {"ok": True}


@admin_router.get("/campaigns/{campaign_id}/staff")
async def list_campaign_staff(
    campaign_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
) -> dict[str, Any]:
    await _campaign_or_404(db, campaign_id, allow_deleted=True)
    rows = (await db.execute(select(LotteryCampaignStaff, User).join(User, User.id == LotteryCampaignStaff.user_id).where(LotteryCampaignStaff.campaign_id == campaign_id).order_by(User.real_name, User.display_name, User.id))).all()
    return {
        "items": [
            {
                "id": int(item.id), "campaign_id": campaign_id, "user_id": int(user.id),
                "user_name": user.real_name or user.display_name or user.username,
                "department": user.department or "", "enabled": bool(item.enabled),
                "user_disabled": bool(user.disabled),
                "link_quota": 0,
                "max_chances_per_link": SINGLE_DRAW_LIMIT,
            }
            for item, user in rows
        ]
    }


@admin_router.put("/campaigns/{campaign_id}/staff")
async def replace_campaign_staff(
    campaign_id: int,
    payload: StaffPayload,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    campaign = await _campaign_or_404(db, campaign_id, lock=True)
    ids = [item.user_id for item in payload.assignments]
    if len(ids) != len(set(ids)):
        raise HTTPException(status_code=400, detail="员工授权列表存在重复用户。")
    for assignment in payload.assignments:
        if not assignment.enabled:
            # Revoking a historical row must remain possible after its user is
            # disabled or the activity limits have subsequently been lowered.
            continue
        if assignment.max_chances_per_link > SINGLE_DRAW_LIMIT:
            raise HTTPException(
                status_code=400,
                detail="每条客户链接仅可抽奖 1 次，不能设置更多次数。",
            )
    existing = {int(item.user_id): item for item in (await db.execute(select(LotteryCampaignStaff).where(LotteryCampaignStaff.campaign_id == campaign_id))).scalars()}
    if ids:
        users = {int(item.id): item for item in (await db.execute(select(User).where(User.id.in_(ids)))).scalars()}
        for assignment in payload.assignments:
            employee = users.get(assignment.user_id)
            historical_revocation = not assignment.enabled and assignment.user_id in existing
            if not historical_revocation and (not employee or bool(employee.disabled)):
                raise HTTPException(status_code=400, detail=f"员工不存在或已禁用：{assignment.user_id}")
    incoming = {item.user_id: item for item in payload.assignments}
    before = {str(user_id): {"enabled": bool(item.enabled), "link_quota": int(item.link_quota or 0), "max_chances_per_link": int(item.max_chances_per_link or 0)} for user_id, item in existing.items()}
    for user_id, row in existing.items():
        if user_id not in incoming:
            row.enabled = False
    for user_id, assignment in incoming.items():
        row = existing.get(user_id)
        if row:
            row.enabled = assignment.enabled
            row.link_quota = 0
            row.max_chances_per_link = SINGLE_DRAW_LIMIT
        else:
            db.add(LotteryCampaignStaff(campaign_id=campaign_id, user_id=user_id, enabled=assignment.enabled, link_quota=0, max_chances_per_link=SINGLE_DRAW_LIMIT, created_by=int(admin.id)))
    await db.flush()
    after = {str(item.user_id): {**item.model_dump(), "link_quota": 0, "max_chances_per_link": SINGLE_DRAW_LIMIT} for item in payload.assignments}
    await _audit(db, campaign_id=campaign_id, entity_type="staff", entity_id=campaign_id, action="replace", operator_id=int(admin.id), before=before, after=after)
    return await list_campaign_staff(campaign_id, db, admin)


@employee_router.get("/campaigns")
async def employee_campaigns(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    if is_admin_like(user):
        rows = list((await db.execute(select(LotteryCampaign).where(LotteryCampaign.status != "draft").order_by(desc(LotteryCampaign.created_at)))).scalars())
        return {"items": [campaign_to_dict(item) for item in rows]}
    rows = (
        await db.execute(
            select(LotteryCampaign, LotteryCampaignStaff)
            .join(LotteryCampaignStaff, LotteryCampaignStaff.campaign_id == LotteryCampaign.id)
            .where(LotteryCampaign.status != "draft", LotteryCampaignStaff.user_id == int(user.id), LotteryCampaignStaff.enabled.is_(True))
            .order_by(desc(LotteryCampaign.created_at))
        )
    ).all()
    items = []
    for campaign, staff in rows:
        item = campaign_to_dict(campaign)
        item["staff_limits"] = {
            "link_quota": _staff_link_quota(campaign, staff),
            "max_chances_per_link": _staff_chance_cap(campaign, staff),
        }
        items.append(item)
    return {"items": items}


async def _list_links_response(
    db: AsyncSession,
    request: Request,
    *,
    filters: list[Any],
    page: int,
    page_size: int,
) -> dict[str, Any]:
    count_stmt = (
        select(func.count())
        .select_from(LotteryInviteLink)
        .join(User, User.id == LotteryInviteLink.created_by_user_id)
        .where(*filters)
    )
    total = int((await db.execute(count_stmt)).scalar_one())
    rows = (
        await db.execute(
            select(LotteryInviteLink, User)
            .join(User, User.id == LotteryInviteLink.created_by_user_id)
            .where(*filters)
            .order_by(desc(LotteryInviteLink.created_at), desc(LotteryInviteLink.id))
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    ).all()
    link_ids = [int(link.id) for link, _ in rows]
    win_counts: dict[int, int] = {}
    if link_ids:
        win_counts = {
            int(link_id): int(count or 0)
            for link_id, count in (
                await db.execute(
                    select(LotteryDraw.invite_link_id, func.count(LotteryDraw.id))
                    .where(
                        LotteryDraw.invite_link_id.in_(link_ids),
                        LotteryDraw.result_type == "win",
                    )
                    .group_by(LotteryDraw.invite_link_id)
                )
            ).all()
        }
    items = []
    for link, creator in rows:
        item = link_to_dict(link, request=request, creator=creator, win_count=win_counts.get(int(link.id), 0))
        item["win_count"] = win_counts.get(int(link.id), 0)
        items.append(item)
    return _page(items, total, page, page_size)


@employee_router.get("/links")
async def employee_links(
    request: Request,
    campaign_id: int | None = Query(None, ge=1),
    keyword: str = Query("", max_length=120),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    filters: list[Any] = [
        LotteryInviteLink.created_by_user_id == int(user.id),
        LotteryInviteLink.campaign_id.in_(
            select(LotteryCampaign.id).where(LotteryCampaign.status != "draft")
        ),
    ]
    if not is_admin_like(user):
        authorized_campaigns = (
            select(LotteryCampaignStaff.campaign_id)
            .join(LotteryCampaign, LotteryCampaign.id == LotteryCampaignStaff.campaign_id)
            .where(
                LotteryCampaignStaff.user_id == int(user.id),
                LotteryCampaignStaff.enabled.is_(True),
                LotteryCampaign.status != "draft",
            )
        )
        filters.append(LotteryInviteLink.campaign_id.in_(authorized_campaigns))
    if campaign_id:
        campaign = await _campaign_or_404(db, campaign_id, allow_deleted=True)
        await _staff_access(db, campaign, user)
        filters.append(LotteryInviteLink.campaign_id == campaign_id)
    if keyword.strip():
        like = f"%{keyword.strip()}%"
        filters.append(
            or_(
                LotteryInviteLink.customer_name.like(like),
                LotteryInviteLink.customer_code.like(like),
            )
        )
    return await _list_links_response(db, request, filters=filters, page=page, page_size=page_size)


@employee_router.post("/links")
async def create_link(
    payload: LinkCreatePayload,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    campaign = await _campaign_or_404(db, payload.campaign_id, lock=True)
    staff = await _staff_access(db, campaign, user, lock=True)
    effective = effective_campaign_status(campaign)
    if effective not in {"published", "not_started"}:
        raise HTTPException(status_code=409, detail="仅已发布且未结束的活动可以生成客户链接。")
    cap = _staff_chance_cap(campaign, staff)
    if payload.chance_total > cap:
        raise HTTPException(status_code=400, detail=f"单个链接最多可设置 {cap} 次抽奖机会。")
    expires_at = _parse_datetime(payload.expires_at, "过期时间")
    if expires_at and expires_at <= utcnow_naive():
        raise HTTPException(status_code=400, detail="过期时间必须晚于当前时间。")
    if campaign.end_at and expires_at and expires_at > campaign.end_at:
        raise HTTPException(status_code=400, detail="链接过期时间不能晚于活动结束时间。")
    link = LotteryInviteLink(
        campaign_id=payload.campaign_id,
        public_code=secrets.token_urlsafe(24),
        customer_name=payload.customer_name.strip(),
        customer_code=payload.customer_code.strip(),
        customer_note=payload.customer_note.strip(),
        chance_total=payload.chance_total,
        expires_at=expires_at,
        created_by_user_id=int(user.id),
    )
    db.add(link)
    await db.flush()
    await db.refresh(link)
    db.add(LotteryLinkActionLog(invite_link_id=int(link.id), campaign_id=payload.campaign_id, action="create", before_chance_total=0, after_chance_total=payload.chance_total, delta=payload.chance_total, reason="创建客户专属链接", operator_id=int(user.id)))
    return {"item": link_to_dict(link, request=request, creator=user)}


async def _perform_link_action(
    link_id: int,
    payload: LinkActionPayload,
    request: Request,
    db: AsyncSession,
    user: User,
    *,
    admin_mode: bool,
) -> dict[str, Any]:
    link = await _link_or_404(db, link_id, lock=True)
    campaign = await _campaign_or_404(db, int(link.campaign_id), lock=True)
    staff = None if admin_mode else await _staff_access(db, campaign, user)
    if not admin_mode and int(link.created_by_user_id) != int(user.id):
        raise HTTPException(status_code=403, detail="只能管理自己创建的客户链接。")
    if payload.action == "adjust":
        raise HTTPException(status_code=409, detail="每条客户链接仅可抽奖 1 次，不支持追加或调整次数。")
    if payload.action == "enable" and effective_campaign_status(campaign) not in {"published", "not_started"}:
        raise HTTPException(status_code=409, detail="活动已暂停或结束，仅可查看历史，不能启用链接。")
    before_total = int(link.chance_total or 0)
    before_status = link.status
    if payload.action == "disable":
        link.status = "disabled"
    else:
        if effective_campaign_status(campaign) == "ended":
            raise HTTPException(status_code=409, detail="活动已结束，不能重新启用链接。")
        link.status = "active"
    link.version = int(link.version or 0) + 1
    db.add(LotteryLinkActionLog(invite_link_id=int(link.id), campaign_id=int(link.campaign_id), action=payload.action, before_chance_total=before_total, after_chance_total=int(link.chance_total or 0), delta=int(link.chance_total or 0) - before_total, reason=payload.reason.strip() or (f"状态：{before_status} → {link.status}" if payload.action != "adjust" else "调整抽奖次数"), operator_id=int(user.id)))
    await db.flush()
    await db.refresh(link)
    creator = await db.get(User, int(link.created_by_user_id))
    return {"item": link_to_dict(link, request=request, creator=creator, win_count=await count_link_wins(db, int(link.id)))}


@employee_router.post("/links/{link_id}/actions")
async def employee_link_action(
    link_id: int,
    payload: LinkActionPayload,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    return await _perform_link_action(link_id, payload, request, db, user, admin_mode=False)


@employee_router.get("/links/{link_id}")
async def employee_link_detail(
    link_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    link = await _link_or_404(db, link_id)
    campaign = await _campaign_or_404(db, int(link.campaign_id), allow_deleted=True)
    await _staff_access(db, campaign, user)
    if not is_admin_like(user) and int(link.created_by_user_id) != int(user.id):
        raise HTTPException(status_code=403, detail="只能查看自己创建的客户链接。")
    creator = await db.get(User, int(link.created_by_user_id))
    item = link_to_dict(link, request=request, creator=creator)
    item["campaign"] = campaign_to_dict(campaign)
    item["win_count"] = int(
        (
            await db.execute(
                select(func.count()).select_from(LotteryDraw).where(
                    LotteryDraw.invite_link_id == link_id,
                    LotteryDraw.result_type == "win",
                )
            )
        ).scalar_one()
    )
    item["receipt"] = receipt_to_dict(link, item["win_count"], public=False)
    return {"item": item}


async def _link_actions_response(
    db: AsyncSession,
    link_id: int,
    *,
    page: int,
    page_size: int,
) -> dict[str, Any]:
    total = int(
        (
            await db.execute(
                select(func.count()).select_from(LotteryLinkActionLog).where(
                    LotteryLinkActionLog.invite_link_id == link_id
                )
            )
        ).scalar_one()
    )
    rows = list(
        (
            await db.execute(
                select(LotteryLinkActionLog)
                .where(LotteryLinkActionLog.invite_link_id == link_id)
                .order_by(desc(LotteryLinkActionLog.id))
                .offset((page - 1) * page_size)
                .limit(page_size)
            )
        ).scalars()
    )
    return _page([link_action_to_dict(item) for item in rows], total, page, page_size)


@employee_router.get("/links/{link_id}/actions")
async def employee_link_actions(
    link_id: int,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    link = await _link_or_404(db, link_id)
    campaign = await _campaign_or_404(db, int(link.campaign_id), allow_deleted=True)
    await _staff_access(db, campaign, user)
    if not is_admin_like(user) and int(link.created_by_user_id) != int(user.id):
        raise HTTPException(status_code=403, detail="只能查看自己创建链接的操作记录。")
    return await _link_actions_response(db, link_id, page=page, page_size=page_size)


@employee_router.get("/links/{link_id}/draws")
async def employee_link_draws(
    link_id: int,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    link = await _link_or_404(db, link_id)
    campaign = await _campaign_or_404(db, int(link.campaign_id), allow_deleted=True)
    await _staff_access(db, campaign, user)
    if not is_admin_like(user) and int(link.created_by_user_id) != int(user.id):
        raise HTTPException(status_code=403, detail="只能查看自己创建链接的抽奖记录。")
    total = int((await db.execute(select(func.count()).select_from(LotteryDraw).where(LotteryDraw.invite_link_id == link_id))).scalar_one())
    rows = list((await db.execute(select(LotteryDraw).where(LotteryDraw.invite_link_id == link_id).order_by(desc(LotteryDraw.id)).offset((page - 1) * page_size).limit(page_size))).scalars())
    claims = {int(item.draw_id): item for item in (await db.execute(select(LotteryClaim).where(LotteryClaim.draw_id.in_([int(item.id) for item in rows]) if rows else False))).scalars()}
    return _page([draw_to_dict(item, claims.get(int(item.id))) for item in rows], total, page, page_size)


@admin_router.get("/links")
async def admin_links(
    request: Request,
    campaign_id: int | None = Query(None, ge=1),
    creator_user_id: int | None = Query(None, ge=1),
    keyword: str = Query("", max_length=120),
    status: str = Query("", max_length=16),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
) -> dict[str, Any]:
    filters: list[Any] = []
    if campaign_id:
        filters.append(LotteryInviteLink.campaign_id == campaign_id)
    if creator_user_id:
        filters.append(LotteryInviteLink.created_by_user_id == creator_user_id)
    if status.strip():
        filters.append(LotteryInviteLink.status == status.strip().lower())
    if keyword.strip():
        like = f"%{keyword.strip()}%"
        filters.append(
            or_(
                LotteryInviteLink.customer_name.like(like),
                LotteryInviteLink.customer_code.like(like),
                User.real_name.like(like),
                User.display_name.like(like),
                User.username.like(like),
            )
        )
    return await _list_links_response(db, request, filters=filters, page=page, page_size=page_size)


@admin_router.post("/links/{link_id}/actions")
async def admin_link_action(
    link_id: int,
    payload: LinkActionPayload,
    request: Request,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    return await _perform_link_action(link_id, payload, request, db, admin, admin_mode=True)


@admin_router.get("/links/{link_id}/actions")
async def admin_link_actions(
    link_id: int,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
) -> dict[str, Any]:
    await _link_or_404(db, link_id)
    return await _link_actions_response(db, link_id, page=page, page_size=page_size)


@admin_router.get("/draws")
async def admin_draws(
    campaign_id: int | None = Query(None, ge=1),
    link_id: int | None = Query(None, ge=1),
    result_type: str = Query("", max_length=16),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
) -> dict[str, Any]:
    filters: list[Any] = []
    if campaign_id:
        filters.append(LotteryDraw.campaign_id == campaign_id)
    if link_id:
        filters.append(LotteryDraw.invite_link_id == link_id)
    if result_type.strip():
        filters.append(LotteryDraw.result_type == result_type.strip().lower())
    total = int((await db.execute(select(func.count()).select_from(LotteryDraw).where(*filters))).scalar_one())
    rows = (
        await db.execute(
            select(LotteryDraw, LotteryInviteLink, User)
            .join(LotteryInviteLink, LotteryInviteLink.id == LotteryDraw.invite_link_id)
            .join(User, User.id == LotteryInviteLink.created_by_user_id)
            .where(*filters)
            .order_by(desc(LotteryDraw.id))
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    ).all()
    draw_ids = [int(draw.id) for draw, _, _ in rows]
    claims = {int(item.draw_id): item for item in (await db.execute(select(LotteryClaim).where(LotteryClaim.draw_id.in_(draw_ids) if draw_ids else False))).scalars()}
    items = []
    for draw, link, creator in rows:
        item = draw_to_dict(draw, claims.get(int(draw.id)))
        item.update(
            {
                "customer_name": link.customer_name,
                "customer_code": link.customer_code or "",
                "public_code": link.public_code,
                "created_by_user_id": int(link.created_by_user_id),
                "created_by_name": creator.real_name or creator.display_name or creator.username,
            }
        )
        items.append(item)
    return _page(items, total, page, page_size)


@admin_router.get("/claims")
async def admin_claims(
    campaign_id: int | None = Query(None, ge=1),
    status: str = Query("", max_length=16),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
) -> dict[str, Any]:
    filters: list[Any] = []
    if campaign_id:
        filters.append(LotteryClaim.campaign_id == campaign_id)
    if status.strip():
        filters.append(LotteryClaim.status == status.strip().lower())
    total = int((await db.execute(select(func.count()).select_from(LotteryClaim).where(*filters))).scalar_one())
    rows = (await db.execute(select(LotteryClaim, LotteryDraw, LotteryInviteLink, User).join(LotteryDraw, LotteryDraw.id == LotteryClaim.draw_id).join(LotteryInviteLink, LotteryInviteLink.id == LotteryClaim.invite_link_id).outerjoin(User, User.id == LotteryInviteLink.created_by_user_id).where(*filters).order_by(desc(LotteryClaim.id)).offset((page - 1) * page_size).limit(page_size))).all()
    items = []
    for claim, draw, link, creator in rows:
        item = claim_to_dict(claim)
        item.update({
            "prize_name": draw.prize_name_snapshot or "", "prize_image_url": draw.prize_image_url_snapshot or "",
            "customer_name": link.customer_name, "customer_code": link.customer_code or "",
            "public_code": link.public_code, "created_by_user_id": int(link.created_by_user_id),
            "created_by_name": (creator.real_name or creator.display_name or creator.username) if creator else "已删除员工",
            "chance_total": int(link.chance_total or 0), "chance_used": int(link.chance_used or 0),
            "chance_limit": SINGLE_DRAW_LIMIT, "remaining_chances": remaining_link_chances(link),
            "receipt_submitted": bool(link.receipt_submitted_at),
        })
        items.append(item)
    response = _page(items, total, page, page_size)
    # Reading a queue never silently reconstructs historical records. Operators
    # can audit and repair the exact missing IDs with the maintenance command.
    response["missing_claim_count"] = len(await find_missing_lottery_claims(db, campaign_id=campaign_id))
    return response


@admin_router.post("/claims/{claim_id}/status")
async def update_claim_status(
    claim_id: int,
    payload: ClaimStatusPayload,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    claim = (await db.execute(select(LotteryClaim).where(LotteryClaim.id == claim_id).with_for_update())).scalar_one_or_none()
    if not claim:
        raise HTTPException(status_code=404, detail="领奖记录不存在。")
    remark = payload.remark.strip()
    if claim.status in {"fulfilled", "cancelled"}:
        if payload.status == claim.status and remark == (claim.operator_remark or ""):
            return {"item": claim_to_dict(claim)}
        raise HTTPException(status_code=409, detail="领奖记录已完成或取消，终态不能再次修改，请刷新列表。")
    if not secrets.compare_digest(payload.expected_revision, claim_revision(claim)):
        raise HTTPException(status_code=409, detail="领奖记录已被其他管理员更新，请刷新后核对最新状态。")
    allowed = {"pending": {"pending", "contacted", "fulfilled", "cancelled"}, "contacted": {"contacted", "fulfilled", "cancelled"}}
    if payload.status not in allowed.get(claim.status, set()):
        raise HTTPException(status_code=409, detail="不允许回退领奖处理状态，请刷新后核对。")
    if payload.status == claim.status and remark == (claim.operator_remark or ""):
        return {"item": claim_to_dict(claim)}
    # Sales staff verify redemption offline. Contact fields are historical
    # optional data, not a fulfilment gate; revision/terminal checks stay intact.
    before = claim_to_dict(claim)
    claim.status = payload.status
    claim.operator_id = int(admin.id)
    claim.operator_remark = remark
    if payload.status == "fulfilled":
        claim.fulfilled_at = utcnow_naive()
    await db.flush()
    await db.refresh(claim)
    after = claim_to_dict(claim)
    await _audit(db, campaign_id=int(claim.campaign_id), entity_type="claim", entity_id=claim_id, action="status", operator_id=int(admin.id), before=before, after=after)
    return {"item": after}


@admin_router.get("/audit-logs")
async def admin_audit_logs(
    campaign_id: int | None = Query(None, ge=1),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
) -> dict[str, Any]:
    filters = [LotteryAuditLog.campaign_id == campaign_id] if campaign_id else []
    total = int((await db.execute(select(func.count()).select_from(LotteryAuditLog).where(*filters))).scalar_one())
    rows = list((await db.execute(select(LotteryAuditLog).where(*filters).order_by(desc(LotteryAuditLog.id)).offset((page - 1) * page_size).limit(page_size))).scalars())
    return _page([{"id": int(item.id), "campaign_id": int(item.campaign_id) if item.campaign_id else None, "entity_type": item.entity_type, "entity_id": int(item.entity_id) if item.entity_id else None, "action": item.action, "before": json.loads(item.before_json) if item.before_json else None, "after": json.loads(item.after_json) if item.after_json else None, "operator_id": int(item.operator_id), "created_at": _iso_db(item.created_at)} for item in rows], total, page, page_size)


async def _public_link_context(db: AsyncSession, public_code: str, *, lock: bool = False) -> tuple[LotteryCampaign, LotteryInviteLink]:
    stmt = select(LotteryInviteLink).where(LotteryInviteLink.public_code == public_code)
    if lock:
        stmt = stmt.with_for_update()
    link = (await db.execute(stmt)).scalar_one_or_none()
    if not link:
        raise HTTPException(status_code=404, detail="抽奖链接不存在。")
    campaign = await _campaign_or_404(db, int(link.campaign_id))
    if campaign.status == "draft":
        raise HTTPException(status_code=404, detail="抽奖活动不存在。")
    return campaign, link


def _stream_lottery_share_image(stream, chunk_size: int = 64 * 1024):
    try:
        while True:
            chunk = stream.read(chunk_size)
            if not chunk:
                break
            yield chunk
    finally:
        close = getattr(stream, "close", None)
        if callable(close):
            try:
                close()
            except Exception:  # noqa: BLE001
                pass


@public_router.api_route(
    "/{public_code}/share-image.jpg",
    methods=["GET", "HEAD"],
    response_model=None,
)
async def public_share_image(
    public_code: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> Response | StreamingResponse:
    """Serve uploaded share artwork inline from the public site domain.

    The OSS bucket currently forces ``Content-Disposition: attachment`` on its
    public URLs. WeChat/WeCom card crawlers consequently ignore otherwise valid
    JPEG/PNG artwork. Proxying the configured object here gives crawlers a
    stable HTTPS URL with an explicit image Content-Type and inline disposition.
    """

    campaign, _ = await _public_link_context(db, public_code)
    object_key = (campaign.share_image_object_key or "").strip() or (campaign.hero_image_object_key or "").strip()
    if not object_key:
        raise HTTPException(status_code=404, detail="分享卡片图片未配置。")

    bucket = await asyncio.to_thread(_build_oss_bucket)
    try:
        head = await asyncio.to_thread(bucket.head_object, object_key)
    except oss2.exceptions.NoSuchKey as exc:
        raise HTTPException(status_code=404, detail="分享卡片图片不存在或已过期。") from exc
    except oss2.exceptions.OssError as exc:
        raise HTTPException(status_code=502, detail="分享卡片图片读取失败。") from exc

    guessed_mime = (mimetypes.guess_type(object_key)[0] or "").strip().lower()
    stored_mime = (getattr(head, "content_type", None) or "").strip().lower()
    media_type = guessed_mime or stored_mime
    if not media_type.startswith("image/"):
        raise HTTPException(status_code=415, detail="分享卡片图片格式不受支持。")

    headers = {
        "Cache-Control": "public, max-age=300",
        "Content-Disposition": "inline",
        "X-Content-Type-Options": "nosniff",
    }
    content_length = int(getattr(head, "content_length", None) or 0)
    if content_length:
        headers["Content-Length"] = str(content_length)
    etag = (getattr(head, "etag", None) or "").strip().strip('"')
    if etag:
        headers["ETag"] = f'"{etag}"'

    if request.method.upper() == "HEAD":
        return Response(media_type=media_type, headers=headers)

    try:
        oss_object = await asyncio.to_thread(bucket.get_object, object_key)
    except oss2.exceptions.NoSuchKey as exc:
        raise HTTPException(status_code=404, detail="分享卡片图片不存在或已过期。") from exc
    except oss2.exceptions.OssError as exc:
        raise HTTPException(status_code=502, detail="分享卡片图片读取失败。") from exc
    return StreamingResponse(
        _stream_lottery_share_image(oss_object),
        media_type=media_type,
        headers=headers,
    )


@public_router.get("/{public_code}")
async def public_lottery(
    public_code: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    # Serialize last_opened_at with draws; historical repair is an explicit
    # maintenance operation and must not depend on customers opening the page.
    campaign, link = await _public_link_context(db, public_code, lock=True)
    link.last_opened_at = utcnow_naive()
    prizes = list((await db.execute(select(LotteryPrize).where(LotteryPrize.campaign_id == int(campaign.id), LotteryPrize.enabled.is_(True), LotteryPrize.deleted_at.is_(None)).order_by(LotteryPrize.sort_order, LotteryPrize.id))).scalars())
    draws = list((await db.execute(select(LotteryDraw).where(LotteryDraw.invite_link_id == int(link.id)).order_by(desc(LotteryDraw.id)).limit(20))).scalars())
    draw_ids = [int(item.id) for item in draws]
    claims = {int(item.draw_id): item for item in (await db.execute(select(LotteryClaim).where(LotteryClaim.draw_id.in_(draw_ids) if draw_ids else False))).scalars()}
    summary = await winning_summary(db, int(link.id))
    return {
        "campaign": campaign_to_dict(campaign, public=True),
        "link": link_to_dict(link, public=True),
        "prizes": [prize_to_dict(item, public=True) for item in prizes],
        "recent_draws": [draw_to_dict(item, claims.get(int(item.id))) for item in draws],
        "share": share_payload(campaign, link, request),
        "receipt": receipt_to_dict(link, summary["total_wins"]),
        "winning_summary": summary,
    }


@public_router.get("/{public_code}/winning-summary")
async def public_winning_summary(
    public_code: str,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    _, link = await _public_link_context(db, public_code)
    return await winning_summary(db, int(link.id))


@public_router.get("/{public_code}/winners")
async def public_lottery_winners(
    public_code: str,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Small campaign-scoped feed of real wins, never a customer directory."""
    campaign, link = await _public_link_context(db, public_code)
    if link.status != "active":
        raise HTTPException(status_code=409, detail="该抽奖链接已停用。")
    if link.expires_at and utcnow_naive() > link.expires_at:
        raise HTTPException(status_code=409, detail="该抽奖链接已过期。")
    rows = (await db.execute(
        select(
            LotteryDraw.id, LotteryInviteLink.customer_name,
            LotteryDraw.prize_name_snapshot, LotteryDraw.created_at,
        )
        .join(LotteryInviteLink, LotteryInviteLink.id == LotteryDraw.invite_link_id)
        .where(
            LotteryDraw.campaign_id == int(campaign.id),
            LotteryInviteLink.campaign_id == int(campaign.id),
            LotteryDraw.result_type == "win",
        )
        .order_by(desc(LotteryDraw.id))
        .limit(30)
    )).all()
    return {"items": [
        {"id": int(draw_id), "display_name": winner_display_name(name),
         "prize_name": prize_name or "奖品", "created_at": _iso(created_at)}
        for draw_id, name, prize_name, created_at in rows
    ]}


@public_router.get("/{public_code}/draws")
async def public_lottery_draws(
    public_code: str,
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    # Full history is separate from recent_draws, which remains a small
    # recovery snapshot for an interrupted draw. This endpoint never writes.
    _, link = await _public_link_context(db, public_code)
    filters = [LotteryDraw.invite_link_id == int(link.id)]
    total = int((await db.execute(
        select(func.count()).select_from(LotteryDraw).where(*filters)
    )).scalar_one())
    rows = list((await db.execute(
        select(LotteryDraw).where(*filters).order_by(desc(LotteryDraw.id))
        .offset((page - 1) * page_size).limit(page_size)
    )).scalars())
    draw_ids = [int(item.id) for item in rows]
    claims = {int(item.draw_id): item for item in (await db.execute(
        select(LotteryClaim).where(LotteryClaim.draw_id.in_(draw_ids) if draw_ids else False)
    )).scalars()}
    # draw_to_dict is the same public-safe whitelist used by public_lottery:
    # no request IDs, probability internals or recipient contact information.
    return _page([draw_to_dict(item, claims.get(int(item.id))) for item in rows], total, page, page_size)


async def _ensure_pending_claim_for_win(
    db: AsyncSession,
    *,
    draw: LotteryDraw,
    link: LotteryInviteLink,
) -> LotteryClaim | None:
    # Keep this private alias for existing integrations/tests; domain logic is
    # shared by the normal draw transaction and explicit historical repair.
    return await ensure_pending_claim_for_win(db, draw=draw, link=link)


@public_router.post("/{public_code}/draw")
async def public_draw(
    public_code: str,
    payload: DrawPayload,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    forwarded = (request.headers.get("x-forwarded-for") or "").split(",", 1)[0].strip()
    client_ip = forwarded or (request.client.host if request.client else "")
    outcome = await execute_draw(db, public_code=public_code, request_id=payload.request_id, expected_draw_sequence=payload.expected_draw_sequence, client_ip=client_ip, user_agent=request.headers.get("user-agent", ""))
    # A replay can succeed when paused/ended/exhausted, but an archived/draft
    # campaign must not regain public visibility through this endpoint.
    campaign = await _campaign_or_404(db, int(outcome.link.campaign_id), lock=True)
    if campaign.status == "draft":
        raise HTTPException(status_code=404, detail="抽奖活动不存在。")
    prizes = list((await db.execute(select(LotteryPrize).where(
        LotteryPrize.campaign_id == int(campaign.id), LotteryPrize.enabled.is_(True), LotteryPrize.deleted_at.is_(None),
    ).order_by(LotteryPrize.sort_order, LotteryPrize.id))).scalars())
    claim = await _ensure_pending_claim_for_win(db, draw=outcome.draw, link=outcome.link)
    draw_data = draw_to_dict(outcome.draw, claim)
    link_data = link_to_dict(outcome.link, public=True)
    summary = await winning_summary(db, int(outcome.link.id))
    return {
        "draw": draw_data, "link": link_data, "remaining_chances": link_data["remaining_chances"],
        "idempotent": outcome.idempotent, "campaign": campaign_to_dict(campaign, public=True),
        "prizes": [prize_to_dict(item, public=True) for item in prizes],
        "receipt": receipt_to_dict(outcome.link, summary["total_wins"]),
        "winning_summary": summary,
    }


@public_router.post("/{public_code}/receipt")
async def public_receipt(
    public_code: str,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    # Ignore legacy request bodies completely; do not validate/store new PII.
    # Archived/draft links retain their existing visibility restriction.
    await _public_link_context(db, public_code)
    raise HTTPException(status_code=409, detail="线上收货信息填写已停用，请截图中奖信息联系销售人员兑奖。")


@public_router.post("/{public_code}/draws/{draw_id}/claim")
async def public_claim(
    public_code: str,
    draw_id: int,
    payload: ClaimPayload,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    raise HTTPException(status_code=409, detail="线上领奖资料填写已停用，请截图中奖信息联系销售人员兑奖。")


@public_router.get("/{public_code}/share-config")
async def public_share_config(
    public_code: str,
    request: Request,
    url: str | None = Query(None, max_length=4096),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    campaign, link = await _public_link_context(db, public_code)
    share = share_payload(campaign, link, request)
    sign_url = ((url or "").strip() or share["url"]).split("#", 1)[0]
    empty_sdk: dict[str, Any] = {"enabled": False, "corp_id": "", "app_id": "", "agent_id": 0, "timestamp": 0, "nonce_str": "", "signature": "", "js_api_list": []}
    sdk: dict[str, Any] = {**empty_sdk}
    agent_sdk: dict[str, Any] = {**empty_sdk}
    wechat_sdk: dict[str, Any] = {**empty_sdk}
    wechat_configured = bool(settings.wechat_mp_ready)
    wechat_error = ""
    if wechat_configured:
        try:
            wechat_sdk = await _wechat_mp_client.build_js_sdk_config(sign_url)
            # QR scans and shared links open the same public wheel directly.
            wechat_sdk["js_api_list"] = ["showOptionMenu", "showMenuItems", "hideMenuItems", "updateAppMessageShareData", "onMenuShareAppMessage"]
        except (WechatApiError, httpx.HTTPError) as exc:
            code = getattr(exc, "errcode", None)
            suffix = f"（错误码 {code}）" if code is not None else ""
            wechat_error = f"微信公众号签名暂不可用{suffix}。"
            logger.warning("lottery public SDK unavailable error_type=%s code=%s", type(exc).__name__, code)
    diagnostics = {
        "sign_url": sign_url,
        "share_url": share["url"],
        "lottery_url": share["lottery_url"],
        "wecom": {"configured": False, "enabled": False, "reason": "抽奖分享仅使用普通微信。"},
        "wecom_agent": {"configured": False, "enabled": False, "reason": "抽奖分享仅使用普通微信。"},
        "wechat": {"configured": wechat_configured, "enabled": bool(wechat_sdk.get("enabled")), "reason": wechat_error or ("" if wechat_configured else "未配置公众号，仍可使用微信原生转发。")},
    }
    return {"share": share, "sdk": sdk, "agent_sdk": agent_sdk, "wechat_sdk": wechat_sdk, "diagnostics": diagnostics}
