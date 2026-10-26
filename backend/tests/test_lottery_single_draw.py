"""One draw per link, including old links, with immutable historical records."""
from types import SimpleNamespace

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app import lottery_api as api
from app.lottery_policy import remaining_link_chances
from app.lottery_service import execute_draw
from app.models import LotteryAuditLog, LotteryCampaignStaff, LotteryInviteLink, LotteryPrize, User
from test_lottery_closure import Result, Session, campaign, complete, draw, link, request, sql


@pytest.mark.parametrize("total,used,remaining", [
    (1, 0, 1), (10, 0, 1), (100, 0, 1), (3, 1, 0), (3, 2, 0), (100, 100, 0),
    (0, 0, 0), (0, 3, 0), (None, None, 0), (-1, 0, 0),
])
def test_remaining_policy_keeps_original_allocation_and_usage(total, used, remaining):
    customer = link(total=total, used=used)
    assert remaining_link_chances(customer) == remaining
    for public in (True, False):
        result = api.link_to_dict(customer, public=public)
        assert result["remaining_chances"] == remaining and result["chance_limit"] == 1
        assert result["chance_total"] == (total or 0) and result["chance_used"] == (used or 0)
    assert customer.chance_total == total and customer.chance_used == used


def test_campaign_serializers_and_staff_limits_apply_current_policy_without_mutation():
    current = campaign()
    staff = LotteryCampaignStaff(user_id=5, max_chances_per_link=9)
    assert api.campaign_to_dict(current)["max_chances_per_link"] == 1
    assert api.campaign_to_dict(current, public=True)["max_chances_per_link"] == 1
    assert api._staff_chance_cap(current, staff) == 1
    assert api._staff_chance_cap(current, None) == 1
    assert current.max_chances_per_link == 10 and staff.max_chances_per_link == 9


@pytest.mark.parametrize("used,expected", [(1, None), (1, 2), (2, 3), (10, 11)])
def test_legacy_links_cannot_consume_a_second_draw(used, expected):
    customer = link(total=100, used=used)
    db = Session(Result(customer), Result(), Result(campaign()))
    with pytest.raises(HTTPException, match="次数已用完") as error:
        complete(execute_draw(db, public_code=customer.public_code, request_id="fresh-request-002",
                              expected_draw_sequence=expected, client_ip="", user_agent=""))
    assert error.value.status_code == 409
    assert customer.chance_total == 100 and customer.chance_used == used
    assert not db.added and not db.flushes
    assert all("FOR UPDATE" in sql(statement) for statement in db.statements)


def test_success_then_fresh_request_cannot_win_twice_even_with_legacy_allocation():
    customer = link(total=100, used=0)
    prize = LotteryPrize(id=2, campaign_id=7, name="礼盒", type="physical", enabled=True,
                         probability_ppm=1_000_000, stock_total=10, stock_awarded=0)
    first_db = Session(Result(customer), Result(), Result(campaign()), Result(rows=[prize]))
    first = complete(execute_draw(first_db, public_code=customer.public_code, request_id="first-request-001",
                                  expected_draw_sequence=1, client_ip="", user_agent="", random_value=0))
    assert first.draw.chance_before == 1 and first.draw.chance_after == 0
    assert customer.chance_total == 100 and customer.chance_used == 1 and prize.stock_awarded == 1
    second_db = Session(Result(customer), Result(), Result(campaign()))
    with pytest.raises(HTTPException, match="次数已用完"):
        complete(execute_draw(second_db, public_code=customer.public_code, request_id="second-request-002",
                              expected_draw_sequence=2, client_ip="", user_agent="", random_value=0))
    assert customer.chance_total == 100 and customer.chance_used == 1 and prize.stock_awarded == 1
    assert not second_db.added and not second_db.flushes


@pytest.mark.parametrize("sequence,used", [(1, 1), (2, 3)])
def test_old_draw_replay_preserves_historical_values_but_does_not_restore_chances(sequence, used):
    customer, previous = link(total=10, used=used), draw(sequence=sequence)
    db = Session(Result(customer), Result(previous))
    result = complete(execute_draw(db, public_code=customer.public_code, request_id=previous.request_id,
                                  expected_draw_sequence=sequence, client_ip="", user_agent=""))
    assert result.idempotent and result.draw is previous and not db.added
    assert api.draw_to_dict(previous)["remaining_chances"] == 0
    assert api.link_to_dict(customer)["remaining_chances"] == 0
    assert previous.chance_before == 3 and previous.chance_after == 2
    assert customer.chance_used == used and customer.chance_total == 10


