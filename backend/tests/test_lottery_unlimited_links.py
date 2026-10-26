"""Retired link quotas must not reappear through old data or cached clients."""
import json

import pytest
from fastapi import HTTPException

from app import lottery_api as api
from app.models import (
    LotteryAuditLog, LotteryCampaign, LotteryCampaignStaff, LotteryInviteLink,
    LotteryLinkActionLog, User,
)
from test_lottery_closure import Result, Session, campaign, complete, request, sql


class CreationSession(Session):
    """Small DB fake that retains pre-existing links and enforces the staff filter."""

    def __init__(self, current, staff, existing_count=11):
        super().__init__()
        self.current, self.staff = current, staff
        self.links = [LotteryInviteLink(id=index + 1, campaign_id=7, created_by_user_id=5,
                                       chance_total=1, chance_used=0)
                      for index in range(existing_count)]

    async def execute(self, statement):
        self.statements.append(statement)
        query = sql(statement)
        if "FROM lottery_campaign_staff" in query:
            assignment = self.staff
            if assignment and not assignment.enabled and "enabled IS true" in query:
                assignment = None
            return Result(assignment)
        if "FROM lottery_campaigns" in query:
            return Result(self.current)
        if "count(" in query and "FROM lottery_invite_links" in query:
            return Result(len(self.links))
        raise AssertionError(f"Unexpected query: {query}")

    async def refresh(self, value):
        if isinstance(value, LotteryInviteLink):
            value.id = len(self.links) + 1
            value.chance_used = 0
            self.links.append(value)


@pytest.mark.parametrize("role", ["user", "admin"])
@pytest.mark.parametrize("existing_count", [10, 11, 120])
def test_employee_can_create_after_reaching_both_legacy_ten_link_limits(role, existing_count):
    current = campaign()
    current.max_links_per_employee = 10
    staff = LotteryCampaignStaff(id=3, campaign_id=7, user_id=5, enabled=True,
                                 link_quota=10, max_chances_per_link=10)
    db = CreationSession(current, staff, existing_count)

    response = complete(api.create_link(
        api.LinkCreatePayload(campaign_id=7, customer_name="张先生"), request(), db,
        User(id=5, role=role),
    ))

    assert len(db.links) == existing_count + 1
    assert response["item"]["chance_total"] == response["item"]["remaining_chances"] == 1
    assert response["item"]["chance_limit"] == 1
    assert len([item for item in db.added if isinstance(item, LotteryLinkActionLog)]) == 1
    assert not any("count(" in sql(statement) for statement in db.statements)
    assert current.max_links_per_employee == staff.link_quota == 10
    assert all(item.chance_total == 1 and item.chance_used == 0 for item in db.links)


@pytest.mark.parametrize("enabled", [None, False])
def test_removing_quota_does_not_grant_missing_or_revoked_staff_access(enabled):
    staff = None if enabled is None else LotteryCampaignStaff(
        id=3, campaign_id=7, user_id=5, enabled=enabled, link_quota=10,
    )
    db = CreationSession(campaign(), staff)

    with pytest.raises(HTTPException, match="没有该抽奖活动") as error:
        complete(api.create_link(api.LinkCreatePayload(campaign_id=7, customer_name="张先生"),
                                 request(), db, User(id=5, role="user")))

    assert error.value.status_code == 403
    assert not db.added and not db.flushes and len(db.links) == 11
    assert "enabled IS true" in sql(db.statements[1])
    assert "user_id = 5" in sql(db.statements[1])
    assert "campaign_id = 7" in sql(db.statements[1])


@pytest.mark.parametrize("status", ["draft", "paused", "ended"])
def test_unlimited_creation_does_not_bypass_campaign_lifecycle(status):
    staff = LotteryCampaignStaff(id=3, campaign_id=7, user_id=5, enabled=True, link_quota=10)
    db = CreationSession(campaign(status), staff)
    with pytest.raises(HTTPException, match="仅已发布"):
        complete(api.create_link(api.LinkCreatePayload(campaign_id=7, customer_name="张先生"),
                                 request(), db, User(id=5, role="user")))
    assert not db.added and not db.flushes


