"""Authenticated one-click card configuration stays scoped to the employee/link."""
import asyncio
from datetime import datetime, timedelta

import httpx
import pytest
from fastapi import FastAPI, HTTPException, Response

from app import lottery_share_api as api
from app.wechat_client import WechatApiError
from app.wecom_client import WecomClient
from test_lottery_closure import Result, Session, campaign, complete, link, request
from test_lottery_share_preview import configuration, staff, user


def payload(url="https://example.test/lottery-workspace"):
    return api.DirectSharePayload(url=url)


def permitted_session(customer=None, activity=None):
    return Session(Result(customer or link()), Result(activity or campaign()), Result(staff()))


@pytest.mark.parametrize("url,expected", [
    ("https://example.test/lottery-workspace", "https://example.test/lottery-workspace"),
    ("https://example.test/admin/lottery", "https://example.test/admin/lottery"),
    ("https://example.test:443/admin/lottery", "https://example.test:443/admin/lottery"),
    ("https://example.test/lottery-workspace?campaign=7&from=menu#tab=links",
     "https://example.test/lottery-workspace?campaign=7&from=menu"),
])
def test_sign_url_accepts_only_supported_pages_and_preserves_query(url, expected):
    assert api._direct_sign_url(url) == expected


@pytest.mark.parametrize("url", [
    "https://evil.test/lottery-workspace",
    "https://example.test.evil.test/lottery-workspace",
    "https://example.test:444/lottery-workspace",
    "https://example.test:0/lottery-workspace",
    "http://example.test/lottery-workspace",
    "https://employee@example.test/lottery-workspace",
    "https://employee:password@example.test/lottery-workspace",
    "https://example.test/admin",
    "https://example.test/lottery-workspace/",
    "https://example.test/admin/lottery/../users",
    "https://example.test/%6cottery-workspace",
    "https://example.test/admin%2Flottery",
    "https://example.test/lottery-share/customer-private-token",
    "https://example.test/lottery-workspace?ticket=secret",
    "https://example.test/lottery-workspace?ticket=",
    "https://example.test/lottery-workspace?%74icket=secret",
    "https://example.test/lottery-workspace\n",
    "https://example.test/lottery-workspace\t",
    "//example.test/lottery-workspace",
    "https://example.test:broken/lottery-workspace",
])
def test_invalid_origin_path_or_credential_query_never_gets_a_signature(url):
    db = Session()
    with pytest.raises(HTTPException) as error:
        complete(api.direct_share_config(10, payload(url), request(), Response(), db, user()))
    assert error.value.status_code == 403
    assert not db.statements and not db.added and not db.flushes


def test_unconfigured_origin_does_not_fall_back_to_request_host(configuration):
    configuration.resolved_wecom_frontend_base_url = ""
    with pytest.raises(HTTPException) as error:
        complete(api.direct_share_config(10, payload(), request(), Response(), Session(), user()))
    assert error.value.status_code == 503


def test_owner_configuration_has_safe_metadata_and_no_cache_without_mutations():
    customer, activity = link(), campaign()
    customer.recipient_phone = "private-phone"
    customer.recipient_address = "private-address"
    activity.share_title, activity.share_desc = "客户抽奖", "查看您的专属抽奖机会"
    activity.share_image_url = "https://images.example.test/lottery-card.png"
    db, response = permitted_session(customer, activity), Response()
    data = complete(api.direct_share_config(10, payload(), request(), response, db, user()))
    assert data["customer_name"] == "客户甲" and data["remaining_chances"] == 0
    assert data["chance_limit"] == 1
    assert data["share"] == {
        "title": "客户抽奖", "description": "查看您的专属抽奖机会",
        "image": "https://images.example.test/lottery-card.png",
        "url": "https://example.test/share/lottery/customer-private-token?card=3",
        "lottery_url": "https://example.test/lottery/customer-private-token",
    }
    assert data["diagnostics"]["sign_url"] == "https://example.test/lottery-workspace"
    for private_value in ("private-phone", "private-address", "CRM-009", "internal"):
        assert private_value not in str(data)
    assert "ticket" not in data and "preview_url" not in data
    assert "ticket" not in data["share"]["url"]
    assert response.headers["Cache-Control"] == "no-store"
    assert response.headers["Referrer-Policy"] == "no-referrer"
    assert customer.chance_used == 1 and customer.chance_total == 3
    assert not db.added and not db.flushes


@pytest.mark.parametrize("change,status", [
    ("user_missing", 403), ("user_disabled", 403), ("not_owner", 403),
    ("staff_revoked", 403), ("link_missing", 410), ("link_disabled", 410),
    ("link_expired", 410), ("campaign_missing", 410), ("campaign_deleted", 410),
    ("campaign_draft", 410), ("campaign_paused", 410), ("campaign_ended", 410),
])
def test_share_configuration_rechecks_current_permission_and_state(change, status):
    customer, activity, employee, assignment = link(), campaign(), user(), staff()
    if change == "user_missing": employee = None
    if change == "user_disabled": employee.disabled = True
    if change == "not_owner": employee.id = 6
    if change == "staff_revoked": assignment = None
    if change == "link_missing": customer = None
    if change == "link_disabled": customer.status = "disabled"
    if change == "link_expired": customer.expires_at = datetime.utcnow() - timedelta(seconds=1)
    if change == "campaign_missing": activity = None
    if change == "campaign_deleted": activity.deleted_at = datetime.utcnow()
    if change in {"campaign_draft", "campaign_paused", "campaign_ended"}:
        activity.status = change.split("_")[1]
    db = Session(Result(customer), Result(activity), Result(assignment))
    with pytest.raises(HTTPException) as error:
        complete(api.direct_share_config(10, payload(), request(), Response(), db, employee))
    assert error.value.status_code == status
    assert not db.added and not db.flushes


