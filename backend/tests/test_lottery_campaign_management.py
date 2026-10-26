"""Regression coverage for campaign archives and atomic live probability edits."""
import json
from datetime import datetime

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app import lottery_api
from app.auth import require_admin
from app.lottery_api import CampaignProbabilitiesPayload
from app.lottery_service import execute_draw
from app.models import LotteryAuditLog, LotteryCampaign, LotteryDraw, LotteryInviteLink, LotteryPrize, User


def complete(coroutine):
    # Fake async DB methods never suspend; avoids opening a Windows event loop.
    try:
        coroutine.send(None)
    except StopIteration as exc:
        return exc.value
    raise AssertionError("test coroutine unexpectedly yielded")


class Result:
    def __init__(self, value=None, rows=()):
        self.value = value
        self.rows = list(rows)

    def scalar_one_or_none(self):
        return self.value

    def scalar_one(self):
        return self.value

    def scalars(self):
        return self.rows


class Session:
    def __init__(self, *results):
        self.results = list(results)
        self.statements = []
        self.added = []
        self.refreshed = []
        self.flushes = 0

    async def execute(self, statement):
        self.statements.append(statement)
        return self.results.pop(0)

    async def get(self, _model, _id):
        return self.results.pop(0).value

    def add(self, value):
        self.added.append(value)

    async def flush(self):
        self.flushes += 1

    async def refresh(self, value):
        self.refreshed.append(value)


def campaign(*, deleted=False):
    return LotteryCampaign(
        id=7, slug="double11-test", title="双十一客户抽奖", status="published",
        config_version=8, created_by=1, updated_by=1,
        deleted_at=datetime(2026, 10, 22) if deleted else None,
    )


def prizes():
    return [
        LotteryPrize(id=21, campaign_id=7, name="酒礼盒", type="physical", enabled=True,
                     probability_ppm=200_000, stock_total=100, stock_awarded=3, created_by=1),
        LotteryPrize(id=22, campaign_id=7, name="优惠券", type="coupon", enabled=True,
                     probability_ppm=800_000, stock_total=100, stock_awarded=0, created_by=1),
        LotteryPrize(id=23, campaign_id=7, name="停用奖品", type="physical", enabled=False,
                     probability_ppm=100_000, stock_total=100, stock_awarded=0, created_by=1),
    ]


def payload(*, version=8, entries=None):
    return CampaignProbabilitiesPayload(
        config_version=version,
        probabilities=entries or [
            {"prize_id": 21, "probability_ppm": 300_000},
            {"prize_id": 22, "probability_ppm": 700_000},
        ],
    )


def test_published_probability_edit_is_complete_versioned_and_audited():
    current = campaign()
    rows = prizes()
    historical = LotteryDraw(prize_probability_ppm_snapshot=200_000, config_version=8)
    db = Session(Result(current), Result(rows=rows))

    result = complete(lottery_api.update_campaign_probabilities(7, payload(), db, User(id=9)))

    assert [row.probability_ppm for row in rows] == [300_000, 700_000, 100_000]
    assert [row.stock_awarded for row in rows] == [3, 0, 0]
    assert current.status == "published"
    assert current.config_version == 9
    assert current.updated_by == 9
    assert result["item"]["config_version"] == 9
    assert len(result["items"]) == 3
    assert historical.prize_probability_ppm_snapshot == 200_000
    assert historical.config_version == 8
    assert db.flushes == 1
    assert db.refreshed == [current, rows[0], rows[1]]
    assert all(stmt._for_update_arg is not None for stmt in db.statements)
    assert "lottery_campaigns" in str(db.statements[0])
    assert "lottery_prizes.campaign_id" in str(db.statements[1])
    assert isinstance(db.added[0], LotteryAuditLog)
    assert db.added[0].action == "probabilities"
    assert json.loads(db.added[0].before_json)["config_version"] == 8
    assert json.loads(db.added[0].after_json)["prizes"][0]["probability_ppm"] == 300_000
    # The next draw uses the new 30% band and records its new version; older
    # records retain their original 20% snapshot/version.
    link = LotteryInviteLink(id=19, campaign_id=7, public_code="customer", chance_total=2,
                             chance_used=0, status="active", version=1)
    draw_db = Session(Result(link), Result(None), Result(current), Result(rows=rows[:2]))
    outcome = complete(execute_draw(draw_db, public_code="customer", request_id="new-version-draw",
                                   client_ip="127.0.0.1", user_agent="pytest", random_value=250_000))
    assert outcome.draw.result_type == "win"
    assert outcome.draw.prize_probability_ppm_snapshot == 300_000
    assert outcome.draw.config_version == 9
    assert historical.prize_probability_ppm_snapshot == 200_000
    assert historical.config_version == 8


