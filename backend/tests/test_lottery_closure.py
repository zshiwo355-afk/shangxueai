"""Server-authoritative retries, fulfilment CAS, historical access and repair."""
from datetime import datetime, timedelta

import pytest
from fastapi import HTTPException, Request
from pydantic import ValidationError

from app import lottery_api as api
from app import lottery_maintenance as maintenance
from app.lottery_service import (
    DrawOutcome, backfill_missing_lottery_claims, execute_draw, find_missing_lottery_claims,
)
from app.models import (
    LotteryAuditLog, LotteryCampaign, LotteryCampaignStaff, LotteryClaim, LotteryDraw,
    LotteryInviteLink, LotteryPrize, User,
)


def complete(coroutine):
    try:
        coroutine.send(None)
    except StopIteration as exc:
        return exc.value
    raise AssertionError("fake DB unexpectedly suspended")


class Result:
    def __init__(self, value=None, rows=()):
        self.value, self.rows = value, list(rows)

    def scalar_one_or_none(self):
        return self.value

    def scalar_one(self):
        return self.value

    def scalars(self):
        return self.rows

    def all(self):
        return self.rows


class Session:
    def __init__(self, *results):
        self.results, self.statements, self.added = list(results), [], []
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
        pass


def sql(statement):
    return str(statement.compile(compile_kwargs={"literal_binds": True}))


def link(*, used=1, total=3):
    return LotteryInviteLink(
        id=10, campaign_id=7, public_code="customer-private-token", customer_name="客户甲",
        customer_code="CRM-009", customer_note="internal", chance_total=total, chance_used=used,
        created_by_user_id=5, status="active", version=2,
    )


def draw(*, sequence=1, result_type="win"):
    return LotteryDraw(
        id=88, campaign_id=7, invite_link_id=10, request_id="old-request-001", draw_sequence=sequence,
        result_type=result_type, prize_id=2, prize_type_snapshot="physical", prize_name_snapshot="礼盒",
        config_version=2, chance_before=3, chance_after=2, random_value=10,
    )


def campaign(status="published"):
    return LotteryCampaign(id=7, slug="test", title="抽奖", status=status, max_chances_per_link=10,
                           max_links_per_employee=100, created_by=1, config_version=9)


def claim(status="pending"):
    return LotteryClaim(id=19, campaign_id=7, invite_link_id=10, draw_id=88, recipient_name="客户甲",
                        recipient_phone="", status=status, operator_remark="", updated_at=datetime(2026, 10, 22))


def request():
    return Request({"type": "http", "scheme": "https", "server": ("example.test", 443),
                    "path": "/", "headers": [], "client": ("127.0.0.1", 123)})


def test_new_request_id_replays_expected_sequence_without_consuming_again():
    customer, previous = link(used=3), draw()
    db = Session(Result(customer), Result(), Result(previous))
    result = complete(execute_draw(db, public_code=customer.public_code, request_id="new-request-002",
                                  expected_draw_sequence=1, client_ip="", user_agent=""))
    assert result.idempotent and result.draw is previous
    assert result.link.chance_used == 3 and db.added == []
    assert all("FOR UPDATE" in sql(item) for item in db.statements)
    assert "lottery_draws.draw_sequence = 1" in sql(db.statements[-1])
    # Replay does not load/validate the campaign: paused, ended or exhausted
    # activity can still recover the already committed outcome.
    assert len(db.statements) == 3


@pytest.mark.parametrize("expected", [0, 3])
def test_invalid_or_future_sequence_never_draws(expected):
    customer = link(used=1)
    db = Session(Result(customer), Result())
    with pytest.raises(HTTPException) as error:
        complete(execute_draw(db, public_code=customer.public_code, request_id="request-002",
                              expected_draw_sequence=expected, client_ip="", user_agent=""))
    assert error.value.status_code in {400, 409}
    assert customer.chance_used == 1 and db.added == []


