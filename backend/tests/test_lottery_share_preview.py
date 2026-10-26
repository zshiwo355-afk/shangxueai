"""Employee preview credentials are short-lived, revocable and never customer URLs."""
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from urllib.parse import parse_qs, urlsplit

import httpx
import jwt
import pytest
from fastapi import FastAPI, HTTPException, Response
from fastapi.testclient import TestClient

from app import lottery_share_api as api
from app.models import LotteryCampaignStaff, User
from app.wecom_client import WecomClient
from test_lottery_closure import Result, Session, campaign, complete, link, request


@pytest.fixture(autouse=True)
def configuration(monkeypatch):
    config = SimpleNamespace(
        jwt_secret="test-login-key-never-a-preview-key", resolved_wecom_frontend_base_url="https://example.test",
        wecom_enabled=False, wecom_corp_id="corp", wecom_agent_id=1, wecom_app_secret="secret",
        wechat_mp_ready=False,
    )
    monkeypatch.setattr(api, "settings", config)
    monkeypatch.setattr(api.lottery, "settings", config)
    return config


def user(role="user", user_id=5, disabled=False):
    return User(id=user_id, role=role, disabled=disabled)


def staff():
    return LotteryCampaignStaff(campaign_id=7, user_id=5, enabled=True)


def payload(token):
    return api.SharePreviewPayload(ticket=token, url="https://example.test/lottery-share/customer-private-token#ticket=not-signed")


def test_create_session_uses_fragment_and_preserves_customer_card_url():
    customer = link()
    customer.recipient_phone, customer.recipient_address = "private-phone", "private-address"
    db = Session(Result(customer), Result(campaign()), Result(staff()))
    response = Response()
    data = complete(api.create_share_session(10, request(), response, db, user()))
    preview = urlsplit(data["preview_url"])
    ticket = parse_qs(preview.fragment)["ticket"][0]
    decoded = api._read_ticket(ticket)
    assert preview.path == "/lottery-share/customer-private-token" and not preview.query
    assert decoded["link_id"] == 10 and decoded["sub"] == "5"
    assert decoded["exp"] - decoded["iat"] == api.SHARE_TTL_SECONDS
    assert data["share"]["url"] == "https://example.test/share/lottery/customer-private-token?card=3"
    assert data["remaining_chances"] == 0 and data["customer_name"] == "客户甲"
    assert "ticket" not in data["share"]["url"] and "private-phone" not in str(data)
    assert "private-address" not in str(data) and "CRM-009" not in str(data)
    assert response.headers["Cache-Control"] == "no-store" and not db.added and not db.flushes


def test_preview_ticket_is_not_a_login_token(configuration):
    token, _ = api._issue_ticket(user(), link())
    with pytest.raises(jwt.InvalidSignatureError):
        jwt.decode(token, configuration.jwt_secret, algorithms=["HS256"], options={"verify_aud": False})
    login = jwt.encode({"sub": "5", "exp": datetime.now(timezone.utc) + timedelta(minutes=5)},
                       configuration.jwt_secret, algorithm="HS256")
    with pytest.raises(HTTPException) as error:
        api._read_ticket(login)
    assert error.value.status_code == 403


@pytest.mark.parametrize("change,status", [
    ({"exp": 1}, 410), ({"purpose": "login"}, 403), ({"aud": "login"}, 403),
    ({"link_id": True}, 403), ({"link_id": -1}, 403), ({"sub": "0"}, 403),
    ({"public_code": ""}, 403),
])
def test_ticket_expiry_and_scope_are_enforced(change, status):
    token, _ = api._issue_ticket(user(), link())
    claims = api._read_ticket(token)
    claims.update(change)
    altered = jwt.encode(claims, api._ticket_key(), algorithm="HS256")
    with pytest.raises(HTTPException) as error:
        api._read_ticket(altered)
    assert error.value.status_code == status


@pytest.mark.parametrize("url", [
    "https://evil.test/lottery-share", "https://example.test.evil.test/lottery-share",
    "https://example.test:444/lottery-share", "http://example.test/lottery-share",
    "https://someone@example.test/lottery-share", "https://example.test/admin",
    "https://example.test/lottery-share/", "https://example.test/%6cottery-share",
    "https://example.test/lottery-share?ticket=leaked", "https://example.test/lottery-share\n",
    "//example.test/lottery-share", "https://example.test:broken/lottery-share",
    "https://example.test/lottery-share/another-customer-code",
    "https://example.test/lottery-share/customer-private-token/",
])
def test_only_configured_origin_and_preview_path_can_receive_a_signature(url):
    with pytest.raises(HTTPException) as error:
        api._sign_url(url, "customer-private-token")
    assert error.value.status_code == 403


