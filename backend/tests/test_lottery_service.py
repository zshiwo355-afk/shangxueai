from datetime import datetime, timedelta

import pytest
from fastapi import HTTPException

from app.lottery_service import (
    effective_campaign_status,
    execute_draw,
    select_prize_by_random,
    validate_probability_config,
)
from app.lottery_api import (
    _staff_chance_cap,
    _staff_link_quota,
    claim_to_dict,
    link_to_dict,
    prize_to_dict,
)
from app.models import (
    LotteryCampaign,
    LotteryCampaignStaff,
    LotteryClaim,
    LotteryDraw,
    LotteryInviteLink,
    LotteryPrize,
)


class _FakeResult:
    def __init__(self, *, scalar=None, scalars=None):
        self._scalar = scalar
        self._scalars = list(scalars or [])

    def scalar_one_or_none(self):
        return self._scalar

    def scalars(self):
        return self._scalars


class _FakeSession:
    def __init__(self, *results):
        self.results = list(results)
        self.added = []
        self.flush_count = 0

    async def execute(self, _statement):
        return self.results.pop(0)

    def add(self, value):
        self.added.append(value)

    async def flush(self):
        self.flush_count += 1


def _complete_without_event_loop(coroutine):
    """Fake DB awaits complete synchronously, so no Windows event loop is needed."""
    try:
        coroutine.send(None)
    except StopIteration as exc:
        return exc.value
    raise AssertionError("test coroutine unexpectedly yielded")


def _prize(
    prize_id: int,
    name: str,
    probability: int,
    *,
    prize_type: str = "physical",
    enabled: bool = True,
    sort_order: int = 0,
) -> LotteryPrize:
    return LotteryPrize(
        id=prize_id,
        campaign_id=1,
        name=name,
        type=prize_type,
        probability_ppm=probability,
        stock_total=10,
        stock_awarded=0,
        enabled=enabled,
        sort_order=sort_order,
        created_by=1,
    )


def test_probability_boundaries_are_deterministic() -> None:
    first = _prize(1, "一等奖", 100_000, sort_order=1)
    second = _prize(2, "二等奖", 200_000, sort_order=2)
    no_win = _prize(3, "优惠券", 700_000, prize_type="coupon", sort_order=3)
    prizes = [no_win, second, first]

    validate_probability_config(prizes)

    assert select_prize_by_random(prizes, 0).id == 1
    assert select_prize_by_random(prizes, 99_999).id == 1
    assert select_prize_by_random(prizes, 100_000).id == 2
    assert select_prize_by_random(prizes, 299_999).id == 2
    assert select_prize_by_random(prizes, 300_000).id == 3
    assert select_prize_by_random(prizes, 999_999).id == 3


@pytest.mark.parametrize(
    "prizes, detail",
    [
        ([_prize(1, "奖品", 500_000), _prize(2, "优惠券", 400_000, prize_type="coupon")], "100%"),
        ([_prize(1, "奖品", 500_000), _prize(2, "历史未中奖", 500_000, prize_type="no_win")], "未中奖"),
        ([_prize(1, "未中奖1", 500_000, prize_type="no_win"), _prize(2, "未中奖2", 500_000, prize_type="no_win")], "未中奖"),
    ],
)
def test_invalid_probability_configuration_is_rejected(prizes, detail: str) -> None:
    with pytest.raises(HTTPException) as exc_info:
        validate_probability_config(prizes)
    assert detail in str(exc_info.value.detail)


def test_enabled_prize_count_must_fit_wheel() -> None:
    prizes = [_prize(index, f"奖品{index}", 0) for index in range(1, 13)]
    prizes.append(_prize(13, "未中奖", 1_000_000, prize_type="no_win"))
    with pytest.raises(HTTPException, match="1 至 12"):
        validate_probability_config(prizes)


def test_effective_campaign_status_respects_window() -> None:
    now = datetime(2026, 11, 11, 12, 0, 0)
    campaign = LotteryCampaign(
        id=1,
        slug="double11",
        title="双十一",
        status="published",
        start_at=now + timedelta(hours=1),
        end_at=now + timedelta(hours=3),
        created_by=1,
    )
    assert effective_campaign_status(campaign, now) == "not_started"
    campaign.start_at = now - timedelta(hours=1)
    assert effective_campaign_status(campaign, now) == "published"
    campaign.end_at = now - timedelta(seconds=1)
    assert effective_campaign_status(campaign, now) == "ended"
    campaign.status = "paused"
    assert effective_campaign_status(campaign, now) == "paused"


def test_historical_staff_and_campaign_quotas_are_no_longer_applied() -> None:
    campaign = LotteryCampaign(
        id=1,
        slug="double11",
        title="双十一",
        max_links_per_employee=8,
        created_by=1,
    )
    inherited = LotteryCampaignStaff(
        campaign_id=1,
        user_id=2,
        link_quota=0,
        created_by=1,
    )
    overridden = LotteryCampaignStaff(
        campaign_id=1,
        user_id=3,
        link_quota=3,
        created_by=1,
    )
    oversized = LotteryCampaignStaff(
        campaign_id=1,
        user_id=4,
        link_quota=99,
        created_by=1,
    )
    assert _staff_link_quota(campaign, inherited) == 0
    assert _staff_link_quota(campaign, overridden) == 0
    assert _staff_link_quota(campaign, oversized) == 0
    assert _staff_link_quota(campaign, None) == 0
    assert campaign.max_links_per_employee == 8
    assert overridden.link_quota == 3 and oversized.link_quota == 99
    campaign.max_links_per_employee = 0
    assert _staff_link_quota(campaign, overridden) == 0


