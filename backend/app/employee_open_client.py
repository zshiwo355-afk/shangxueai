from __future__ import annotations

import asyncio
import base64
import json
import time
from typing import Any
from urllib.parse import urljoin

import httpx
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding

from .config import get_settings


class EmployeeOpenApiError(RuntimeError):
    pass


def _normalize_key_material(raw: str) -> bytes:
    text = (raw or "").strip()
    if not text:
        raise EmployeeOpenApiError("第三方员工同步密钥未配置。")
    if "BEGIN" in text:
        return text.encode("utf-8")
    try:
        return base64.b64decode(text)
    except Exception as exc:  # noqa: BLE001
        raise EmployeeOpenApiError("第三方员工同步密钥格式无效。") from exc


class EmployeeOpenClient:
    _http_client: httpx.AsyncClient | None = None
    _http_lock = asyncio.Lock()
    _private_key = None
    _public_key = None

    def __init__(self) -> None:
        self.settings = get_settings()

    def ensure_ready(self) -> None:
        if not self.settings.employee_sync_ready:
            raise EmployeeOpenApiError("第三方员工同步未启用或配置不完整。")

    @classmethod
    async def _get_http_client(cls) -> httpx.AsyncClient:
        if cls._http_client is not None:
            return cls._http_client
        async with cls._http_lock:
            if cls._http_client is None:
                cls._http_client = httpx.AsyncClient(
                    timeout=httpx.Timeout(30.0, connect=10.0),
                    limits=httpx.Limits(max_connections=20, max_keepalive_connections=10),
                    follow_redirects=True,
                )
        return cls._http_client

    @classmethod
    async def aclose(cls) -> None:
        if cls._http_client is not None:
            await cls._http_client.aclose()
            cls._http_client = None

    def _canonical_query(self, params: dict[str, Any] | None) -> str:
        if not params:
            return ""
        parts: list[str] = []
        for key in sorted(params.keys()):
            value = params[key]
            if value is None:
                continue
            parts.append(f"{key}={value}")
        return "&".join(parts)

    def _get_private_key(self):
        if self.__class__._private_key is None:
            key_bytes = _normalize_key_material(self.settings.employee_sync_partner_private_key)
            try:
                self.__class__._private_key = serialization.load_der_private_key(key_bytes, password=None)
            except ValueError:
                self.__class__._private_key = serialization.load_pem_private_key(key_bytes, password=None)
        return self.__class__._private_key

    def _get_public_key(self):
        raw = (self.settings.employee_sync_hr_public_key or "").strip()
        if not raw:
            return None
        if self.__class__._public_key is None:
            key_bytes = _normalize_key_material(raw)
            try:
                self.__class__._public_key = serialization.load_der_public_key(key_bytes)
            except ValueError:
                self.__class__._public_key = serialization.load_pem_public_key(key_bytes)
        return self.__class__._public_key

    def _build_signature(self, *, timestamp: str, method: str, path: str, canonical_query: str) -> str:
        payload = "\n".join(
            [
                self.settings.employee_sync_app_id.strip(),
                timestamp,
                method.upper(),
                path,
                canonical_query,
            ]
        )
        signature = self._get_private_key().sign(
            payload.encode("utf-8"),
            padding.PKCS1v15(),
            hashes.SHA256(),
        )
        return base64.b64encode(signature).decode("utf-8")

    def _verify_response(self, *, body: str, response_sign: str) -> None:
        public_key = self._get_public_key()
        if public_key is None:
            return
        if not response_sign.strip():
            return
        try:
            public_key.verify(
                base64.b64decode(response_sign),
                body.encode("utf-8"),
                padding.PKCS1v15(),
                hashes.SHA256(),
            )
        except InvalidSignature as exc:
            raise EmployeeOpenApiError("第三方员工接口响应签名校验失败。") from exc

    async def fetch_employees(self, filters: dict[str, Any] | None = None) -> list[dict[str, Any]]:
        self.ensure_ready()
        path = "/api/open/employees"
        canonical_query = self._canonical_query(filters)
        timestamp = str(int(time.time()))
        headers = {
            "X-App-Id": self.settings.employee_sync_app_id.strip(),
            "X-Timestamp": timestamp,
            "X-Sign": self._build_signature(
                timestamp=timestamp,
                method="GET",
                path=path,
                canonical_query=canonical_query,
            ),
        }
        client = await self._get_http_client()
        url = urljoin(self.settings.employee_sync_base_url.rstrip("/") + "/", path.lstrip("/"))
        try:
            response = await client.get(
                url,
                params={k: v for k, v in (filters or {}).items() if v not in (None, "")},
                headers=headers,
                timeout=max(5, int(self.settings.employee_sync_timeout_seconds or 15)),
            )
            response.raise_for_status()
        except httpx.HTTPError as exc:
            raise EmployeeOpenApiError(f"第三方员工接口请求失败：{exc}") from exc

        body = response.text
        response_sign = response.headers.get("X-Response-Sign", "")
        data = None
        try:
            data = response.json()
        except json.JSONDecodeError as exc:
            raise EmployeeOpenApiError("第三方员工接口返回的不是合法 JSON。") from exc

        try:
            code = int(data.get("code", -1))
        except (TypeError, ValueError):
            code = -1
        if code != 0:
            raise EmployeeOpenApiError(str(data.get("message") or "第三方员工接口返回失败。"))

        self._verify_response(body=body, response_sign=response_sign)

        payload = data.get("data") or {}
        items = payload.get("list") or []
        if not isinstance(items, list):
            raise EmployeeOpenApiError("第三方员工接口返回的 list 字段格式不正确。")
        return [item for item in items if isinstance(item, dict)]
