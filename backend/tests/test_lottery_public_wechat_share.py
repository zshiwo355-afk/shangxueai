"""Lottery share metadata uses ordinary WeChat only, independent of employee SSO."""
from types import SimpleNamespace

import pytest
import httpx

from app import lottery_api as api
from app.wecom_client import WecomClient
from app.wechat_client import WechatApiError
from test_lottery_closure import campaign, complete, link, request


@pytest.mark.parametrize("configured", [True, False])
def test_public_share_does_not_initialize_enterprise_sdk(monkeypatch, configured):
    calls = []

    async def context(_db, _code):
        return campaign(), link()

    async def enterprise(*_args, **_kwargs):
        raise AssertionError("Enterprise SDK must not be called by lottery shares")

    async def wechat(url):
        calls.append(url)
        return {"enabled": True, "app_id": "test-mp", "signature": "signature"}

    share = {"url": "https://example.test/lottery/share/code", "lottery_url": "https://example.test/lottery/code"}
    monkeypatch.setattr(api, "_public_link_context", context)
    monkeypatch.setattr(api, "share_payload", lambda *_args: share)
    monkeypatch.setattr(api, "settings", SimpleNamespace(wechat_mp_ready=configured))
    monkeypatch.setattr(WecomClient, "build_js_sdk_config", enterprise)
    monkeypatch.setattr(WecomClient, "build_agent_js_sdk_config", enterprise)
    monkeypatch.setattr(api._wechat_mp_client, "build_js_sdk_config", wechat)
    response = complete(api.public_share_config("code", request(), "https://example.test/lottery/code#ticket", None))
    assert not response["sdk"]["enabled"] and not response["agent_sdk"]["enabled"]
    assert not response["diagnostics"]["wecom"]["configured"]
    assert not response["diagnostics"]["wecom_agent"]["configured"]
    assert response["share"] == share
    assert calls == (["https://example.test/lottery/code"] if configured else [])
    if configured:
        assert response["wechat_sdk"]["enabled"]
        assert "showOptionMenu" in response["wechat_sdk"]["js_api_list"]
        assert "updateAppMessageShareData" in response["wechat_sdk"]["js_api_list"]
        assert "hideOptionMenu" not in response["wechat_sdk"]["js_api_list"]
    else:
        assert not response["wechat_sdk"]["enabled"]
        assert "仍可使用微信原生转发" in response["diagnostics"]["wechat"]["reason"]


@pytest.mark.parametrize("error", [WechatApiError("access_token=private-secret", errcode=40013), httpx.ConnectError("access_token=private-secret")])
def test_wechat_sdk_failure_still_returns_safe_metadata(monkeypatch, error):
    async def context(_db, _code):
        return campaign(), link()

    async def unavailable(_url):
        raise error

    share = {"url": "https://example.test/share", "lottery_url": "https://example.test/lottery"}
    monkeypatch.setattr(api, "_public_link_context", context)
    monkeypatch.setattr(api, "share_payload", lambda *_args: share)
    monkeypatch.setattr(api, "settings", SimpleNamespace(wechat_mp_ready=True))
    monkeypatch.setattr(api._wechat_mp_client, "build_js_sdk_config", unavailable)
    response = complete(api.public_share_config("code", request(), None, None))
    assert response["share"] == share and not response["wechat_sdk"]["enabled"]
    assert "签名暂不可用" in response["diagnostics"]["wechat"]["reason"]
    assert "private-secret" not in str(response) and "access_token" not in str(response)