def test_request_id_cannot_be_reused_for_another_sequence():
    db = Session(Result(link()), Result(draw()))
    with pytest.raises(HTTPException, match="序号不一致"):
        complete(execute_draw(db, public_code="code", request_id="old-request-001",
                              expected_draw_sequence=2, client_ip="", user_agent=""))


def test_missing_persisted_sequence_fails_closed():
    db = Session(Result(link()), Result(), Result())
    with pytest.raises(HTTPException, match="记录与次数不一致"):
        complete(execute_draw(db, public_code="code", request_id="new-request-002",
                              expected_draw_sequence=1, client_ip="", user_agent=""))
    assert not db.added


def test_expected_next_sequence_consumes_exactly_one_chance():
    customer = link(used=0)
    prizes = [
        LotteryPrize(id=2, campaign_id=7, name="礼盒", type="physical", enabled=True,
                     probability_ppm=500_000, stock_total=10, stock_awarded=0),
        LotteryPrize(id=3, campaign_id=7, name="优惠券", type="coupon", enabled=True,
                     probability_ppm=500_000, stock_total=100, stock_awarded=0),
    ]
    db = Session(Result(customer), Result(), Result(campaign()), Result(rows=prizes))
    outcome = complete(execute_draw(db, public_code=customer.public_code, request_id="next-request-002",
                                   expected_draw_sequence=1, client_ip="", user_agent="", random_value=0))
    assert not outcome.idempotent and outcome.draw.draw_sequence == 1
    assert customer.chance_used == 1 and outcome.draw.chance_after == 0
    assert customer.chance_total == 3
    assert prizes[0].stock_awarded == 1 and len(db.added) == 1


@pytest.mark.parametrize("value", [0, -1, 1.5, "1", True])
def test_draw_sequence_payload_is_strict_positive_integer(value):
    with pytest.raises(ValidationError):
        api.DrawPayload(request_id="request-123", expected_draw_sequence=value)


def test_draw_response_rehydrates_latest_public_snapshot_without_leaks(monkeypatch):
    customer, previous, current_campaign = link(used=3), draw(), campaign("paused")
    current_prize = LotteryPrize(id=5, name="最新奖品", campaign_id=7, type="physical", enabled=True,
                                 probability_ppm=123456, stock_total=9, stock_awarded=2)
    received = {}

    async def execute(_db, **kwargs):
        received.update(kwargs)
        return DrawOutcome(previous, customer, True)

    monkeypatch.setattr(api, "execute_draw", execute)
    db = Session(Result(current_campaign), Result(rows=[current_prize]), Result(claim()),
                 Result(rows=[(2, "礼盒", "", 3)]))
    response = complete(api.public_draw(customer.public_code,
                                        api.DrawPayload(request_id="new-request", expected_draw_sequence=1), request(), db))
    assert received["expected_draw_sequence"] == 1
    assert response["draw"]["remaining_chances"] == 0
    assert previous.chance_after == 2  # Persisted historical snapshot remains immutable.
    assert response["remaining_chances"] == response["link"]["remaining_chances"] == 0
    assert response["campaign"]["status"] == "paused" and response["campaign"]["config_version"] == 9
    assert response["prizes"][0]["id"] == 5
    assert "probability_ppm" not in response["prizes"][0]
    assert "customer_code" not in response["link"] and "revision" not in response["draw"]
    assert response["winning_summary"]["total_wins"] == 3
    assert response["receipt"]["manual_redemption"] and not response["receipt"]["can_submit"]


def test_public_replay_does_not_reopen_archived_campaign(monkeypatch):
    archived = campaign("ended")
    archived.deleted_at = datetime(2026, 10, 22)

    async def execute(_db, **_kwargs):
        return DrawOutcome(draw(), link(), True)

    monkeypatch.setattr(api, "execute_draw", execute)
    with pytest.raises(HTTPException) as error:
        complete(api.public_draw("private-code", api.DrawPayload(request_id="new-request-002", expected_draw_sequence=1),
                                 request(), Session(Result(archived))))
    assert error.value.status_code == 404


