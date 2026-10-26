"""Complete screenshot redemption totals, independent of paged recent draws."""
from datetime import datetime

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app import lottery_api as api
from app.lottery_service import winning_summary
from test_lottery_closure import Result, Session, campaign, complete, draw, link, request, sql


def test_summary_counts_all_wins_grouped_by_prize_id_and_snapshot_name():
    db = Session(Result(rows=[
        (2, "原礼盒名称", "https://example.test/old.jpg", 34),
        (2, "新礼盒名称", "https://example.test/new.jpg", 12),
        (5, "酒杯", "", 54),
    ]))
    result = complete(winning_summary(db, 10))
    assert result == {"items": [
        {"prize_id": 2, "prize_name": "原礼盒名称", "prize_image_url": "https://example.test/old.jpg", "quantity": 34},
        {"prize_id": 2, "prize_name": "新礼盒名称", "prize_image_url": "https://example.test/new.jpg", "quantity": 12},
        {"prize_id": 5, "prize_name": "酒杯", "prize_image_url": "", "quantity": 54},
    ], "total_wins": 100}
    query = sql(db.statements[0])
    assert "lottery_draws.invite_link_id = 10" in query
    assert "lottery_draws.result_type = 'win'" in query
    assert "GROUP BY lottery_draws.prize_id, lottery_draws.prize_name_snapshot" in query
    assert "ORDER BY min(lottery_draws.id)" in query
    assert "LIMIT" not in query and "OFFSET" not in query
    assert "lottery_prizes" not in query  # Deleted or renamed prizes retain winning snapshots.
    for private in ["recipient", "ip_hash", "request_id", "random_value", "probability"]:
        assert private not in query and private not in str(result)
    assert not db.added and not db.flushes


def test_summary_empty_and_historical_missing_prize_reference():
    assert complete(winning_summary(Session(Result(rows=[])), 10)) == {"items": [], "total_wins": 0}
    result = complete(winning_summary(Session(Result(rows=[(None, "历史奖品", None, 3)])), 10))
    assert result["items"][0] == {"prize_id": None, "prize_name": "历史奖品", "prize_image_url": "", "quantity": 3}


def test_snapshot_includes_complete_summary_without_expanding_recovery_history(monkeypatch):
    async def context(_db, _code, **_kwargs):
        return campaign(), link(used=100, total=100)

    monkeypatch.setattr(api, "_public_link_context", context)
    recent = [draw(sequence=n) for n in range(100, 80, -1)]
    db = Session(Result(rows=[]), Result(rows=recent), Result(rows=[]), Result(rows=[(2, "礼盒", "", 100)]))
    result = complete(api.public_lottery("private-code", request(), db))
    assert len(result["recent_draws"]) == 20 and result["winning_summary"]["total_wins"] == 100
    assert result["receipt"]["win_count"] == 100 and result["receipt"]["manual_redemption"]
    assert not result["receipt"]["required"] and not result["receipt"]["can_submit"]
    assert "LIMIT 20" in sql(db.statements[1])


@pytest.mark.parametrize("kind", ["missing", "draft", "deleted"])
def test_summary_preserves_archived_and_draft_link_restrictions(kind):
    activity = campaign("draft" if kind == "draft" else "ended")
    if kind == "deleted": activity.deleted_at = datetime(2026, 10, 22)
    db = Session(Result(None)) if kind == "missing" else Session(Result(link()), Result(activity))
    with pytest.raises(HTTPException) as error:
        complete(api.public_winning_summary("private-code", db))
    assert error.value.status_code == 404 and not db.added and not db.flushes


@pytest.mark.parametrize("status", ["published", "paused", "ended"])
def test_summary_endpoint_reads_historical_wins_without_mutation(status):
    customer = link(used=3)
    customer.last_opened_at = datetime(2026, 10, 1)
    db = Session(Result(customer), Result(campaign(status)), Result(rows=[(2, "礼盒", "", 3)]))
    result = complete(api.public_winning_summary("private-code", db))
    assert result["total_wins"] == 3 and customer.last_opened_at == datetime(2026, 10, 1)
    assert not db.added and not db.flushes


@pytest.mark.parametrize("body", [{}, {"recipient_name": "不再收集", "recipient_phone": "13800138000", "recipient_address": "不得写入"}])
def test_http_old_receipt_post_returns_409_even_without_contact_fields(body):
    app = FastAPI()
    app.include_router(api.public_router)
    customer = link(used=3)
    db = Session(Result(customer), Result(campaign()))

    async def database():
        yield db

    app.dependency_overrides[api.get_db] = database
    with TestClient(app) as client:
        response = client.post("/api/public/lottery/private-code/receipt", json=body)
    assert response.status_code == 409
    assert "截图中奖信息联系销售人员兑奖" in response.json()["detail"]
    assert not customer.receipt_submitted_at and not customer.recipient_address and not db.added and not db.flushes


def test_http_public_summary_contract():
    app = FastAPI()
    app.include_router(api.public_router)

    async def database():
        yield Session(Result(link()), Result(campaign()), Result(rows=[(2, "礼盒", "", 100)]))

    app.dependency_overrides[api.get_db] = database
    with TestClient(app) as client:
        response = client.get("/api/public/lottery/private-code/winning-summary")
    assert response.status_code == 200 and response.json()["total_wins"] == 100
    assert set(response.json()) == {"items", "total_wins"}
