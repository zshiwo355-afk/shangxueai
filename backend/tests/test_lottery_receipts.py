"""Manual redemption, historical receipt preservation and always-winning draws."""
from datetime import datetime

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app import lottery_api as api
from app.lottery_service import (
    ensure_pending_claim_for_win, execute_draw, receipt_state, select_prize_by_random,
    submit_link_receipt, validate_probability_config,
)
from app.models import LotteryClaim, LotteryInviteLink, LotteryPrize, User
from test_lottery_closure import Result, Session, campaign, claim, complete, draw, link, request, sql


def prize(prize_id=1, *, weight=1_000_000, stock=10, awarded=0, kind="physical", enabled=True):
    return LotteryPrize(id=prize_id, campaign_id=7, name=f"奖品{prize_id}", type=kind,
                        probability_ppm=weight, stock_total=stock, stock_awarded=awarded,
                        enabled=enabled, sort_order=prize_id)


def payload(**overrides):
    values = {"recipient_name": "客户甲", "recipient_phone": "13800138000", "recipient_address": "贵阳市测试路1号"}
    return {**values, **overrides}


def test_single_real_prize_is_valid_and_certain():
    only = prize()
    validate_probability_config([only])
    assert select_prize_by_random([only], 0) is only
    assert select_prize_by_random([only], 999999) is only
    api.CampaignProbabilitiesPayload(config_version=1, probabilities=[{"prize_id": 1, "probability_ppm": 1_000_000}])


def test_available_stock_weights_are_renormalized_without_rounding_loss():
    sold_out = prize(1, weight=300000, stock=1, awarded=1)
    first = prize(2, weight=100000)
    second = prize(3, weight=600000, kind="coupon")
    disabled = prize(4, weight=1000000, enabled=False)
    prizes = [sold_out, first, second, disabled]
    validate_probability_config(prizes)
    assert select_prize_by_random(prizes, 0) is first
    assert select_prize_by_random(prizes, 99999) is first
    assert select_prize_by_random(prizes, 100000) is second
    assert select_prize_by_random(prizes, 699999) is second
    with pytest.raises(ValueError):
        select_prize_by_random(prizes, 700000)


def test_zero_weight_and_sold_out_items_never_win():
    zero = prize(1, weight=0, stock=1000)
    last = prize(2, stock=1)
    validate_probability_config([zero, last])
    assert select_prize_by_random([zero, last], 999999) is last


def test_all_sold_out_draw_does_not_consume_chance_or_add_record():
    customer = link(used=0)
    empty = prize(stock=1, awarded=1)
    db = Session(Result(customer), Result(), Result(campaign()), Result(rows=[empty]))
    with pytest.raises(HTTPException, match="未扣减") as error:
        complete(execute_draw(db, public_code=customer.public_code, request_id="first-request",
                              expected_draw_sequence=1, client_ip="", user_agent=""))
    assert error.value.status_code == 409
    assert customer.chance_used == 0 and empty.stock_awarded == 1 and not db.added


def test_last_inventory_awarded_once_then_next_link_rejected():
    last = prize(stock=1)
    first_customer = link(used=0)
    first_db = Session(Result(first_customer), Result(), Result(campaign()), Result(rows=[last]))
    first = complete(execute_draw(first_db, public_code=first_customer.public_code, request_id="request-first",
                                 expected_draw_sequence=1, client_ip="", user_agent="", random_value=0))
    assert first.draw.result_type == "win" and last.stock_awarded == 1
    next_customer = link(used=0)
    next_customer.id = 11
    next_db = Session(Result(next_customer), Result(), Result(campaign()), Result(rows=[last]))
    with pytest.raises(HTTPException, match="库存"):
        complete(execute_draw(next_db, public_code="another-link", request_id="request-second",
                              expected_draw_sequence=1, client_ip="", user_agent=""))
    assert next_customer.chance_used == 0 and last.stock_awarded == 1 and not next_db.added
    assert all("FOR UPDATE" in sql(stmt) for stmt in next_db.statements)


