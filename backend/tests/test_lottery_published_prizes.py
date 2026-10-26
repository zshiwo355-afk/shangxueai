"""Published prize details stay editable without changing live draw allocation."""
import json
import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app import lottery_api as api
from app.auth import require_admin
from app.lottery_service import execute_draw
from app.models import LotteryAuditLog, LotteryClaim, LotteryDraw, LotteryInviteLink, User
from test_lottery_campaign_management import Result, Session, campaign, complete, prizes


def locked_session(current, prize):
    return Session(Result(current.id), Result(current), Result(prize))


def fail_image_resolution(monkeypatch):
    async def unexpected(*_args, **_kwargs):
        raise AssertionError("Rejected request must not resolve image references")

    monkeypatch.setattr(api, "_resolve_image_reference", unexpected)


def test_published_details_update_preserves_allocation_history_and_audits_versions(monkeypatch):
    current = campaign()
    rows = prizes()
    prize = rows[0]
    prize.image_url = "https://cdn.example/old.png"
    prize.image_object_key = "old.png"
    historical_draw = LotteryDraw(
        id=31, campaign_id=7, prize_id=21, config_version=8,
        prize_name_snapshot=prize.name, prize_type_snapshot=prize.type,
        prize_image_url_snapshot=prize.image_url, prize_probability_ppm_snapshot=200_000,
    )
    historical_claim = LotteryClaim(id=41, draw_id=31, status="fulfilled", recipient_name="王先生")
    old_draw_values = {key: value for key, value in vars(historical_draw).items() if not key.startswith("_")}
    old_claim_values = {key: value for key, value in vars(historical_claim).items() if not key.startswith("_")}
    db = locked_session(current, prize)
    resolved = []

    async def resolve(_db, _admin, **kwargs):
        assert current.config_version == 8
        assert prize.name == "酒礼盒" and prize.stock_total == 100
        resolved.append(kwargs)
        return 12, "https://cdn.example/new.png", "new.png"

    monkeypatch.setattr(api, "_resolve_image_reference", resolve)
    result = complete(api.update_prize(21, api.PrizeUpdatePayload(
        config_version=8, name=" 升级礼盒 ", description=" 新资料 ", type="coupon",
        image_url="https://cdn.example/new.png", image_object_key="new.png",
        image_material_asset_id=12, stock_total=120, sort_order=6,
        probability_ppm=200_000, enabled=True,
    ), db, User(id=9)))

    assert result["item"]["name"] == prize.name == "升级礼盒"
    assert prize.description == "新资料" and prize.type == "coupon"
    assert prize.image_url == "https://cdn.example/new.png"
    assert prize.image_object_key == "new.png" and prize.image_material_asset_id == 12
    assert prize.stock_total == 120 and prize.stock_awarded == 3 and prize.sort_order == 6
    assert prize.enabled is True and prize.probability_ppm == 200_000
    assert current.status == "published" and current.config_version == 9
    assert current.updated_by == prize.updated_by == 9
    assert "config_version" not in vars(prize)
    assert db.flushes == 1 and db.refreshed == [prize]
    assert resolved and isinstance(db.added[0], LotteryAuditLog)
    audit = db.added[0]
    assert audit.action == "update" and audit.operator_id == 9
    assert json.loads(audit.before_json)["config_version"] == 8
    assert json.loads(audit.before_json)["name"] == "酒礼盒"
    assert json.loads(audit.after_json)["config_version"] == 9
    assert json.loads(audit.after_json)["name"] == "升级礼盒"
    assert db.statements[0]._for_update_arg is None  # Lookup only; not a prize lock.
    assert "lottery_campaigns" in str(db.statements[1])
    assert "lottery_prizes.campaign_id" in str(db.statements[2])
    assert all(stmt._for_update_arg is not None for stmt in db.statements[1:])
    assert all("lottery_draws" not in str(stmt) and "lottery_claims" not in str(stmt) for stmt in db.statements)
    assert {key: value for key, value in vars(historical_draw).items() if not key.startswith("_")} == old_draw_values
    assert {key: value for key, value in vars(historical_claim).items() if not key.startswith("_")} == old_claim_values

    # A subsequent draw snapshots the new details/version; the already-issued
    # draw and fulfilment record above keep their original award information.
    link = LotteryInviteLink(id=19, campaign_id=7, public_code="customer", chance_total=1,
                             chance_used=0, status="active", version=1)
    draw_db = Session(Result(link), Result(None), Result(current), Result(rows=rows[:2]))
    outcome = complete(execute_draw(draw_db, public_code="customer", request_id="after-prize-edit",
                                   client_ip="127.0.0.1", user_agent="pytest", random_value=900_000))
    assert outcome.draw.prize_name_snapshot == "升级礼盒"
    assert outcome.draw.prize_type_snapshot == "coupon"
    assert outcome.draw.prize_image_url_snapshot == "https://cdn.example/new.png"
    assert outcome.draw.prize_probability_ppm_snapshot == 200_000
    assert outcome.draw.config_version == 9
    assert link.chance_used == 1
    assert historical_draw.prize_name_snapshot == "酒礼盒"
    assert historical_claim.status == "fulfilled"