@pytest.mark.parametrize("entries, detail", [
    ([{"prize_id": 21, "probability_ppm": 300_000}, {"prize_id": 22, "probability_ppm": 600_000}], "100%"),
    ([{"prize_id": 21, "probability_ppm": 300_000}, {"prize_id": 21, "probability_ppm": 700_000}], "重复"),
    ([{"prize_id": 21, "probability_ppm": 300_000}, {"prize_id": 999, "probability_ppm": 700_000}], "全部启用"),
    ([{"prize_id": 21, "probability_ppm": 300_000}, {"prize_id": 23, "probability_ppm": 700_000}], "全部启用"),
])
def test_invalid_probability_batch_never_mutates_existing_values(entries, detail):
    current = campaign()
    rows = prizes()
    db = Session(Result(current), Result(rows=rows))
    with pytest.raises(HTTPException, match=detail):
        complete(lottery_api.update_campaign_probabilities(7, payload(entries=entries), db, User(id=9)))
    assert [row.probability_ppm for row in rows] == [200_000, 800_000, 100_000]
    assert current.config_version == 8
    assert db.flushes == 0
    assert db.added == []


def test_stale_probability_editor_is_rejected_before_reading_prizes():
    db = Session(Result(campaign()))
    with pytest.raises(HTTPException, match="刷新") as error:
        complete(lottery_api.update_campaign_probabilities(7, payload(version=7), db, User(id=9)))
    assert error.value.status_code == 409
    assert len(db.statements) == 1
    assert db.flushes == 0


def test_probability_edit_rejects_legacy_no_win_configuration():
    rows = prizes()
    rows[1].type = "no_win"
    db = Session(Result(campaign()), Result(rows=rows))
    with pytest.raises(HTTPException, match="未中奖"):
        complete(lottery_api.update_campaign_probabilities(7, payload(), db, User(id=9)))
    assert rows[0].probability_ppm == 200_000
    assert db.flushes == 0


@pytest.mark.parametrize("probability", [-1, 1_000_001, 0.1, "100000", True])
def test_probability_payload_rejects_invalid_units(probability):
    with pytest.raises(ValidationError):
        payload(entries=[{"prize_id": 21, "probability_ppm": probability}, {"prize_id": 22, "probability_ppm": 700_000}])


def test_campaign_delete_is_soft_and_audited_then_idempotent():
    current = campaign()
    db = Session(Result(current), Result(current))
    result = complete(lottery_api.delete_campaign(7, db, User(id=9)))
    assert current.deleted_at is not None
    assert current.status == "ended"
    assert current.config_version == 9
    assert result["item"]["status"] == "deleted"
    assert result["item"]["can_create_links"] is False
    assert result["item"]["deleted_at"] is not None
    assert len(db.added) == 1
    assert isinstance(db.added[0], LotteryAuditLog)
    assert db.added[0].action == "delete"
    assert db.statements[0]._for_update_arg is not None
    # No linked entities are queried, overwritten or deleted.
    assert all("lottery_invite_links" not in str(stmt) and "lottery_draws" not in str(stmt) for stmt in db.statements)
    repeated = complete(lottery_api.delete_campaign(7, db, User(id=9)))
    assert repeated == result
    assert len(db.added) == 1
    assert db.flushes == 1


def test_deleted_campaign_cannot_be_edited_but_archive_can_be_read():
    current = campaign(deleted=True)
    db = Session(Result(current), Result(current))
    with pytest.raises(HTTPException) as error:
        complete(lottery_api.update_campaign_probabilities(7, payload(), db, User(id=9)))
    assert error.value.status_code == 404
    assert complete(lottery_api._campaign_or_404(db, 7, allow_deleted=True)) is current
    assert db.flushes == 0


@pytest.mark.parametrize("include_deleted", [False, True])
def test_campaign_listing_requires_explicit_archive_opt_in(include_deleted):
    db = Session(Result(0), Result(rows=[]))
    complete(lottery_api.admin_campaigns(page=1, page_size=20, keyword="", status="", include_deleted=include_deleted, db=db, _=User(id=9)))
    for statement in db.statements:
        assert ("lottery_campaigns.deleted_at IS NULL" in str(statement)) is (not include_deleted)


def test_delete_and_probability_routes_require_admin_role():
    operations = [route for route in lottery_api.admin_router.routes if route.endpoint in {
        lottery_api.delete_campaign, lottery_api.update_campaign_probabilities,
    }]
    assert len(operations) == 2
    assert all(any(dependency.call is require_admin for dependency in route.dependant.dependencies) for route in operations)
    with pytest.raises(HTTPException) as error:
        complete(require_admin(User(id=3, role="user")))
    assert error.value.status_code == 403


def test_deleted_campaign_prevents_new_draw_without_spending_chance():
    link = LotteryInviteLink(id=19, campaign_id=7, public_code="customer", chance_total=2, chance_used=0)
    db = Session(Result(link), Result(None), Result(None))
    with pytest.raises(HTTPException) as error:
        complete(execute_draw(db, public_code="customer", request_id="fresh-draw", client_ip="127.0.0.1", user_agent="pytest"))
    assert error.value.status_code == 404
    assert "lottery_campaigns.deleted_at IS NULL" in str(db.statements[2])
    assert link.chance_used == 0
    assert db.flushes == 0
    assert db.added == []


def test_deleted_campaign_public_page_cannot_be_opened():
    link = LotteryInviteLink(id=19, campaign_id=7, public_code="customer")
    db = Session(Result(link), Result(campaign(deleted=True)))
    with pytest.raises(HTTPException) as error:
        complete(lottery_api._public_link_context(db, "customer"))
    assert error.value.status_code == 404
    assert db.flushes == 0