def test_staff_lookup_excludes_disabled_grants():
    db = permitted_session()
    complete(api.direct_share_config(10, payload(), request(), Response(), db, user()))
    statement = str(db.statements[-1].compile(compile_kwargs={"literal_binds": True}))
    assert "lottery_campaign_staff.enabled IS true" in statement
    assert "lottery_campaign_staff.user_id = 5" in statement
    assert "lottery_campaign_staff.campaign_id = 7" in statement


def test_admin_can_share_other_employees_link_without_staff_assignment():
    db = Session(Result(link()), Result(campaign()))
    data = complete(api.direct_share_config(10, payload("https://example.test/admin/lottery"),
                    request(), Response(), db, user(role="admin", user_id=99)))
    assert data["remaining_chances"] == 0 and not db.results


def test_not_started_and_exhausted_links_do_not_grant_additional_chances():
    customer, activity = link(used=3, total=3), campaign()
    activity.start_at = datetime.utcnow() + timedelta(hours=1)
    data = complete(api.direct_share_config(10, payload(), request(), Response(),
                    permitted_session(customer, activity), user()))
    assert data["remaining_chances"] == 0
    assert customer.chance_used == 3 and customer.chance_total == 3


def test_only_wechat_signature_is_requested_even_with_wecom_configured(monkeypatch, configuration):
    configuration.wecom_enabled = configuration.wechat_mp_ready = True
    signed = []

    async def build(url):
        signed.append(url)
        return {"enabled": True, "signature": "test-signature"}

    monkeypatch.setattr(WecomClient, "build_js_sdk_config", build)
    monkeypatch.setattr(WecomClient, "build_agent_js_sdk_config", build)
    monkeypatch.setattr(api.lottery._wechat_mp_client, "build_js_sdk_config", build)
    data = complete(api.direct_share_config(10, payload("https://example.test/lottery-workspace?campaign=7#links"),
                    request(), Response(), permitted_session(), user()))
    assert signed == ["https://example.test/lottery-workspace?campaign=7"]
    for name in ("wechat_sdk",):
        assert data[name]["enabled"]
        assert "showOptionMenu" in data[name]["js_api_list"]
        assert "updateAppMessageShareData" in data[name]["js_api_list"]
        assert "onMenuShareAppMessage" in data[name]["js_api_list"]
        assert "hideOptionMenu" not in data[name]["js_api_list"]
    for name in ("shareAppMessage", "shareWechatMessage"):
        assert name not in data["sdk"]["js_api_list"]
        assert name not in data["wechat_sdk"]["js_api_list"]
    assert not data["sdk"]["enabled"] and not data["agent_sdk"]["enabled"]
    assert data["agent_sdk"]["js_api_list"] == []
    assert data["diagnostics"]["share_url"] == data["share"]["url"]
    assert data["diagnostics"]["lottery_url"] == data["share"]["lottery_url"]


def test_wechat_signature_failure_keeps_plain_link_available_without_leaking_secrets(monkeypatch, configuration):
    configuration.wechat_mp_ready = True

    async def failed(_url):
        raise WechatApiError("secret access_token=upstream-secret-123", errcode=40013)

    monkeypatch.setattr(api.lottery._wechat_mp_client, "build_js_sdk_config", failed)
    data = complete(api.direct_share_config(10, payload(), request(), Response(), permitted_session(), user()))
    assert not data["wechat_sdk"]["enabled"] and not data["agent_sdk"]["enabled"]
    assert data["share"]["url"].startswith("https://example.test/share/lottery/")
    assert "40013" in data["diagnostics"]["wechat"]["reason"]
    assert "upstream-secret-123" not in str(data) and "access_token" not in str(data)


def post(app, body, *, headers=None):
    async def perform():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="https://example.test") as client:
            return await client.post("/api/lottery/links/10/share-config", json=body, headers=headers)

    return asyncio.run(perform())


def application(db, *, employee=None):
    app = FastAPI()
    app.include_router(api.router)

    async def database():
        yield db

    app.dependency_overrides[api.get_db] = database
    if employee is not None:
        async def current_user():
            return employee
        app.dependency_overrides[api.get_current_user] = current_user
    return app


def test_http_requires_login_and_does_not_accept_employee_preview_ticket():
    db = Session()
    app = application(db)
    preview_ticket, _ = api._issue_ticket(user(), link())
    for headers in (None, {"Authorization": f"Bearer {preview_ticket}"}):
        result = post(app, payload().model_dump(), headers=headers)
        assert result.status_code == 401 and "location" not in result.headers
    assert not db.statements and not db.added


def test_http_authorized_request_returns_no_store_and_expected_metadata():
    db = permitted_session()
    result = post(application(db, employee=user()), payload().model_dump())
    assert result.status_code == 200
    assert result.headers["Cache-Control"] == "no-store"
    assert result.headers["Referrer-Policy"] == "no-referrer"
    assert result.json()["remaining_chances"] == 0
    assert "ticket" not in result.json()


@pytest.mark.parametrize("total,used,expected", [(10, 0, 1), (10, 1, 0), (10, 4, 0), (1, 0, 1)])
def test_share_count_uses_single_draw_policy_without_rewriting_history(total, used, expected):
    customer = link(total=total, used=used)
    data = complete(api.direct_share_config(10, payload(), request(), Response(), permitted_session(customer), user()))
    assert data["remaining_chances"] == expected
    assert customer.chance_total == total and customer.chance_used == used


@pytest.mark.parametrize("body", [{}, {"url": ""}, {"url": "x" * 4097}])
def test_http_requires_bounded_url_payload(body):
    db = Session()
    result = post(application(db, employee=user()), body)
    assert result.status_code == 422 and not db.statements