def test_public_page_does_not_implicitly_repair_historical_claims(monkeypatch):
    async def context(_db, _code, **_kwargs):
        return campaign(), link()

    monkeypatch.setattr(api, "_public_link_context", context)
    db = Session(Result(rows=[]), Result(rows=[draw()]), Result(rows=[]), Result(rows=[(2, "礼盒", "", 1)]))
    response = complete(api.public_lottery("private-code", request(), db))
    assert response["recent_draws"][0]["claim_status"] == "unclaimed"
    assert response["winning_summary"]["total_wins"] == 1
    assert not db.added and db.flushes == 0


@pytest.mark.parametrize("source,target", [("pending", "contacted"), ("pending", "fulfilled"),
                                           ("pending", "cancelled"), ("contacted", "fulfilled"),
                                           ("contacted", "cancelled")])
def test_claim_allowed_transitions_use_lock_revision_and_audit(source, target):
    current = claim(source)
    current.recipient_phone = "13800138000"
    current.recipient_address = "测试地址1号"
    revision = api.claim_revision(current)
    db = Session(Result(current))
    result = complete(api.update_claim_status(19, api.ClaimStatusPayload(
        status=target, remark="完成跟进", expected_revision=revision), db, User(id=3)))
    assert result["item"]["status"] == target and result["item"]["revision"] != revision
    assert "FOR UPDATE" in sql(db.statements[0])
    assert any(isinstance(item, LotteryAuditLog) for item in db.added)
    assert bool(current.fulfilled_at) == (target == "fulfilled")


def test_stale_claim_revision_cannot_overwrite_another_admin():
    current = claim()
    revision = api.claim_revision(current)
    current.operator_remark = "另一个管理员的更新"
    db = Session(Result(current))
    with pytest.raises(HTTPException, match="其他管理员") as error:
        complete(api.update_claim_status(19, api.ClaimStatusPayload(status="fulfilled", expected_revision=revision), db, User(id=3)))
    assert error.value.status_code == 409
    assert current.status == "pending" and not db.added and db.flushes == 0


@pytest.mark.parametrize("status", ["fulfilled", "cancelled"])
def test_terminal_claim_is_readonly_and_same_retry_does_not_reset_timestamps(status):
    current = claim(status)
    current.fulfilled_at = datetime(2026, 10, 21) if status == "fulfilled" else None
    before = (current.fulfilled_at, current.updated_at)
    db = Session(Result(current))
    result = complete(api.update_claim_status(19, api.ClaimStatusPayload(status=status, expected_revision="0" * 64), db, User(id=3)))
    assert result["item"]["status"] == status
    assert (current.fulfilled_at, current.updated_at) == before and db.flushes == 0 and not db.added
    with pytest.raises(HTTPException, match="终态"):
        complete(api.update_claim_status(19, api.ClaimStatusPayload(status="contacted", expected_revision=api.claim_revision(current)), Session(Result(current)), User(id=3)))
    assert (current.fulfilled_at, current.updated_at) == before


def test_contacted_claim_cannot_revert_to_pending():
    current = claim("contacted")
    with pytest.raises(HTTPException, match="回退"):
        complete(api.update_claim_status(19, api.ClaimStatusPayload(status="pending", expected_revision=api.claim_revision(current)), Session(Result(current)), User(id=3)))


def test_claim_revision_not_exposed_to_public_clients():
    current = claim()
    assert len(api.claim_to_dict(current)["revision"]) == 64
    assert "revision" not in api.claim_to_dict(current, public=True)
    with pytest.raises(ValidationError):
        api.ClaimStatusPayload(status="fulfilled")