def test_staff_chance_override_cannot_exceed_campaign_cap() -> None:
    campaign = LotteryCampaign(
        id=1,
        slug="double11",
        title="双十一",
        max_chances_per_link=5,
        created_by=1,
    )
    inherited = LotteryCampaignStaff(
        campaign_id=1,
        user_id=2,
        max_chances_per_link=0,
        created_by=1,
    )
    oversized = LotteryCampaignStaff(
        campaign_id=1,
        user_id=3,
        max_chances_per_link=99,
        created_by=1,
    )
    assert _staff_chance_cap(campaign, inherited) == 1
    assert _staff_chance_cap(campaign, oversized) == 1


def test_public_serializers_do_not_leak_internal_customer_or_probability_data() -> None:
    link = LotteryInviteLink(
        id=9,
        campaign_id=1,
        public_code="public-code",
        customer_name="客户甲",
        customer_code="CRM-001",
        customer_note="内部跟进备注",
        chance_total=3,
        chance_used=1,
        status="active",
        created_by_user_id=2,
    )
    prize = _prize(1, "一等奖", 100_000)

    public_link = link_to_dict(link, public=True)
    public_prize = prize_to_dict(prize, public=True)

    assert public_link["remaining_chances"] == 0
    assert public_link["chance_limit"] == 1
    assert public_link["chance_total"] == 3  # The historical allocation is not rewritten.
    assert "customer_note" not in public_link
    assert "customer_code" not in public_link
    assert "created_by_user_id" not in public_link
    assert "probability_ppm" not in public_prize
    assert "stock_awarded" not in public_prize


def test_public_claim_serializer_only_exposes_tracking_state() -> None:
    claim = LotteryClaim(
        id=7,
        campaign_id=1,
        invite_link_id=9,
        draw_id=11,
        recipient_name="张三",
        recipient_phone="13800138000",
        recipient_address="内部收货地址",
        status="pending",
    )

    public_claim = claim_to_dict(claim, public=True)

    assert public_claim["status"] == "pending"
    assert "recipient_name" not in public_claim
    assert "recipient_phone" not in public_claim
    assert "recipient_address" not in public_claim


def test_execute_draw_retry_is_idempotent() -> None:
    link = LotteryInviteLink(
        id=10,
        campaign_id=1,
        public_code="customer-code",
        customer_name="客户",
        chance_total=3,
        chance_used=1,
        created_by_user_id=2,
    )
    existing = LotteryDraw(
        id=88,
        campaign_id=1,
        invite_link_id=10,
        request_id="request-12345678",
        draw_sequence=1,
        result_type="no_win",
        config_version=1,
        chance_before=3,
        chance_after=2,
        random_value=900_000,
    )
    db = _FakeSession(_FakeResult(scalar=link), _FakeResult(scalar=existing))

    outcome = _complete_without_event_loop(
        execute_draw(
            db,
            public_code=link.public_code,
            request_id=existing.request_id,
            client_ip="127.0.0.1",
            user_agent="pytest",
        )
    )

    assert outcome.idempotent is True
    assert outcome.draw is existing
    assert link.chance_used == 1
    assert db.added == []
    assert db.flush_count == 0


def test_sold_out_prize_is_excluded_and_an_available_prize_is_awarded() -> None:
    link = LotteryInviteLink(
        id=10,
        campaign_id=1,
        public_code="customer-code",
        customer_name="客户",
        chance_total=2,
        chance_used=0,
        status="active",
        created_by_user_id=2,
    )
    campaign = LotteryCampaign(
        id=1,
        slug="double11",
        title="双十一",
        status="published",
        config_version=7,
        created_by=1,
    )
    sold_out = _prize(1, "限量好酒", 500_000, sort_order=1)
    sold_out.stock_total = 1
    sold_out.stock_awarded = 1
    no_win = _prize(2, "优惠券", 500_000, prize_type="coupon", sort_order=2)
    db = _FakeSession(
        _FakeResult(scalar=link),
        _FakeResult(scalar=None),
        _FakeResult(scalar=campaign),
        _FakeResult(scalars=[sold_out, no_win]),
    )

    outcome = _complete_without_event_loop(
        execute_draw(
            db,
            public_code=link.public_code,
            request_id="request-12345678",
            client_ip="127.0.0.1",
            user_agent="pytest",
            random_value=0,
            now=datetime(2026, 11, 11, 12, 0, 0),
        )
    )

    assert outcome.idempotent is False
    assert outcome.draw.result_type == "win"
    assert outcome.draw.prize_id == no_win.id
    assert outcome.draw.prize_name_snapshot == no_win.name
    assert outcome.draw.chance_before == 1
    assert outcome.draw.chance_after == 0
    assert link.chance_total == 2  # Legacy allocation stays auditable.
    assert link.chance_used == 1
    assert sold_out.stock_awarded == 1
    assert no_win.stock_awarded == 1
    assert db.added == [outcome.draw]
    assert db.flush_count == 1