def test_all_current_settings_responses_return_unlimited_without_rewriting_old_rows():
    current = campaign()
    current.max_links_per_employee = 10
    staff = LotteryCampaignStaff(id=3, campaign_id=7, user_id=5, enabled=True,
                                 link_quota=10, max_chances_per_link=10)
    actor = User(id=5, role="user", real_name="员工甲", disabled=False)
    assert api.campaign_to_dict(current)["max_links_per_employee"] == 0
    employee = complete(api.employee_campaigns(Session(Result(rows=[(current, staff)])), actor))
    assert employee["items"][0]["max_links_per_employee"] == 0
    assert employee["items"][0]["staff_limits"] == {"link_quota": 0, "max_chances_per_link": 1}
    admin = complete(api.list_campaign_staff(
        7, Session(Result(current), Result(rows=[(staff, actor)])), User(id=1, role="admin"),
    ))
    assert admin["items"][0]["link_quota"] == 0
    assert admin["items"][0]["max_chances_per_link"] == 1
    assert current.max_links_per_employee == staff.link_quota == staff.max_chances_per_link == 10


def test_legacy_campaign_creation_cannot_reenable_link_limits():
    class CampaignCreationSession(Session):
        async def refresh(self, value):
            value.id = 7

    db = CampaignCreationSession(Result())
    result = complete(api.create_campaign(
        api.CampaignPayload(title="测试活动", max_links_per_employee=10), db, User(id=1),
    ))
    saved = next(item for item in db.added if isinstance(item, LotteryCampaign))
    assert saved.max_links_per_employee == result["item"]["max_links_per_employee"] == 0
    assert saved.max_chances_per_link == 1


@pytest.mark.parametrize("legacy_quota", [0, 10, 100000, None])
def test_legacy_campaign_update_cannot_reenable_link_limits(legacy_quota):
    current = campaign()
    current.max_links_per_employee = 10
    db = Session(Result(current))
    result = complete(api.update_campaign(
        7, api.CampaignUpdatePayload(max_links_per_employee=legacy_quota), db, User(id=1),
    ))
    assert current.max_links_per_employee == result["item"]["max_links_per_employee"] == 0


def test_omitted_quota_keeps_old_column_but_not_old_effective_limit():
    current = campaign()
    current.max_links_per_employee = 10
    db = Session(Result(current))
    result = complete(api.update_campaign(7, api.CampaignUpdatePayload(title="新标题"), db, User(id=1)))
    assert current.max_links_per_employee == 10
    assert result["item"]["max_links_per_employee"] == 0


def test_old_staff_payload_above_old_campaign_limit_is_accepted_and_saved_unlimited(monkeypatch):
    current = campaign()
    current.max_links_per_employee = 10
    staff = LotteryCampaignStaff(id=3, campaign_id=7, user_id=5, enabled=True,
                                 link_quota=10, max_chances_per_link=1)

    async def listing(*_args):
        return {"items": []}

    monkeypatch.setattr(api, "list_campaign_staff", listing)
    db = Session(Result(current), Result(rows=[staff]),
                 Result(rows=[User(id=5, disabled=False), User(id=6, disabled=False)]))
    complete(api.replace_campaign_staff(7, api.StaffPayload(assignments=[
        {"user_id": 5, "enabled": True, "link_quota": 100},
        {"user_id": 6, "enabled": True, "link_quota": 1000},
    ]), db, User(id=1)))
    new = next(item for item in db.added if isinstance(item, LotteryCampaignStaff))
    assert staff.link_quota == new.link_quota == 0
    assert staff.max_chances_per_link == new.max_chances_per_link == 1
    audit = next(item for item in db.added if isinstance(item, LotteryAuditLog))
    assert json.loads(audit.before_json)["5"]["link_quota"] == 10
    assert all(item["link_quota"] == 0 for item in json.loads(audit.after_json).values())