@pytest.mark.parametrize("version", [None, 7, 9])
def test_published_missing_or_stale_version_rejected_before_image_resolution(monkeypatch, version):
    fail_image_resolution(monkeypatch)
    current = campaign()
    prize = prizes()[0]
    db = locked_session(current, prize)
    values = {"name": "不能写入", "image_url": "https://cdn.example/new.png"}
    if version is not None:
        values["config_version"] = version
    with pytest.raises(HTTPException, match="刷新") as exc:
        complete(api.update_prize(21, api.PrizeUpdatePayload(**values), db, User(id=9)))
    assert exc.value.status_code == 409
    assert prize.name == "酒礼盒" and current.config_version == 8
    assert not db.flushes and not db.added


@pytest.mark.parametrize("status", ["draft", "paused", "ended"])
def test_unpublished_optional_version_accepts_legacy_clients_but_checks_supplied_version(status):
    current = campaign()
    current.status = status
    prize = prizes()[0]
    db = locked_session(current, prize)
    result = complete(api.update_prize(21, api.PrizeUpdatePayload(name="更新资料"), db, User(id=9)))
    assert result["item"]["name"] == "更新资料" and current.config_version == 9

    stale_db = locked_session(current, prize)
    with pytest.raises(HTTPException, match="刷新") as exc:
        complete(api.update_prize(21, api.PrizeUpdatePayload(config_version=8, name="不能覆盖"), stale_db, User(id=9)))
    assert exc.value.status_code == 409
    assert prize.name == "更新资料" and not stale_db.flushes


@pytest.mark.parametrize("version", [0, -1, "8", 8.0, True])
def test_prize_editor_version_requires_a_positive_strict_integer(version):
    with pytest.raises(ValidationError):
        api.PrizeUpdatePayload(config_version=version)


@pytest.mark.parametrize("values, detail", [
    ({"probability_ppm": 300_000}, "调整概率"),
    ({"enabled": False}, "暂停"),
])
def test_published_editor_cannot_change_probability_or_enabled(monkeypatch, values, detail):
    fail_image_resolution(monkeypatch)
    current = campaign()
    prize = prizes()[0]
    db = locked_session(current, prize)
    with pytest.raises(HTTPException, match=detail) as exc:
        complete(api.update_prize(21, api.PrizeUpdatePayload(
            config_version=8, name="不应保存", image_url="https://cdn.example/new.png", **values,
        ), db, User(id=9)))
    assert exc.value.status_code == 409
    assert prize.name == "酒礼盒" and prize.enabled and prize.probability_ppm == 200_000
    assert current.config_version == 8 and not db.flushes and not db.added