def test_signature_strips_fragment_but_retains_actual_browser_query():
    assert api._sign_url("https://example.test/lottery-share/customer-private-token?from=singlemessage#ticket=secret", "customer-private-token") == (
        "https://example.test/lottery-share/customer-private-token?from=singlemessage"
    )


def test_previous_preview_path_remains_supported_for_unexpired_tickets():
    assert api._sign_url("https://example.test/lottery-share#ticket=secret", "customer-private-token") == (
        "https://example.test/lottery-share"
    )


def test_preview_rejects_a_different_customer_path_before_querying_database():
    token, _ = api._issue_ticket(user(), link())
    invalid = api.SharePreviewPayload(ticket=token, url="https://example.test/lottery-share/someone-else")
    db = Session()
    with pytest.raises(HTTPException) as error:
        complete(api.resolve_share_preview(invalid, request(), Response(), db))
    assert error.value.status_code == 403 and not db.statements


def test_no_host_header_fallback_when_frontend_origin_is_not_configured(configuration):
    configuration.resolved_wecom_frontend_base_url = ""
    with pytest.raises(HTTPException) as error:
        complete(api.create_share_session(10, request(), Response(), Session(), user()))
    assert error.value.status_code == 503


def test_cannot_create_preview_for_another_employees_link():
    with pytest.raises(HTTPException) as error:
        complete(api.create_share_session(10, request(), Response(), Session(Result(link())), user(user_id=6)))
    assert error.value.status_code == 403


def test_admin_can_share_a_link_without_a_staff_assignment():
    data = complete(api.create_share_session(10, request(), Response(),
                    Session(Result(link()), Result(campaign())), user(role="admin", user_id=99)))
    assert data["remaining_chances"] == 0


def test_missing_staff_permission_is_enforced_during_creation():
    with pytest.raises(HTTPException) as error:
        complete(api.create_share_session(10, request(), Response(),
                    Session(Result(link()), Result(campaign()), Result(None)), user()))
    assert error.value.status_code == 403


@pytest.mark.parametrize("change,status", [
    ("user_removed", 403), ("user_disabled", 403), ("owner_changed", 403), ("staff_revoked", 403),
    ("code_rotated", 410), ("link_disabled", 410), ("link_expired", 410), ("link_removed", 410),
    ("campaign_deleted", 410), ("campaign_draft", 410), ("campaign_paused", 410), ("campaign_ended", 410),
])
def test_preview_rechecks_all_current_permissions_and_link_state(change, status):
    customer, activity, employee = link(), campaign(), user()
    token, _ = api._issue_ticket(employee, customer)
    assignment = staff()
    if change == "user_removed": employee = None
    if change == "user_disabled": employee.disabled = True
    if change == "owner_changed": customer.created_by_user_id = 999
    if change == "staff_revoked": assignment = None
    if change == "code_rotated": customer.public_code = "different-code"
    if change == "link_disabled": customer.status = "disabled"
    if change == "link_expired": customer.expires_at = datetime.utcnow() - timedelta(seconds=1)
    if change == "link_removed": customer = None
    if change == "campaign_deleted": activity.deleted_at = datetime.utcnow()
    if change.startswith("campaign_") and change != "campaign_deleted": activity.status = change.split("_")[1]
    db = Session(Result(employee), Result(customer), Result(activity), Result(assignment))
    with pytest.raises(HTTPException) as error:
        complete(api.resolve_share_preview(payload(token), request(), Response(), db))
    assert error.value.status_code == status
    assert not db.added and not db.flushes


def test_zero_remaining_chances_can_share_results_without_granting_chances():
    customer = link(used=3, total=3)
    activity = campaign()
    activity.start_at = datetime.utcnow() + timedelta(hours=1)
    token, _ = api._issue_ticket(user(), customer)
    response = Response()
    data = complete(api.resolve_share_preview(payload(token), request(), response,
                    Session(Result(user()), Result(customer), Result(activity), Result(staff()))))
    assert data["remaining_chances"] == 0 and customer.chance_used == 3
    assert not data["wechat_sdk"]["enabled"] and "未配置" in data["diagnostics"]["wechat"]["reason"]
    assert "ticket" not in data and "preview_url" not in data
    assert "ticket" not in data["diagnostics"]["sign_url"]
    assert response.headers["Referrer-Policy"] == "no-referrer"


