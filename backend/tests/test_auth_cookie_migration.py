import asyncio
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from urllib.parse import urlencode

from fastapi import Response
from starlette.requests import Request

from app.auth import _auth_cookie_name, _extract_token, get_current_user


def _request(
    *,
    authorization: str = "",
    access_token: str = "",
    cookie_token: str = "",
) -> Request:
    headers: list[tuple[bytes, bytes]] = []
    if authorization:
        headers.append((b"authorization", authorization.encode("ascii")))
    if cookie_token:
        cookie = f"{_auth_cookie_name()}={cookie_token}"
        headers.append((b"cookie", cookie.encode("ascii")))
    query_string = (
        urlencode({"access_token": access_token}).encode("ascii")
        if access_token
        else b""
    )
    return Request(
        {
            "type": "http",
            "asgi": {"version": "3.0"},
            "http_version": "1.1",
            "method": "GET",
            "scheme": "https",
            "path": "/api/auth/me",
            "raw_path": b"/api/auth/me",
            "query_string": query_string,
            "headers": headers,
            "client": ("127.0.0.1", 12345),
            "server": ("testserver", 443),
        }
    )


def _authenticated_user(request: Request, response: Response):
    expires_at = int((datetime.now(tz=timezone.utc) + timedelta(hours=1)).timestamp())
    user = SimpleNamespace(id=7, username="tester", role="user", disabled=False)
    result = SimpleNamespace(scalar_one_or_none=lambda: user)
    db = SimpleNamespace(execute=AsyncMock(return_value=result))
    with patch(
        "app.auth.decode_token",
        return_value={"sub": str(user.id), "exp": expires_at},
    ):
        returned_user = asyncio.run(get_current_user(request, response, db))
    return returned_user


def test_extract_token_reports_source_and_preserves_precedence() -> None:
    request = _request(
        authorization="Bearer header-token",
        access_token="query-token",
        cookie_token="cookie-token",
    )

    assert _extract_token(request) == ("header-token", "authorization_bearer")
    assert _extract_token(_request(access_token="query-token", cookie_token="cookie-token")) == (
        "query-token",
        "query",
    )
    assert _extract_token(_request(cookie_token="cookie-token")) == ("cookie-token", "cookie")


def test_bearer_token_is_migrated_to_cookie() -> None:
    response = Response()

    user = _authenticated_user(_request(authorization="Bearer header-token"), response)

    assert user.id == 7
    set_cookie = response.headers.get("set-cookie") or ""
    assert f"{_auth_cookie_name()}=header-token" in set_cookie
    assert "HttpOnly" in set_cookie


def test_query_token_is_not_migrated_to_cookie() -> None:
    response = Response()

    _authenticated_user(_request(access_token="query-token"), response)

    assert response.headers.get("set-cookie") is None


def test_cookie_token_is_not_persisted_again() -> None:
    response = Response()

    _authenticated_user(_request(cookie_token="cookie-token"), response)

    assert response.headers.get("set-cookie") is None


def test_matching_cookie_is_not_persisted_again_for_bearer_token() -> None:
    response = Response()

    _authenticated_user(
        _request(authorization="Bearer shared-token", cookie_token="shared-token"),
        response,
    )

    assert response.headers.get("set-cookie") is None
