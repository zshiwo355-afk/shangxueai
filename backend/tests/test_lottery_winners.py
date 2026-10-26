"""Real, campaign-scoped, bounded and privacy-safe public winning activity."""
from datetime import datetime, timedelta

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app import lottery_api as api
from app.lottery_policy import winner_display_name
from test_lottery_closure import Result, Session, campaign, complete, link, sql


@pytest.mark.parametrize("name,expected", [
    ("张三", "张先生"), ("张小明", "张先生"), ("张先生", "张先生"),
    (" 王女士 ", "王女士"), ("王小红女士", "王女士"), ("欧阳晓明", "欧阳先生"),
    ("上官女士", "上官女士"), ("赵", "赵先生"), ("张*", "幸运客户"),
    ("张先生13800138000", "幸运客户"), ("13800138000", "幸运客户"),
    ("https://private.test/customer", "幸运客户"), ("张三（老客户）", "幸运客户"),
    ("客户甲", "幸运客户"), ("Alice", "幸运客户"), (None, "幸运客户"), ("", "幸运客户"),
    ("<img src=x>", "幸运客户"), ("张\n三", "幸运客户"),
    ("王氏商行", "幸运客户"), ("成都公司", "幸运客户"), ("王门店", "幸运客户"),
])
def test_display_names_never_publish_free_form_customer_fields(name, expected):
    assert winner_display_name(name) == expected


def test_feed_is_real_current_campaign_wins_only_and_never_mutates_any_record():
    current, customer = campaign(), link(used=1, total=10)
    customer.last_opened_at = datetime(2026, 10, 1)
    instant = datetime(2026, 10, 23, 2, 30)
    db = Session(Result(customer), Result(current), Result(rows=[
        (102, "张小明", "礼盒（原中奖名称）", instant),
        (100, "王女士13800138000", "优惠券", instant),
    ]))
    response = complete(api.public_lottery_winners("private-code", db))
    assert response == {"items": [
        {"id": 102, "display_name": "张先生", "prize_name": "礼盒（原中奖名称）", "created_at": "2026-10-23T02:30:00Z"},
        {"id": 100, "display_name": "幸运客户", "prize_name": "优惠券", "created_at": "2026-10-23T02:30:00Z"},
    ]}
    query = sql(db.statements[-1])
    assert "lottery_draws.campaign_id = 7" in query
    assert "lottery_invite_links.campaign_id = 7" in query
    assert "lottery_draws.result_type = 'win'" in query
    assert "ORDER BY lottery_draws.id DESC" in query and "LIMIT 30" in query
    assert "lottery_prizes" not in query  # Never rewrite historical prize snapshots.
    for private in ["recipient", "public_code", "customer_code", "customer_note", "openid", "probability", "request_id"]:
        assert private not in query and private not in str(response)
    assert not db.added and not db.flushes and customer.last_opened_at == datetime(2026, 10, 1)
    assert customer.chance_total == 10 and customer.chance_used == 1


def test_no_wins_returns_empty_feed_not_fabricated_items():
    db = Session(Result(link()), Result(campaign()), Result(rows=[]))
    assert complete(api.public_lottery_winners("private-code", db)) == {"items": []}


def test_http_winners_contract_cannot_expand_scope_or_reveal_customer_fields():
    app = FastAPI()
    app.include_router(api.public_router)
    db = Session(Result(link()), Result(campaign()), Result(rows=[
        (3, "欧阳小红女士", "礼盒", datetime(2026, 10, 23, 2, 30)),
    ]))

    async def database():
        yield db

    app.dependency_overrides[api.get_db] = database
    with TestClient(app) as client:
        response = client.get("/api/public/lottery/private-code/winners?campaign_id=99&limit=999")
    assert response.status_code == 200
    assert response.json() == {"items": [{"id": 3, "display_name": "欧阳女士", "prize_name": "礼盒",
                                          "created_at": "2026-10-23T02:30:00Z"}]}
    query = sql(db.statements[-1])
    assert "campaign_id = 7" in query and "99" not in query and "LIMIT 30" in query
    assert not db.added and not db.flushes


@pytest.mark.parametrize("kind", ["missing", "draft", "deleted", "disabled", "expired"])
def test_feed_requires_a_valid_non_archived_public_link(kind):
    customer = link()
    current = campaign("draft" if kind == "draft" else "published")
    if kind == "deleted":
        current.deleted_at = datetime(2026, 10, 22)
    if kind == "disabled":
        customer.status = "disabled"
    if kind == "expired":
        customer.expires_at = datetime.utcnow() - timedelta(seconds=1)
    db = Session(Result(None)) if kind == "missing" else Session(Result(customer), Result(current))
    with pytest.raises(HTTPException) as error:
        complete(api.public_lottery_winners("private-code", db))
    assert error.value.status_code == (409 if kind in {"disabled", "expired"} else 404)
    assert not db.added and not db.flushes
    assert all("prize_name_snapshot" not in sql(statement) for statement in db.statements)