@pytest.mark.parametrize("field", ["name", "description", "type", "probability_ppm", "stock_total", "enabled", "sort_order"])
def test_required_prize_values_cannot_be_overwritten_with_explicit_null(field):
    with pytest.raises(ValidationError):
        api.PrizeUpdatePayload(**{field: None})
    assert api.PrizeUpdatePayload().model_dump(exclude_unset=True) == {}


@pytest.mark.parametrize("kind", ["no_win", "unknown", ""])
def test_prize_editor_only_accepts_real_prize_types(kind):
    with pytest.raises(ValidationError):
        api.PrizeUpdatePayload(type=kind)


@pytest.mark.parametrize("status", ["published", "paused"])
def test_stock_lower_than_freshly_locked_awarded_count_never_mutates_any_field(monkeypatch, status):
    fail_image_resolution(monkeypatch)
    current = campaign()
    current.status = status
    prize = prizes()[0]

    class ConcurrentDrawSession(Session):
        async def execute(self, statement):
            result = await super().execute(statement)
            if result.value is prize:
                # The admin opened their form at stock_awarded=3. A draw
                # committed before the edit obtained its locks, so it is 4 now.
                prize.stock_awarded = 4
            return result

    db = ConcurrentDrawSession(Result(7), Result(current), Result(prize))
    with pytest.raises(HTTPException, match="总库存不能小于已中奖数量") as exc:
        complete(api.update_prize(21, api.PrizeUpdatePayload(
            config_version=8, stock_total=3, name="不应保存", sort_order=9,
            image_url="https://cdn.example/new.png",
        ), db, User(id=9)))
    assert exc.value.status_code == 409
    assert prize.stock_total == 100 and prize.stock_awarded == 4
    assert prize.name == "酒礼盒" and prize.sort_order is None
    assert current.config_version == 8 and not db.flushes and not db.added


def test_published_stock_can_be_reduced_to_exactly_awarded_count():
    current = campaign()
    prize = prizes()[0]
    db = locked_session(current, prize)
    result = complete(api.update_prize(21, api.PrizeUpdatePayload(config_version=8, stock_total=3), db, User(id=9)))
    assert result["item"]["stock_remaining"] == 0
    assert prize.stock_total == prize.stock_awarded == 3
    assert prize.enabled and prize.probability_ppm == 200_000


def test_archived_campaign_rejects_prize_edit_before_locking_prize_or_resolving_image(monkeypatch):
    fail_image_resolution(monkeypatch)
    current = campaign(deleted=True)
    db = Session(Result(7), Result(current))
    with pytest.raises(HTTPException) as exc:
        complete(api.update_prize(21, api.PrizeUpdatePayload(
            config_version=8, name="不得恢复归档奖品", image_url="https://cdn.example/new.png",
        ), db, User(id=9)))
    assert exc.value.status_code == 404
    assert len(db.statements) == 2 and not db.flushes and not db.added


@pytest.mark.parametrize("operation", ["create", "enable", "delete"])
def test_live_detail_edit_does_not_unlock_structural_prize_changes(operation):
    current = campaign()
    prize = prizes()[0]
    db = Session(Result(current)) if operation == "create" else locked_session(current, prize)
    if operation == "create":
        request = api.create_prize(7, api.PrizePayload(name="新增奖品"), db, User(id=9))
    elif operation == "enable":
        request = api.update_prize_status(21, api.PrizeStatusPayload(enabled=False), db, User(id=9))
    else:
        request = api.delete_prize(21, db, User(id=9))
    with pytest.raises(HTTPException, match="暂停") as exc:
        complete(request)
    assert exc.value.status_code == 409
    assert prize.enabled and prize.deleted_at is None
    assert current.config_version == 8 and not db.flushes and not db.added


def test_prize_edit_route_still_requires_admin_role():
    route = next(route for route in api.admin_router.routes if route.endpoint is api.update_prize)
    assert any(dependency.call is require_admin for dependency in route.dependant.dependencies)
    with pytest.raises(HTTPException) as exc:
        complete(require_admin(User(id=3, role="user")))
    assert exc.value.status_code == 403