def test_only_wechat_sdk_enables_employee_sharing_with_customer_card_url(monkeypatch, configuration):
    configuration.wecom_enabled = configuration.wechat_mp_ready = True
    signed = []

    async def build(url):
        signed.append(url)
        return {"enabled": True, "signature": "sdk-signature"}

    monkeypatch.setattr(WecomClient, "build_js_sdk_config", build)
    monkeypatch.setattr(WecomClient, "build_agent_js_sdk_config", build)
    monkeypatch.setattr(api.lottery._wechat_mp_client, "build_js_sdk_config", build)
    token, _ = api._issue_ticket(user(), link())
    data = complete(api.resolve_share_preview(payload(token), request(), Response(),
                    Session(Result(user()), Result(link()), Result(campaign()), Result(staff()))))
    assert signed == ["https://example.test/lottery-share/customer-private-token"]
    for name in ("wechat_sdk",):
        assert "showOptionMenu" in data[name]["js_api_list"]
        assert "updateAppMessageShareData" in data[name]["js_api_list"]
        assert "onMenuShareAppMessage" in data[name]["js_api_list"]
        assert "hideOptionMenu" not in data[name]["js_api_list"]
    assert not data["sdk"]["enabled"] and not data["agent_sdk"]["enabled"]
    assert data["agent_sdk"]["js_api_list"] == []
    assert "/share/lottery/" in data["share"]["url"] and "ticket" not in data["share"]["url"]


def test_wecom_services_are_not_called_by_lottery_preview(monkeypatch, configuration):
    configuration.wecom_enabled = configuration.wechat_mp_ready = True

    async def good(_url): return {"enabled": True}

    async def bad(_url): raise AssertionError("Lottery must not request corporate sharing credentials")

    monkeypatch.setattr(WecomClient, "build_js_sdk_config", bad)
    monkeypatch.setattr(WecomClient, "build_agent_js_sdk_config", bad)
    monkeypatch.setattr(api.lottery._wechat_mp_client, "build_js_sdk_config", good)
    token, _ = api._issue_ticket(user(), link())
    data = complete(api.resolve_share_preview(payload(token), request(), Response(),
                    Session(Result(user()), Result(link()), Result(campaign()), Result(staff()))))
    assert not data["sdk"]["enabled"] and data["wechat_sdk"]["enabled"] and not data["agent_sdk"]["enabled"]
    assert "仅支持普通微信" in data["diagnostics"]["wecom_agent"]["reason"]


def test_transport_exception_does_not_expose_access_token():
    async def failure(_url):
        raise httpx.ConnectError("request failed https://upstream.test?access_token=secret")

    sdk, reason = complete(api._build_sdk(failure, "https://example.test/lottery-share", [], "普通微信"))
    assert not sdk["enabled"] and "secret" not in reason and "access_token" not in reason


def test_http_preview_uses_ticket_without_login_and_never_redirects_to_login():
    app = FastAPI()
    app.include_router(api.router)

    async def database():
        yield Session(Result(user()), Result(link()), Result(campaign()), Result(staff()))

    app.dependency_overrides[api.get_db] = database
    token, _ = api._issue_ticket(user(), link())
    with TestClient(app) as client:
        result = client.post("/api/public/lottery/share-preview", json=payload(token).model_dump())
        invalid = client.post("/api/public/lottery/share-preview", json=payload("invalid-ticket-with-no-signature").model_dump())
    assert result.status_code == 200 and result.headers["Cache-Control"] == "no-store"
    assert result.json()["remaining_chances"] == 0
    assert invalid.status_code == 403 and "location" not in invalid.headers


@pytest.mark.parametrize("body", [{}, {"ticket": "short", "url": "x"}, {"ticket": "x" * 5000, "url": "x"}])
def test_http_preview_validates_bounded_payload(body):
    app = FastAPI()
    app.include_router(api.router)

    async def database():
        yield Session()

    app.dependency_overrides[api.get_db] = database
    with TestClient(app) as client:
        result = client.post("/api/public/lottery/share-preview", json=body)
    assert result.status_code == 422


def test_http_create_requires_login():
    app = FastAPI()
    app.include_router(api.router)

    async def database():
        yield Session()

    app.dependency_overrides[api.get_db] = database
    with TestClient(app) as client:
        result = client.post("/api/lottery/links/10/share-session", json={})
    assert result.status_code == 401