def test_legacy_no_win_requires_explicit_admin_reconfiguration():
    real = prize(weight=900000)
    legacy = prize(2, weight=100000, kind="no_win", stock=0)
    with pytest.raises(HTTPException, match="历史“未中奖”"):
        validate_probability_config([real, legacy])
    with pytest.raises(ValidationError):
        api.PrizePayload(name="未中奖", type="no_win")
    with pytest.raises(ValidationError):
        api.PrizeUpdatePayload(type="no_win")
    # An explicit operator conversion is allowed; historical draw snapshots
    # remain separate and unchanged.
    assert api.PrizeUpdatePayload(type="coupon").type == "coupon"
    legacy.enabled = False
    real.probability_ppm = 1_000_000
    validate_probability_config([real, legacy])


def test_legacy_no_win_replay_preserves_original_outcome():
    previous = draw(result_type="no_win")
    customer = link(used=1)
    db = Session(Result(customer), Result(previous))
    outcome = complete(execute_draw(db, public_code=customer.public_code, request_id=previous.request_id,
                                   expected_draw_sequence=1, client_ip="", user_agent=""))
    assert outcome.idempotent and outcome.draw.result_type == "no_win" and customer.chance_used == 1


@pytest.mark.parametrize("used,wins", [(0, 0), (1, 1), (3, 3), (3, 0)])
def test_receipt_state_never_requests_new_contact_information(used, wins):
    customer = link(used=used)
    state = receipt_state(customer, wins)
    assert state == {"can_submit": False, "submitted": False, "required": False,
                     "win_count": wins, "manual_redemption": True}


@pytest.mark.parametrize("used,wins", [(1, 1), (3, 0), (3, 3)])
def test_server_rejects_all_new_receipts_without_reading_or_writing(used, wins):
    customer = link(used=used)
    db = Session(Result(wins))
    with pytest.raises(HTTPException) as error:
        complete(submit_link_receipt(db, link=customer, **payload()))
    assert error.value.status_code == 409
    assert "截图中奖信息联系销售人员兑奖" in error.value.detail
    assert not customer.receipt_submitted_at and not db.added and not db.flushes and not db.statements


def test_rejected_receipt_does_not_overwrite_historical_contact_data():
    customer = link(used=3)
    before = customer.receipt_submitted_at = datetime(2026, 10, 21)
    for key, value in payload().items():
        setattr(customer, key, value)
    db = Session()
    with pytest.raises(HTTPException):
        complete(submit_link_receipt(db, link=customer, **payload(recipient_address="替换地址")))
    assert customer.recipient_address == "贵阳市测试路1号" and customer.receipt_submitted_at == before
    assert not db.flushes and not db.statements and not db.added


def test_additional_chances_keep_receipt_and_new_winning_claim_inherits_it():
    customer = link(used=3, total=5)
    customer.receipt_submitted_at = datetime(2026, 10, 22)
    for key, value in payload().items():
        setattr(customer, key, value)
    assert receipt_state(customer, 3) == {"submitted": True, "required": False, "can_submit": False,
                                         "win_count": 3, "manual_redemption": True}
    db = Session(Result())
    new_claim = complete(ensure_pending_claim_for_win(db, draw=draw(sequence=4), link=customer))
    assert new_claim.recipient_name == customer.recipient_name
    assert new_claim.recipient_phone == customer.recipient_phone
    assert new_claim.recipient_address == customer.recipient_address


@pytest.mark.parametrize("values", [payload(recipient_name="  "), payload(recipient_address="  "),
                                    payload(recipient_phone="(---) +"), payload(recipient_phone="12345")])
def test_receipt_payload_requires_complete_trimmed_contact_fields(values):
    with pytest.raises(ValidationError):
        api.ReceiptPayload(**values)


def test_receipt_payload_accepts_formatted_phone_and_trims_text():
    result = api.ReceiptPayload(**payload(recipient_name=" 王 ", recipient_phone="+86 (138) 0013-8000", recipient_address=" 地址1 "))
    assert result.recipient_name == "王" and result.recipient_address == "地址1"


