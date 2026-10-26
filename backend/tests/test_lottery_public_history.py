"""Complete customer draw history without exposing internal or receipt data."""
from datetime import datetime

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app import lottery_api as api
from test_lottery_closure import Result, Session, campaign, claim, complete, draw, link, sql


def test_public_history_uses_server_count_page_offset_and_stable_descending_ids(monkeypatch):
    async def context(_db, code):
        assert code == "private-code"
        return campaign(), link()

    monkeypatch.setattr(api, "_public_link_context", context)
    history = [draw(sequence=index) for index in range(21, 11, -1)]
    for item in history:
        item.id = item.draw_sequence
    db = Session(Result(31), Result(rows=history), Result(rows=[]))
    response = complete(api.public_lottery_draws("private-code", 2, 10, db))
    assert response["total"] == 31 and response["page"] == 2 and response["page_size"] == 10
    assert [item["draw_sequence"] for item in response["items"]] == list(range(21, 11, -1))
    assert "count(*)" in sql(db.statements[0])
    assert "lottery_draws.invite_link_id = 10" in sql(db.statements[0])
    query = sql(db.statements[1])
    assert "ORDER BY lottery_draws.id DESC" in query and "LIMIT 10 OFFSET 10" in query
    assert not db.added and db.flushes == 0


def test_public_history_last_page_empty_page_and_zero_total(monkeypatch):
    async def context(_db, _code):
        return campaign(), link()

    monkeypatch.setattr(api, "_public_link_context", context)
    last = draw(sequence=1)
    response = complete(api.public_lottery_draws("private-code", 4, 10, Session(Result(31), Result(rows=[last]), Result(rows=[]))))
    assert len(response["items"]) == 1 and response["total"] == 31
    for total, page in [(31, 9), (0, 1)]:
        response = complete(api.public_lottery_draws("private-code", page, 10, Session(Result(total), Result(rows=[]), Result(rows=[]))))
        assert response == {"items": [], "total": total, "page": page, "page_size": 10}


def test_public_history_omits_request_probability_and_recipient_fields(monkeypatch):
    async def context(_db, _code):
        return campaign(), link()

    monkeypatch.setattr(api, "_public_link_context", context)
    saved = draw()
    saved.ip_hash = "private-ip"
    saved.prize_probability_ppm_snapshot = 555
    saved.random_value = 123
    registration = claim()
    registration.recipient_phone = "13800138000"
    registration.recipient_address = "private-address"
    db = Session(Result(1), Result(rows=[saved]), Result(rows=[registration]))
    item = complete(api.public_lottery_draws("private-code", 1, 10, db))["items"][0]
    assert item["claim_status"] == "pending"
    for field in ["request_id", "random_value", "ip_hash", "probability_ppm", "prize_probability_ppm_snapshot",
                  "recipient_name", "recipient_phone", "recipient_address", "revision", "operator_remark"]:
        assert field not in item


@pytest.mark.parametrize("kind", ["missing", "draft", "deleted"])
def test_public_history_keeps_existing_visibility_checks(kind):
    current = campaign("draft" if kind == "draft" else "ended")
    if kind == "deleted":
        current.deleted_at = datetime(2026, 10, 22)
    db = Session(Result(None)) if kind == "missing" else Session(Result(link()), Result(current))
    with pytest.raises(HTTPException) as error:
        complete(api.public_lottery_draws("private-code", 1, 10, db))
    assert error.value.status_code == 404
    assert not db.added and not db.flushes


@pytest.mark.parametrize("query", ["page=0", "page=-1", "page_size=0", "page_size=101", "page=x", "page_size=1.5"])
def test_public_history_http_rejects_invalid_page_parameters(query):
    app = FastAPI()
    app.include_router(api.public_router)

    async def database():
        yield Session()

    app.dependency_overrides[api.get_db] = database
    with TestClient(app) as client:
        response = client.get(f"/api/public/lottery/private-code/draws?{query}")
    assert response.status_code == 422