def test_admin_claims_show_owner_and_missing_count_without_writing():
    current, customer = claim(), link()
    owner = User(id=5, real_name="员工乙")
    db = Session(Result(1), Result(rows=[(current, draw(), customer, owner)]), Result(rows=[(99, 7, 10)]))
    response = complete(api.admin_claims(7, "", 1, 20, db, User(id=1)))
    item = response["items"][0]
    assert item["created_by_user_id"] == 5 and item["created_by_name"] == "员工乙"
    assert item["customer_code"] == "CRM-009" and item["invite_link_id"] == 10
    assert item["remaining_chances"] == 0 and response["missing_claim_count"] == 1
    assert not db.added and db.flushes == 0


def test_employee_campaigns_retain_authorized_histories_but_exclude_drafts():
    staff = LotteryCampaignStaff(user_id=5, enabled=True, link_quota=0, max_chances_per_link=0)
    current, paused, ended, deleted = [campaign(status) for status in ["published", "paused", "ended", "ended"]]
    deleted.deleted_at = datetime(2026, 10, 22)
    current.end_at = datetime.utcnow() - timedelta(days=1)  # Published but elapsed.
    db = Session(Result(rows=[(row, staff) for row in [current, paused, ended, deleted]]))
    response = complete(api.employee_campaigns(db, User(id=5, role="user")))
    assert len(response["items"]) == 4
    assert all(not row["can_create_links"] for row in response["items"])
    statement = sql(db.statements[0])
    assert "status != 'draft'" in statement and "user_id = 5" in statement
    assert "enabled IS true" in statement and "deleted_at IS NULL" not in statement


@pytest.mark.parametrize("status", ["paused", "ended"])
@pytest.mark.parametrize("action", ["adjust", "enable"])
def test_historical_campaign_link_cannot_be_adjusted_or_enabled(status, action):
    db = Session(Result(link()), Result(campaign(status)))
    with pytest.raises(HTTPException, match="不支持追加或调整次数" if action == "adjust" else "不能启用"):
        complete(api._perform_link_action(10, api.LinkActionPayload(action=action, chance_total=5),
                                          request(), db, User(id=1, role="admin"), admin_mode=True))
    assert not db.added


def test_archived_history_still_checks_staff_authorization():
    archived = campaign("ended")
    archived.deleted_at = datetime(2026, 10, 22)
    db = Session(Result(link()), Result(archived), Result())
    with pytest.raises(HTTPException) as error:
        complete(api.employee_link_actions(10, 1, 20, db, User(id=5, role="user")))
    assert error.value.status_code == 403


def test_staff_response_marks_disabled_users_for_safe_revocation():
    staff = LotteryCampaignStaff(id=6, campaign_id=7, user_id=5, enabled=True)
    db = Session(Result(campaign()), Result(rows=[(staff, User(id=5, disabled=True, real_name="已离职员工"))]))
    response = complete(api.list_campaign_staff(7, db, User(id=1)))
    assert response["items"][0]["user_disabled"] is True


def test_staff_revocation_accepts_disabled_historical_user(monkeypatch):
    assignment = LotteryCampaignStaff(id=6, campaign_id=7, user_id=5, enabled=True, link_quota=100, max_chances_per_link=10)

    async def listing(*_args):
        return {"items": []}

    monkeypatch.setattr(api, "list_campaign_staff", listing)
    current = campaign()
    current.max_chances_per_link = 1
    db = Session(Result(current), Result(rows=[assignment]), Result(rows=[User(id=5, disabled=True)]))
    complete(api.replace_campaign_staff(7, api.StaffPayload(assignments=[{
        "user_id": 5, "enabled": False, "link_quota": 100, "max_chances_per_link": 10,
    }]), db, User(id=1)))
    assert assignment.enabled is False and any(isinstance(item, LotteryAuditLog) for item in db.added)


@pytest.mark.parametrize("users", [[], [User(id=5, disabled=True)]])
def test_new_authorization_rejects_nonexistent_or_disabled_user(users):
    db = Session(Result(campaign()), Result(rows=[]), Result(rows=users))
    with pytest.raises(HTTPException, match="不存在或已禁用"):
        complete(api.replace_campaign_staff(7, api.StaffPayload(assignments=[{"user_id": 5, "enabled": True}]), db, User(id=1)))
    assert not db.added


