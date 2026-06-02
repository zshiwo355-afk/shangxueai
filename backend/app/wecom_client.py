from __future__ import annotations

import asyncio
import time
from typing import Any

import httpx

from .config import get_settings
from .wecom_support import get_wecom_userid


class WecomApiError(RuntimeError):
    def __init__(self, message: str, *, errcode: int | None = None) -> None:
        super().__init__(message)
        self.errcode = errcode


class WecomPartialFailure(WecomApiError):
    """企微 send 接口返回 invaliduser/unlicenseduser 等部分失败的情况。

    携带具体哪些 userid 失败，便于上层将"未送达者标 failed、其他人标 sent"，
    避免一刀切把整批日志全部置为 failed。
    """

    def __init__(self, message: str, *, failed_userids: set[str], detail: dict[str, str]) -> None:
        super().__init__(message)
        self.failed_userids = {item.strip() for item in failed_userids if item and item.strip()}
        self.detail = detail


class WecomClient:
    _token_lock = asyncio.Lock()
    _token_cache: dict[str, tuple[str, float]] = {}
    _dept_cache: tuple[list[dict[str, Any]], dict[int, str], float] | None = None
    _dept_lock = asyncio.Lock()
    _dept_cache_ttl_seconds = 300.0
    _http_client: httpx.AsyncClient | None = None
    _http_lock = asyncio.Lock()

    def __init__(self) -> None:
        self.settings = get_settings()

    def ensure_app_ready(self) -> None:
        if not self.settings.wecom_push_ready:
            raise WecomApiError("企业微信推送未启用或应用配置不完整。")

    def ensure_contact_ready(self) -> None:
        if not self.settings.wecom_sync_ready:
            raise WecomApiError("企业微信通讯录同步未启用或通讯录配置不完整。")

    def ensure_ready(self) -> None:
        if not self.settings.wecom_ready:
            raise WecomApiError("企业微信配置未完成。")

    @classmethod
    async def _get_http_client(cls) -> httpx.AsyncClient:
        if cls._http_client is not None and not cls._http_client.is_closed:
            return cls._http_client
        async with cls._http_lock:
            if cls._http_client is None or cls._http_client.is_closed:
                cls._http_client = httpx.AsyncClient(
                    timeout=httpx.Timeout(30.0, connect=10.0),
                    limits=httpx.Limits(max_connections=50, max_keepalive_connections=20),
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
        method: str,
        url: str,
        *,
        params: dict[str, Any] | None = None,
        json_body: dict[str, Any] | None = None,
        timeout: int | None = None,
    ) -> dict[str, Any]:
        request_timeout = timeout or self.settings.wecom_request_timeout_seconds
        client = await self._get_http_client()
        response = await client.request(
            method,
            url,
            params=params,
            json=json_body,
            timeout=request_timeout,
        )
        response.raise_for_status()
        data = response.json()
        errcode = int(data.get("errcode", 0) or 0)
        if errcode != 0:
            errmsg = str(data.get("errmsg") or "企业微信接口调用失败。").strip()
            raise WecomApiError(f"{errmsg} (errcode={errcode})", errcode=errcode)
        return data

    async def _get_access_token(self, cache_key: str, secret: str, *, require_contact: bool) -> str:
        if require_contact:
            self.ensure_contact_ready()
        else:
            self.ensure_app_ready()
        now = time.time()
        cached = self._token_cache.get(cache_key)
        if cached and cached[1] > now:
            return cached[0]
        async with self._token_lock:
            cached = self._token_cache.get(cache_key)
            if cached and cached[1] > time.time():
                return cached[0]
            data = await self._request_json(
                "GET",
                "https://qyapi.weixin.qq.com/cgi-bin/gettoken",
                params={
                    "corpid": self.settings.wecom_corp_id,
                    "corpsecret": secret,
                },
            )
            token = str(data.get("access_token") or "").strip()
            if not token:
                raise WecomApiError("企业微信 access_token 为空。")
            ttl = max(60, min(int(data.get("expires_in", 7200) or 7200), self.settings.wecom_token_cache_seconds))
            self._token_cache[cache_key] = (token, time.time() + ttl - 30)
            return token

    async def get_app_access_token(self) -> str:
        return await self._get_access_token("app", self.settings.wecom_app_secret, require_contact=False)

    async def get_contact_access_token(self) -> str:
        return await self._get_access_token("contact", self.settings.wecom_contact_secret, require_contact=True)

    async def get_userinfo_by_code(self, code: str) -> dict[str, Any]:
        token = await self.get_app_access_token()
        return await self._request_json(
            "GET",
            "https://qyapi.weixin.qq.com/cgi-bin/user/getuserinfo",
            params={"access_token": token, "code": code},
        )

    async def get_member(self, userid: str) -> dict[str, Any]:
        token = await self.get_contact_access_token()
        return await self._request_json(
            "GET",
            "https://qyapi.weixin.qq.com/cgi-bin/user/get",
            params={"access_token": token, "userid": userid},
        )

    async def list_departments(self, *, use_cache: bool = False) -> list[dict[str, Any]]:
        if use_cache:
            cached = self._dept_cache
            if cached and cached[2] > time.time():
                return cached[0]
            async with self._dept_lock:
                cached = self._dept_cache
                if cached and cached[2] > time.time():
                    return cached[0]
                rows, name_map = await self._fetch_departments()
                type(self)._dept_cache = (rows, name_map, time.time() + self._dept_cache_ttl_seconds)
                return rows
        rows, _ = await self._fetch_departments()
        return rows

    async def get_department_name_map(self, *, use_cache: bool = True) -> dict[int, str]:
        if use_cache:
            cached = self._dept_cache
            if cached and cached[2] > time.time():
                return cached[1]
            async with self._dept_lock:
                cached = self._dept_cache
                if cached and cached[2] > time.time():
                    return cached[1]
                rows, name_map = await self._fetch_departments()
                type(self)._dept_cache = (rows, name_map, time.time() + self._dept_cache_ttl_seconds)
                return name_map
        _, name_map = await self._fetch_departments()
        return name_map

    async def _fetch_departments(self) -> tuple[list[dict[str, Any]], dict[int, str]]:
        token = await self.get_contact_access_token()
        data = await self._request_json(
            "GET",
            "https://qyapi.weixin.qq.com/cgi-bin/department/list",
            params={"access_token": token},
        )
        departments = data.get("department") or []
        rows = departments if isinstance(departments, list) else []
        name_map: dict[int, str] = {}
        for item in rows:
            raw_id = str(item.get("id", ""))
            if raw_id.isdigit():
                name_map[int(raw_id)] = str(item.get("name") or "").strip()
        return rows, name_map

    async def list_users(self, department_id: int, *, fetch_child: bool = True) -> list[dict[str, Any]]:
        token = await self.get_contact_access_token()
        data = await self._request_json(
            "GET",
            "https://qyapi.weixin.qq.com/cgi-bin/user/list",
            params={
                "access_token": token,
                "department_id": department_id,
                "fetch_child": 1 if fetch_child else 0,
            },
        )
        users = data.get("userlist") or []
        return users if isinstance(users, list) else []

    async def fetch_all_members(self) -> tuple[list[dict[str, Any]], dict[int, str]]:
        departments = await self.list_departments(use_cache=False)
        department_name_map: dict[int, str] = {}
        root_department_ids: list[int] = []
        for item in departments:
            if not str(item.get("id", "")).isdigit():
                continue
            dept_id = int(item["id"])
            department_name_map[dept_id] = str(item.get("name") or "").strip()
            parent_id = int(item.get("parentid", 0) or 0)
            if parent_id == 0:
                root_department_ids.append(dept_id)
        if not root_department_ids:
            root_department_ids = [1]
        members: dict[str, dict[str, Any]] = {}
        for dept_id in sorted(set(root_department_ids)):
            for item in await self.list_users(dept_id, fetch_child=True):
                userid = get_wecom_userid(item)
                if userid:
                    members[userid] = item
        # 顺手刷新部门缓存
        type(self)._dept_cache = (
            departments,
            department_name_map,
            time.time() + self._dept_cache_ttl_seconds,
        )
        return list(members.values()), department_name_map

    async def send_app_message(
        self,
        *,
        touser: list[str],
        title: str,
        description: str,
        url: str = "",
        button_text: str = "查看详情",
    ) -> dict[str, Any]:
        clean_touser = [item.strip() for item in touser if item and item.strip()]
        if not clean_touser:
            raise WecomApiError("没有可发送的企业微信接收人。")
        token = await self.get_app_access_token()
        payload: dict[str, Any] = {
            "touser": "|".join(clean_touser),
            "agentid": self.settings.wecom_agent_id,
            "safe": 0,
            "enable_duplicate_check": 1,
            "duplicate_check_interval": 1800,
        }
        if url:
            payload.update(
                {
                    "msgtype": "textcard",
                    "textcard": {
                        "title": title,
                        "description": description,
                        "url": url,
                        "btntxt": button_text,
                    },
                }
            )
        else:
            payload.update(
                {
                    "msgtype": "text",
                    "text": {"content": f"{title}\n{description}"},
                }
            )
        result = await self._request_json(
            "POST",
            "https://qyapi.weixin.qq.com/cgi-bin/message/send",
            params={"access_token": token},
            json_body=payload,
            timeout=max(15, self.settings.wecom_request_timeout_seconds),
        )
        partial_failures: dict[str, str] = {
            key: str(result.get(key) or "").strip()
            for key in ("invaliduser", "invalidparty", "invalidtag", "unlicenseduser")
            if str(result.get(key) or "").strip()
        }
        if partial_failures:
            failed_userids: set[str] = set()
            for key in ("invaliduser", "unlicenseduser"):
                raw = partial_failures.get(key) or ""
                for piece in raw.replace(",", "|").split("|"):
                    item = piece.strip()
                    if item:
                        failed_userids.add(item)
            details = "; ".join(f"{key}={value}" for key, value in partial_failures.items())
            raise WecomPartialFailure(
                f"企业微信消息存在未送达接收人：{details}",
                failed_userids=failed_userids,
                detail=partial_failures,
            )
        return result