@pytest.mark.parametrize("value", [0, 2, 10, 100, 1.5, "1", True])
def test_old_clients_cannot_create_multichance_or_ambiguous_links(value):
    with pytest.raises(ValidationError):
        api.LinkCreatePayload(campaign_id=7, customer_name="张先生", chance_total=value)


def test_http_old_client_multichance_creation_rejected_before_mutation():
    app = FastAPI()
    app.include_router(api.employee_router)
    db = Session()

    async def database():
        yield db

    app.dependency_overrides[api.get_db] = database
    app.dependency_overrides[api.get_current_user] = lambda: User(id=5, role="user")
    with TestClient(app) as client:
        response = client.post("/api/lottery/links", json={"campaign_id": 7, "customer_name": "张先生", "chance_total": 10})
    assert response.status_code == 422
    assert not db.statements and not db.added and not db.flushes


@pytest.mark.parametrize("payload_type", [api.CampaignPayload, api.CampaignUpdatePayload])
def test_campaign_settings_cannot_authorize_multiple_draws(payload_type):
    with pytest.raises(ValidationError):
        payload_type(title="活动", max_chances_per_link=10)
    assert payload_type(title="活动", max_chances_per_link=1).max_chances_per_link == 1


def test_link_creation_defaults_to_one_without_legacy_link_quota():
    payload = api.LinkCreatePayload(campaign_id=7, customer_name="张先生")
    current = campaign()
    current.max_links_per_employee = 5

    class CreationSession(Session):
        async def refresh(self, value):
            value.id = 23
            value.chance_used = 0

    db = CreationSession(Result(current))
    result = complete(api.create_link(payload, request(), db, User(id=5, role="admin")))
    created = next(item for item in db.added if isinstance(item, LotteryInviteLink))
    assert created.chance_total == 1
    assert result["item"]["chance_limit"] == result["item"]["remaining_chances"] == 1
    assert len(db.statements) == 1
    assert current.max_links_per_employee == 5


@pytest.mark.parametrize("admin_mode", [True, False])
@pytest.mark.parametrize("total", [None, 1, 10])
def test_adjust_endpoint_cannot_add_reset_or_reduce_historical_chances(admin_mode, total):
    customer = link(total=10, used=1)
    db = Session(Result(customer), Result(campaign()), Result(SimpleNamespace(enabled=True)))
    actor = User(id=5, role="admin" if admin_mode else "user")
    with pytest.raises(HTTPException, match="不支持追加或调整次数") as error:
        complete(api._perform_link_action(10, api.LinkActionPayload(action="adjust", chance_total=total),
                                          request(), db, actor, admin_mode=admin_mode))
    assert error.value.status_code == 409 and not db.added and not db.flushes
    assert customer.chance_total == 10 and customer.chance_used == 1 and customer.version == 2


def test_reenable_never_resets_exhausted_legacy_link():
    customer = link(total=100, used=1)
    customer.status = "disabled"
    db = Session(Result(customer), Result(campaign()), Result(User(id=5)), Result(1))
    result = complete(api._perform_link_action(10, api.LinkActionPayload(action="enable"), request(),
                                              db, User(id=1, role="admin"), admin_mode=True))
    assert customer.status == "active" and customer.chance_total == 100 and customer.chance_used == 1
    assert result["item"]["remaining_chances"] == 0


def test_staff_edit_retires_link_quota_and_normalizes_inherited_chances(monkeypatch):
    assignment = LotteryCampaignStaff(id=6, campaign_id=7, user_id=5, enabled=True,
                                      link_quota=50, max_chances_per_link=10)

    async def listing(*_args):
        return {"items": []}

    monkeypatch.setattr(api, "list_campaign_staff", listing)
    db = Session(Result(campaign()), Result(rows=[assignment]), Result(rows=[User(id=5, disabled=False)]))
    complete(api.replace_campaign_staff(7, api.StaffPayload(assignments=[{
        "user_id": 5, "enabled": True, "link_quota": 60, "max_chances_per_link": 0,
    }]), db, User(id=1)))
    assert assignment.link_quota == 0 and assignment.max_chances_per_link == 1
    audit = next(item for item in db.added if isinstance(item, LotteryAuditLog))
    assert '"max_chances_per_link": 1' in audit.after_json
    assert '"link_quota": 50' in audit.before_json
    assert '"link_quota": 0' in audit.after_json


def test_staff_edit_rejects_legacy_multiple_chances_before_writes():
    db = Session(Result(campaign()))
    with pytest.raises(HTTPException, match="仅可抽奖 1 次"):
        complete(api.replace_campaign_staff(7, api.StaffPayload(assignments=[{
            "user_id": 5, "enabled": True, "max_chances_per_link": 2,
        }]), db, User(id=1)))
    assert not db.added and not db.flushes
