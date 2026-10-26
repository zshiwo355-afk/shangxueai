"""客户抽奖领域逻辑。

抽奖结果、次数扣减和库存占用必须在同一个数据库事务中完成。API 层只负责
校验输入和格式化响应，避免前端或路由处理器决定中奖结果。
"""
from __future__ import annotations

import hashlib
import secrets
from dataclasses import dataclass
from datetime import datetime
from typing import Sequence

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .models import LotteryCampaign, LotteryClaim, LotteryDraw, LotteryInviteLink, LotteryPrize
from .lottery_policy import remaining_link_chances


PROBABILITY_SCALE = 1_000_000
CAMPAIGN_STATUSES = {"draft", "published", "paused", "ended"}
PRIZE_TYPES = {"physical", "coupon"}


@dataclass(frozen=True)
class DrawOutcome:
    draw: LotteryDraw
    link: LotteryInviteLink
    idempotent: bool = False


def utcnow_naive() -> datetime:
    return datetime.utcnow()


def effective_campaign_status(campaign: LotteryCampaign, now: datetime | None = None) -> str:
    current = now or utcnow_naive()
    status = (campaign.status or "draft").strip().lower()
    if status != "published":
        return status
    if campaign.start_at and current < campaign.start_at:
        return "not_started"
    if campaign.end_at and current > campaign.end_at:
        return "ended"
    return "published"


def validate_probability_config(prizes: Sequence[LotteryPrize]) -> None:
    active = [item for item in prizes if bool(item.enabled) and item.deleted_at is None]
    if not active:
        raise HTTPException(status_code=409, detail="请先配置并启用抽奖奖品。")
    if len(active) > 12:
        raise HTTPException(status_code=409, detail="启用奖品数量必须为 1 至 12 个。")
    if any(item.type == "no_win" for item in active):
        raise HTTPException(status_code=409, detail="活动仍启用了历史“未中奖”奖项，请管理员停用并重新分配真实奖品概率后再参与。")
    total = sum(int(item.probability_ppm or 0) for item in active)
    if total != PROBABILITY_SCALE:
        raise HTTPException(status_code=409, detail="启用奖品概率合计必须等于 100%。")
    for item in active:
        probability = int(item.probability_ppm or 0)
        if probability < 0 or probability > PROBABILITY_SCALE:
            raise HTTPException(status_code=409, detail="奖品概率配置不正确。")
        if item.type not in PRIZE_TYPES:
            raise HTTPException(status_code=409, detail=f"奖品“{item.name}”类型不正确。")
        if int(item.stock_total or 0) < int(item.stock_awarded or 0):
            raise HTTPException(status_code=409, detail=f"奖品“{item.name}”库存数据不正确。")
    if not eligible_prizes(active):
        raise HTTPException(status_code=409, detail="奖品已领完或暂无可抽取库存，请联系工作人员；本次未扣减机会。")


def eligible_prizes(prizes: Sequence[LotteryPrize]) -> list[LotteryPrize]:
    return sorted(
        (item for item in prizes if bool(item.enabled) and item.deleted_at is None
         and item.type in PRIZE_TYPES and int(item.probability_ppm or 0) > 0
         and int(item.stock_total or 0) > int(item.stock_awarded or 0)),
        key=lambda item: (int(item.sort_order or 0), int(item.id or 0)),
    )


def select_prize_by_random(prizes: Sequence[LotteryPrize], random_value: int) -> LotteryPrize:
    """按有库存奖品的原始权重重归一；random_value 位于可用权重总和内。"""

    active = eligible_prizes(prizes)
    available_weight = sum(int(item.probability_ppm or 0) for item in active)
    if random_value < 0 or random_value >= available_weight:
        raise ValueError("random_value must be in [0, available prize weight)")
    cursor = 0
    for item in active:
        cursor += int(item.probability_ppm or 0)
        if random_value < cursor:
            return item
    raise ValueError("probability configuration does not cover the random range")


def hash_client_ip(ip: str, public_code: str) -> str:
    text = f"lottery:{public_code}:{(ip or '').strip()}"
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


