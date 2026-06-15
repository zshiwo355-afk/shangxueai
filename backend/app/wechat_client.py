from __future__ import annotations

import asyncio
import hashlib
import secrets
import time
from typing import Any

import httpx

from .config import get_settings


class WechatApiError(RuntimeError):
    def __init__(self, message: str, *, errcode: int | None = None) -> None:
        super().__init__(message)
        self.errcode = errcode


class WechatMpClient:
    _token_lock = asyncio.Lock()
    _token_cache: tuple[str, float] | None = None
    _ticket_lock = asyncio.Lock()
    _ticket_cache: tuple[str, float] | None = None
    _http_client: httpx.AsyncClient | None = None
    _http_lock = asyncio.Lock()

    def __init__(self) -> None:
        self.settings = get_settings()

    def ensure_ready(self) -> None:
        if not self.settings.wechat_mp_ready:
            raise WechatApiError("微信公众号分享配置未启用或凭证不完整。")

    @classmethod
    async def _get_http_client(cls) -> httpx.AsyncClient:
        if cls._http_client is not None and not cls._http_client.is_closed:
            return cls._http_client
        async with cls._http_lock:
            if cls._http_client is None or cls._http_client.is_closed:
                cls._http_client = httpx.AsyncClient(
                    timeout=httpx.Timeout(30.0, connect=10.0),
                    limits=httpx.Limits(max_connections=30, max_keepalive_connections=10),
                )
        return cls._http_client

    @classmethod
    async def aclose(cls) -> None:
        client = cls._http_client
        cls._http_client = None
        if client is not None and not client.is_closed:
            try:
                await client.aclose()
            except Exception:  # noqa: BLE001
                pass

    async def _request_json(
        self,
        url: str,
        *,
        params: dict[str, Any],
    ) -> dict[str, Any]:
        client = await self._get_http_client()
        response = await client.get(
            url,
            params=params,
            timeout=self.settings.wechat_mp_request_timeout_seconds,
        )
        response.raise_for_status()
        data = response.json()
        errcode = int(data.get("errcode", 0) or 0)
        if errcode != 0:
            errmsg = str(data.get("errmsg") or "微信公众号接口调用失败。").strip()
            raise WechatApiError(f"{errmsg} (errcode={errcode})", errcode=errcode)
        return data

    async def get_access_token(self) -> str:
        self.ensure_ready()
        now = time.time()
        cached = self._token_cache
        if cached and cached[1] > now:
            return cached[0]
        async with self._token_lock:
            cached = self._token_cache
            if cached and cached[1] > time.time():
                return cached[0]
            data = await self._request_json(
                "https://api.weixin.qq.com/cgi-bin/token",
                params={
                    "grant_type": "client_credential",
                    "appid": self.settings.wechat_mp_app_id,
                    "secret": self.settings.wechat_mp_app_secret,
                },
            )
            token = str(data.get("access_token") or "").strip()
            if not token:
                raise WechatApiError("微信公众号 access_token 为空。")
            ttl = max(60, min(int(data.get("expires_in", 7200) or 7200), self.settings.wechat_mp_token_cache_seconds))
            type(self)._token_cache = (token, time.time() + ttl - 30)
            return token

    async def get_jsapi_ticket(self) -> str:
        self.ensure_ready()
        now = time.time()
        cached = self._ticket_cache
        if cached and cached[1] > now:
            return cached[0]
        async with self._ticket_lock:
            cached = self._ticket_cache
            if cached and cached[1] > time.time():
                return cached[0]
            token = await self.get_access_token()
            data = await self._request_json(
                "https://api.weixin.qq.com/cgi-bin/ticket/getticket",
                params={"access_token": token, "type": "jsapi"},
            )
            ticket = str(data.get("ticket") or "").strip()
            if not ticket:
                raise WechatApiError("微信公众号 jsapi_ticket 为空。")
            ttl = max(60, min(int(data.get("expires_in", 7200) or 7200), self.settings.wechat_mp_token_cache_seconds))
            type(self)._ticket_cache = (ticket, time.time() + ttl - 30)
            return ticket

    async def build_js_sdk_config(self, url: str) -> dict[str, Any]:
        clean_url = (url or "").strip()
        if not clean_url:
            raise WechatApiError("缺少微信 JS-SDK 签名 URL。")
        ticket = await self.get_jsapi_ticket()
        timestamp = int(time.time())
        nonce = secrets.token_hex(8)
        raw = f"jsapi_ticket={ticket}&noncestr={nonce}&timestamp={timestamp}&url={clean_url}"
        signature = hashlib.sha1(raw.encode("utf-8")).hexdigest()
        return {
            "enabled": True,
            "app_id": self.settings.wechat_mp_app_id,
            "timestamp": timestamp,
            "nonce_str": nonce,
            "signature": signature,
        }
