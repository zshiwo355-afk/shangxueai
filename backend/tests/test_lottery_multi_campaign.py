"""Employees can use each authorized activity without falling back to the newest."""
from datetime import datetime

import pytest
from fastapi import HTTPException

from app import lottery_api as api
from app.models import LotteryCampaignStaff, LotteryInviteLink, LotteryLinkActionLog, User
from test_lottery_closure import Result, Session, campaign, complete, request, sql


def activities():
    older, newer = campaign(), campaign()
    older.id, older.title, older.created_at = 6, "品牌甲活动", datetime(2026, 10, 21)
    newer.id, newer.title, newer.created_at = 7, "品牌乙活动", datetime(2026, 10, 26)
    return older, newer


def assignment(campaign_id):
    return LotteryCampaignStaff(
        id=campaign_id, campaign_id=campaign_id, user_id=5, enabled=True,
        link_quota=0, max_chances_per_link=1,
    )


@pytest.mark.parametrize("role", ["user", "admin", "super_admin"])
def test_activity_list_keeps_older_and_newer_published_campaigns(role):
    older, newer = activities()
    rows = [newer, older] if role != "user" else [
        (newer, assignment(7)), (older, assignment(6)),
    ]
    db = Session(Result(rows=rows))

    result = complete(api.employee_campaigns(db, User(id=5, role=role)))

    assert [item["id"] for item in result["items"]] == [7, 6]
    assert [item["title"] for item in result["items"]] == ["品牌乙活动", "品牌甲活动"]
    assert all(item["can_create_links"] for item in result["items"])
    query = sql(db.statements[0])
    assert "LIMIT" not in query
    assert "status != 'draft'" in query
    if role == "user":
        assert "lottery_campaign_staff.user_id = 5" in query
        assert "lottery_campaign_staff.enabled IS true" in query


def test_employee_creates_independent_links_for_both_authorized_campaigns():
    class CreationSession(Session):
        async def refresh(self, value):
            value.id = 100 + value.campaign_id
            value.chance_used = 0

    older, newer = activities()
    db = CreationSession(Result(older), Result(assignment(6)),
                         Result(newer), Result(assignment(7)))
    user = User(id=5, role="user")
    results = [complete(api.create_link(
        api.LinkCreatePayload(campaign_id=current.id, customer_name="同一客户"),
        request(), db, user,
    )) for current in (older, newer)]

    assert [result["item"]["campaign_id"] for result in results] == [6, 7]
    assert all(result["item"]["remaining_chances"] == 1 for result in results)
    links = [value for value in db.added if isinstance(value, LotteryInviteLink)]
    logs = [value for value in db.added if isinstance(value, LotteryLinkActionLog)]
    assert [value.campaign_id for value in links] == [6, 7]
    assert [value.campaign_id for value in logs] == [6, 7]
    assert len({value.public_code for value in links}) == 2
    assert all(value.created_by_user_id == 5 for value in links)
    for index, campaign_id in ((0, 6), (2, 7)):
        assert f"lottery_campaigns.id = {campaign_id}" in sql(db.statements[index])
        permission_query = sql(db.statements[index + 1])
        assert f"campaign_id = {campaign_id}" in permission_query
        assert "user_id = 5" in permission_query and "enabled IS true" in permission_query


@pytest.mark.parametrize("selected_id", [6, 7])
def test_link_listing_is_scoped_to_selected_activity_and_current_employee(monkeypatch, selected_id):
    current = next(item for item in activities() if item.id == selected_id)
    db = Session(Result(current), Result(assignment(selected_id)))
    captured = {}

    async def listing(_db, _request, **kwargs):
        captured.update(kwargs)
        return {"items": [], "total": 0}

    monkeypatch.setattr(api, "_list_links_response", listing)
    complete(api.employee_links(request(), selected_id, "", 1, 20, db, User(id=5, role="user")))

    filters = " ".join(sql(value) for value in captured["filters"])
    assert f"lottery_invite_links.campaign_id = {selected_id}" in filters
    assert "lottery_invite_links.created_by_user_id = 5" in filters
    assert "lottery_campaign_staff.user_id = 5" in filters
    assert "lottery_campaign_staff.enabled IS true" in filters
    assert captured["page"] == 1 and captured["page_size"] == 20


@pytest.mark.parametrize("operation", ["create", "list"])
def test_authorization_for_one_activity_does_not_authorize_another(operation):
    older, _newer = activities()
    db = Session(Result(older), Result())
    actor = User(id=5, role="user")
    with pytest.raises(HTTPException) as error:
        if operation == "create":
            complete(api.create_link(api.LinkCreatePayload(campaign_id=6, customer_name="客户"),
                                     request(), db, actor))
        else:
            complete(api.employee_links(request(), 6, "", 1, 20, db, actor))
    assert error.value.status_code == 403
    assert not db.added and not db.flushes
    assert "campaign_id = 6" in sql(db.statements[-1])
    assert "user_id = 5" in sql(db.statements[-1])