@pytest.mark.parametrize("status", ["published", "paused", "ended"])
def test_retired_receipt_endpoint_returns_business_error_without_mutation(status, monkeypatch):
    customer = link(used=3)
    customer.expires_at = datetime(2020, 1, 1)
    current = campaign(status)
    flags = {}

    async def context(_db, _code, *, lock=False):
        flags["lock"] = lock
        return current, customer

    monkeypatch.setattr(api, "_public_link_context", context)
    db = Session()
    with pytest.raises(HTTPException, match="截图中奖信息联系销售人员兑奖") as error:
        complete(api.public_receipt("private-code", db))
    assert error.value.status_code == 409 and not flags["lock"]
    assert not db.statements and not db.added and not db.flushes


def test_deleted_campaign_receipt_remains_unavailable():
    current = campaign("ended")
    current.deleted_at = datetime(2026, 10, 22)
    db = Session(Result(link(used=3)), Result(current))
    with pytest.raises(HTTPException) as error:
        complete(api.public_receipt("private-code", db))
    assert error.value.status_code == 404 and not db.added


def test_public_receipt_serializer_never_exposes_pii_but_authorized_link_does():
    customer = link(used=3)
    customer.receipt_submitted_at = datetime(2026, 10, 22, 10, 0)
    for key, value in payload().items():
        setattr(customer, key, value)
    public = api.receipt_to_dict(customer, 3)
    assert all(key not in public for key in payload())
    assert "receipt" not in api.link_to_dict(customer, public=True)
    private = api.link_to_dict(customer, win_count=3)
    assert private["receipt"]["recipient_phone"] == "13800138000"
    assert private["receipt"]["submitted_at"] == "2026-10-22T10:00:00Z"


def test_old_per_draw_claim_route_cannot_collect_contact_data():
    db = Session()
    with pytest.raises(HTTPException, match="截图中奖信息联系销售人员兑奖"):
        complete(api.public_claim("private-code", 88, api.ClaimPayload(**payload()), db))
    assert not db.statements and not db.added


@pytest.mark.parametrize("missing", ["recipient_name", "recipient_phone", "recipient_address"])
def test_offline_fulfilment_allows_missing_receipt_fields_and_preserves_terminal(missing):
    current = claim()
    for key, value in payload().items():
        setattr(current, key, value)
    setattr(current, missing, "")
    db = Session(Result(current))
    response = complete(api.update_claim_status(19, api.ClaimStatusPayload(status="fulfilled", expected_revision=api.claim_revision(current)), db, User(id=1)))
    assert response["item"]["status"] == "fulfilled" and current.fulfilled_at and len(db.added) == 1
    assert "FOR UPDATE" in sql(db.statements[0]) and current.operator_id == 1
    before = current.fulfilled_at
    response = complete(api.update_claim_status(19, api.ClaimStatusPayload(status="fulfilled", expected_revision=api.claim_revision(current)), Session(Result(current)), User(id=1)))
    assert response["item"]["status"] == "fulfilled" and current.fulfilled_at == before


def test_new_schema_fields_have_old_writer_compatible_defaults():
    columns = LotteryInviteLink.__table__.columns
    for name in payload():
        assert columns[name].server_default.arg == "" and not columns[name].nullable
    assert columns["receipt_submitted_at"].nullable


@pytest.mark.parametrize("phone", ["++++++", "(---) +", "12345", "letters123456"])
def test_legacy_phone_format_does_not_block_offline_fulfilment_or_get_rewritten(phone):
    current = claim()
    for key, value in payload(recipient_phone=phone).items():
        setattr(current, key, value)
    db = Session(Result(current))
    complete(api.update_claim_status(19, api.ClaimStatusPayload(status="fulfilled", expected_revision=api.claim_revision(current)), db, User(id=1)))
    assert current.status == "fulfilled" and current.recipient_phone == phone and len(db.added) == 1
