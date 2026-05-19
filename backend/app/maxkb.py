"""精简版 MaxKB 客户端：仅保留陪练需要的鉴权 + hit_test 段落检索。

鉴权策略沿用 AIprivate-副本：
  - 优先用 MAXKB_SYSTEM_API_KEY（一劳永逸，推荐生产环境）
  - 否则走 admin 用户名/密码登录拿 token，401/403 时自动 refresh 一次
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any

import httpx

from .config import Settings

logger = logging.getLogger(__name__)


class MaxKBError(Exception):
    def __init__(self, message: str, status_code: int = 502) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code


class MaxKBClient:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._admin_token: str | None = None
        self._admin_lock = asyncio.Lock()

    async def _login_admin(self) -> str:
        if not self.settings.maxkb_admin_username or not self.settings.maxkb_admin_password:
            raise MaxKBError(
                "MaxKB 后台未配置登录账号，请在 backend/.env 中设置 MAXKB_ADMIN_USERNAME / MAXKB_ADMIN_PASSWORD，或改用 MAXKB_SYSTEM_API_KEY。",
                status_code=503,
            )

        url = f"{self.settings.maxkb_admin_api_url}/user/login"
        payload = {
            "username": self.settings.maxkb_admin_username,
            "password": self.settings.maxkb_admin_password,
        }

        async with httpx.AsyncClient(timeout=self.settings.maxkb_timeout_seconds) as client:
            try:
                response = await client.post(url, json=payload, follow_redirects=True)
            except httpx.TimeoutException as exc:
                raise MaxKBError("MaxKB 后台登录超时，请稍后重试。", status_code=504) from exc
            except httpx.HTTPError as exc:
                raise MaxKBError("无法连接到 MaxKB 后台服务，请检查地址与网络。") from exc

        try:
            data = response.json()
        except ValueError as exc:
            raise MaxKBError("MaxKB 后台登录返回了无法解析的内容。") from exc

        if response.status_code >= 400 or data.get("code") not in (None, 200):
            message = data.get("message") or "MaxKB 后台登录失败。"
            raise MaxKBError(message, status_code=response.status_code or 502)

        token = data.get("data", {}).get("token")
        if not token:
            raise MaxKBError("MaxKB 后台登录未返回有效 token。")
        return str(token)

    async def _get_admin_headers(self, refresh: bool = False) -> dict[str, str]:
        if self.settings.maxkb_system_api_key:
            return {
                "Authorization": f"Bearer {self.settings.maxkb_system_api_key}",
                "Content-Type": "application/json",
            }

        async with self._admin_lock:
            if refresh or not self._admin_token:
                self._admin_token = await self._login_admin()

            return {
                "Authorization": f"Bearer {self._admin_token}",
                "Content-Type": "application/json",
            }

    async def _request_json(
        self,
        method: str,
        url: str,
        *,
        headers: dict[str, str],
        params: dict[str, Any] | None = None,
        json_body: Any | None = None,
    ) -> Any:
        async with httpx.AsyncClient(timeout=self.settings.maxkb_timeout_seconds) as client:
            try:
                response = await client.request(
                    method,
                    url,
                    headers=headers,
                    params=params,
                    json=json_body,
                    follow_redirects=True,
                )
            except httpx.TimeoutException as exc:
                raise MaxKBError("MaxKB 请求超时，请稍后重试。", status_code=504) from exc
            except httpx.HTTPError as exc:
                raise MaxKBError("无法连接到 MaxKB 服务，请检查地址与网络。") from exc

        try:
            payload = response.json()
        except ValueError as exc:
            raise MaxKBError("MaxKB 返回了无法解析的内容。") from exc

        if response.status_code >= 400:
            message = payload.get("message") if isinstance(payload, dict) else None
            raise MaxKBError(message or "MaxKB 请求失败。", status_code=response.status_code)

        if isinstance(payload, dict):
            if payload.get("code") not in (None, 200):
                raise MaxKBError(payload.get("message") or "MaxKB 请求失败。", status_code=502)
            if "data" in payload:
                return payload.get("data")

        return payload

    async def _request_admin_json(
        self,
        method: str,
        url: str,
        *,
        params: dict[str, Any] | None = None,
        json_body: Any | None = None,
    ) -> Any:
        headers = await self._get_admin_headers()
        try:
            return await self._request_json(method, url, headers=headers, params=params, json_body=json_body)
        except MaxKBError as exc:
            if self.settings.maxkb_system_api_key or exc.status_code not in (401, 403):
                raise
        headers = await self._get_admin_headers(refresh=True)
        return await self._request_json(method, url, headers=headers, params=params, json_body=json_body)

    async def search_knowledge_paragraphs(
        self,
        knowledge_id: str,
        query: str,
        *,
        top_k: int = 8,
        similarity: float = 0.3,
    ) -> list[dict[str, Any]]:
        """按 query 在指定知识库做 hit_test，返回相似度排序后的段落。"""
        query_text = (query or "").strip()
        if not query_text or not knowledge_id:
            return []

        workspace_id = self.settings.maxkb_workspace_id
        url = (
            f"{self.settings.maxkb_admin_api_url}/workspace/{workspace_id}/knowledge/"
            f"{knowledge_id}/hit_test"
        )
        body = {
            "query_text": query_text,
            "top_number": max(top_k * 2, 6),
            "similarity": float(similarity),
            "search_mode": "blend",
        }
        try:
            # MaxKB 这一版本的 hit_test 只接受 PUT；POST 会被拒成 500/方法不允许
            data = await self._request_admin_json("PUT", url, json_body=body)
        except MaxKBError as exc:
            logger.warning("hit_test failed for kb=%s: %s", knowledge_id, exc.message)
            raise
        if not isinstance(data, list):
            return []

        def score(paragraph: dict[str, Any]) -> float:
            try:
                return float(
                    paragraph.get("similarity")
                    or paragraph.get("comprehensive_score")
                    or 0.0
                )
            except (TypeError, ValueError):
                return 0.0

        data.sort(key=score, reverse=True)
        return data[:top_k]