async def execute_draw(
    db: AsyncSession,
    *,
    public_code: str,
    request_id: str,
    client_ip: str,
    user_agent: str,
    expected_draw_sequence: int | None = None,
    random_value: int | None = None,
    now: datetime | None = None,
) -> DrawOutcome:
    """锁定专属链接和奖品行，原子完成一次抽奖。

    ``request_id`` 在同一链接内唯一；重复请求直接返回第一次结果且不再次扣次数。
    """

    current = now or utcnow_naive()
    link = (
        await db.execute(
            select(LotteryInviteLink)
            .where(LotteryInviteLink.public_code == public_code)
            .with_for_update()
        )
    ).scalar_one_or_none()
    if not link:
        raise HTTPException(status_code=404, detail="抽奖链接不存在。")

    existing = (
        await db.execute(
            select(LotteryDraw)
            .where(
                LotteryDraw.invite_link_id == int(link.id),
                LotteryDraw.request_id == request_id,
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    if existing:
        if expected_draw_sequence is not None and int(existing.draw_sequence) != expected_draw_sequence:
            raise HTTPException(status_code=409, detail="抽奖请求与次数序号不一致，请刷新后重试。")
        return DrawOutcome(draw=existing, link=link, idempotent=True)

    # A browser may lose its request ID after a response is lost. The persisted
    # sequence, checked while holding the link lock, is the second idempotency
    # boundary: a new request ID must not consume the same intended turn twice.
    if expected_draw_sequence is not None:
        if expected_draw_sequence < 1:
            raise HTTPException(status_code=400, detail="抽奖次数序号必须为正整数。")
        used = int(link.chance_used or 0)
        if expected_draw_sequence <= used:
            previous = (
                await db.execute(
                    select(LotteryDraw).where(
                        LotteryDraw.invite_link_id == int(link.id),
                        LotteryDraw.draw_sequence == expected_draw_sequence,
                    ).with_for_update()
                )
            ).scalar_one_or_none()
            if previous:
                return DrawOutcome(draw=previous, link=link, idempotent=True)
            raise HTTPException(status_code=409, detail="抽奖记录与次数不一致，请联系工作人员核对。")
        if expected_draw_sequence != used + 1:
            raise HTTPException(status_code=409, detail="抽奖次数已变化，请刷新后重试。")

    campaign = (
        await db.execute(
            select(LotteryCampaign).where(
                LotteryCampaign.id == int(link.campaign_id),
                LotteryCampaign.deleted_at.is_(None),
            ).with_for_update()
        )
    ).scalar_one_or_none()
    if not campaign:
        raise HTTPException(status_code=404, detail="抽奖活动不存在。")

    campaign_status = effective_campaign_status(campaign, current)
    if campaign_status == "not_started":
        raise HTTPException(status_code=409, detail="活动尚未开始。")
    if campaign_status == "paused":
        raise HTTPException(status_code=409, detail="活动已暂停。")
    if campaign_status == "ended":
        raise HTTPException(status_code=409, detail="活动已结束。")
    if campaign_status != "published":
        raise HTTPException(status_code=409, detail="活动暂不可参与。")
    if link.status != "active":
        raise HTTPException(status_code=409, detail="该抽奖链接已停用。")
    if link.expires_at and current > link.expires_at:
        raise HTTPException(status_code=409, detail="该抽奖链接已过期。")

    chance_before = remaining_link_chances(link)
    if chance_before <= 0:
        raise HTTPException(status_code=409, detail="抽奖次数已用完。")

    prizes = list(
        (
            await db.execute(
                select(LotteryPrize)
                .where(
                    LotteryPrize.campaign_id == int(campaign.id),
                    LotteryPrize.enabled.is_(True),
                    LotteryPrize.deleted_at.is_(None),
                )
                .order_by(LotteryPrize.sort_order.asc(), LotteryPrize.id.asc())
                .with_for_update()
            )
        ).scalars()
    )
    validate_probability_config(prizes)
    available_weight = sum(int(item.probability_ppm or 0) for item in eligible_prizes(prizes))
    value = secrets.randbelow(available_weight) if random_value is None else int(random_value)
    selected = select_prize_by_random(prizes, value)
    selected.stock_awarded = int(selected.stock_awarded or 0) + 1

    link.chance_used = int(link.chance_used or 0) + 1
    link.last_draw_at = current
    link.version = int(link.version or 0) + 1
    chance_after = remaining_link_chances(link)
    draw = LotteryDraw(
        campaign_id=int(campaign.id),
        invite_link_id=int(link.id),
        request_id=request_id,
        draw_sequence=int(link.chance_used),
        result_type="win",
        prize_id=int(selected.id),
        prize_type_snapshot=selected.type or "",
        prize_name_snapshot=selected.name or "",
        prize_image_url_snapshot=selected.image_url or "",
        prize_probability_ppm_snapshot=int(selected.probability_ppm or 0),
        config_version=int(campaign.config_version or 1),
        chance_before=chance_before,
        chance_after=chance_after,
        random_value=value,
        ip_hash=hash_client_ip(client_ip, public_code),
        user_agent=(user_agent or "")[:500],
        created_at=current,
    )
    db.add(draw)
    await db.flush()
    return DrawOutcome(draw=draw, link=link, idempotent=False)


async def ensure_pending_claim_for_win(
    db: AsyncSession, *, draw: LotteryDraw, link: LotteryInviteLink,
) -> LotteryClaim | None:
    """Caller must hold the invite lock; preserve existing claim state on replay."""
    claim = (
        await db.execute(select(LotteryClaim).where(LotteryClaim.draw_id == int(draw.id)).with_for_update())
    ).scalar_one_or_none()
    if claim or draw.result_type != "win":
        return claim
    claim = LotteryClaim(
        campaign_id=int(draw.campaign_id), invite_link_id=int(link.id), draw_id=int(draw.id),
        recipient_name=(getattr(link, "recipient_name", "") or link.customer_name or "").strip() or "客户",
        recipient_phone=getattr(link, "recipient_phone", "") or "",
        recipient_address=getattr(link, "recipient_address", "") or "", status="pending",
    )
    db.add(claim)
    await db.flush()
    return claim


async def count_link_wins(db: AsyncSession, link_id: int) -> int:
    return int((await db.execute(select(func.count()).select_from(LotteryDraw).where(
        LotteryDraw.invite_link_id == link_id, LotteryDraw.result_type == "win",
    ))).scalar_one())


def receipt_state(link: LotteryInviteLink, win_count: int) -> dict:
    submitted = bool(link.receipt_submitted_at)
    # Historical receipt data stays readable to authorized staff, but new
    # customers redeem with their salesperson and never submit contact data.
    return {"can_submit": False, "submitted": submitted, "required": False,
            "win_count": win_count, "manual_redemption": True}


async def submit_link_receipt(
    db: AsyncSession, *, link: LotteryInviteLink, recipient_name: str,
    recipient_phone: str, recipient_address: str,
) -> tuple[dict, bool]:
    """Compatibility guard: old callers must not resume collecting addresses."""
    raise HTTPException(status_code=409, detail="线上收货信息填写已停用，请截图中奖信息联系销售人员兑奖。")


async def winning_summary(db: AsyncSession, link_id: int) -> dict:
    """Full immutable win snapshots, grouped independently of history pages."""
    rows = (await db.execute(
        select(
            LotteryDraw.prize_id, LotteryDraw.prize_name_snapshot,
            func.max(LotteryDraw.prize_image_url_snapshot), func.count(LotteryDraw.id),
        )
        .where(LotteryDraw.invite_link_id == link_id, LotteryDraw.result_type == "win")
        .group_by(LotteryDraw.prize_id, LotteryDraw.prize_name_snapshot)
        .order_by(func.min(LotteryDraw.id))
    )).all()
    items = [
        {"prize_id": int(prize_id) if prize_id is not None else None,
         "prize_name": name or "奖品", "prize_image_url": image or "", "quantity": int(quantity)}
        for prize_id, name, image, quantity in rows
    ]
    return {"items": items, "total_wins": sum(item["quantity"] for item in items)}


async def find_missing_lottery_claims(
    db: AsyncSession, *, campaign_id: int | None = None,
) -> list[dict[str, int]]:
    """Read-only inventory, including archived campaigns and every winning draw."""
    stmt = (
        select(LotteryDraw.id, LotteryDraw.campaign_id, LotteryDraw.invite_link_id)
        .outerjoin(LotteryClaim, LotteryClaim.draw_id == LotteryDraw.id)
        .where(LotteryDraw.result_type == "win", LotteryClaim.id.is_(None))
        .order_by(LotteryDraw.invite_link_id, LotteryDraw.id)
    )
    if campaign_id is not None:
        stmt = stmt.where(LotteryDraw.campaign_id == campaign_id)
    return [
        {"draw_id": int(draw_id), "campaign_id": int(campaign), "invite_link_id": int(link_id)}
        for draw_id, campaign, link_id in (await db.execute(stmt)).all()
    ]


async def backfill_missing_lottery_claims(
    db: AsyncSession, *, campaign_id: int | None = None,
    candidates: Sequence[dict[str, int]] | None = None,
) -> list[int]:
    """Idempotent repair; invite → draw → claim lock order matches public draws.

    This only creates missing pending registrations; it never touches prizes,
    chances, existing fulfilment decisions or customer contact information.
    The caller controls the transaction and must explicitly commit.
    """
    missing = list(candidates) if candidates is not None else await find_missing_lottery_claims(db, campaign_id=campaign_id)
    created: list[int] = []
    for item in sorted(missing, key=lambda value: (value["invite_link_id"], value["draw_id"])):
        link = (await db.execute(select(LotteryInviteLink).where(
            LotteryInviteLink.id == item["invite_link_id"],
        ).with_for_update())).scalar_one_or_none()
        if not link:
            raise HTTPException(status_code=409, detail=f"中奖记录 {item['draw_id']} 缺少客户链接，不能自动补单。")
        draw = (await db.execute(select(LotteryDraw).where(
            LotteryDraw.id == item["draw_id"], LotteryDraw.invite_link_id == int(link.id),
        ).with_for_update())).scalar_one_or_none()
        if not draw or draw.result_type != "win":
            continue
        existing = (await db.execute(select(LotteryClaim).where(
            LotteryClaim.draw_id == int(draw.id),
        ).with_for_update())).scalar_one_or_none()
        if existing:
            continue
        await ensure_pending_claim_for_win(db, draw=draw, link=link)
        created.append(int(draw.id))
    return created