def test_omitted_historical_assignment_is_revoked_not_deleted(monkeypatch):
    assignment = LotteryCampaignStaff(id=6, campaign_id=7, user_id=5, enabled=True)

    async def listing(*_args):
        return {"items": []}

    monkeypatch.setattr(api, "list_campaign_staff", listing)
    db = Session(Result(campaign()), Result(rows=[assignment]))
    complete(api.replace_campaign_staff(7, api.StaffPayload(assignments=[]), db, User(id=1)))
    assert assignment.enabled is False


def test_missing_claim_inventory_has_no_recent_limit_or_archive_filter():
    db = Session(Result(rows=[(index, 7, 10) for index in range(1, 27)]))
    missing = complete(find_missing_lottery_claims(db, campaign_id=7))
    assert len(missing) == 26
    statement = sql(db.statements[0])
    assert "LIMIT" not in statement and "deleted_at" not in statement
    assert "result_type = 'win'" in statement and "lottery_claims.id IS NULL" in statement
    assert not db.added


def test_backfill_is_idempotent_and_uses_invite_draw_claim_lock_order():
    customer, previous = link(), draw()
    candidates = [{"draw_id": 88, "campaign_id": 7, "invite_link_id": 10}]
    db = Session(Result(customer), Result(previous), Result(), Result())
    repaired = complete(backfill_missing_lottery_claims(db, candidates=candidates))
    assert repaired == [88] and len(db.added) == 1 and db.added[0].status == "pending"
    assert customer.chance_used == 1 and customer.chance_total == 3
    for index, table in enumerate(["lottery_invite_links", "lottery_draws", "lottery_claims"]):
        assert f"FROM {table}" in sql(db.statements[index]) and "FOR UPDATE" in sql(db.statements[index])
    existing = claim("fulfilled")
    second = Session(Result(customer), Result(previous), Result(existing))
    assert complete(backfill_missing_lottery_claims(second, candidates=candidates)) == []
    assert not second.added and existing.status == "fulfilled"


def test_maintenance_defaults_to_dry_run_and_apply_requires_explicit_target():
    args = maintenance.parse_args([])
    db = Session(Result(rows=[(88, 7, 10)]))
    report = complete(maintenance.repair_claims(db, args))
    assert report["mode"] == "dry-run" and report["missing_count"] == 1
    assert not db.added and db.flushes == 0
    with pytest.raises(SystemExit):
        maintenance.parse_args(["--apply", "--expected-count", "1"])


def test_maintenance_count_mismatch_fails_before_any_write():
    args = maintenance.parse_args(["--apply", "--expected-count", "1", "--draw-ids", "88", "--operator-id", "1"])
    db = Session(Result(rows=[]))
    with pytest.raises(ValueError, match="Missing count changed"):
        complete(maintenance.repair_claims(db, args))
    assert not db.added


def test_maintenance_apply_audits_exact_draw_ids(monkeypatch):
    args = maintenance.parse_args(["--apply", "--expected-count", "1", "--draw-ids", "88", "--operator-id", "1"])
    received = {}

    async def repair(_db, *, candidates):
        received["candidates"] = candidates
        return [88]

    monkeypatch.setattr(maintenance, "backfill_missing_lottery_claims", repair)
    db = Session(Result(rows=[(88, 7, 10), (99, 8, 11)]), Result(User(id=1, disabled=False, role="admin")))
    report = complete(maintenance.repair_claims(db, args))
    assert report["created_draw_ids"] == [88]
    assert received["candidates"] == [{"draw_id": 88, "campaign_id": 7, "invite_link_id": 10}]
    assert len(db.added) == 1 and db.added[0].action == "backfill_claim" and db.added[0].entity_id == 88
