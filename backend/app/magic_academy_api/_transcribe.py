"""录音转文字：接入讯飞「录音文件转写大模型版」LFASR。

协议：https://www.xfyun.cn/doc/spark/asr_llm/Ifasr_llm.html
两步异步：
1. POST /v2/upload      上传音频文件（octet-stream），返回 orderId
2. POST /v2/getResult   轮询状态，status==4 成功，==-1 失败

鉴权：所有 URL 参数按字典序排序、URL 编码、用 & 拼接，对 api_secret 做
HMAC-SHA1，base64 后作为 signature 放在请求头里。
"""
from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import json
import logging
import secrets
import string
import time
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

import httpx

from ..config import get_settings
from ..llm_errors import LLMError

logger = logging.getLogger("app.magic_academy_api.transcribe")

__all__ = ["transcribe_audio"]

XF_BASE_URL = "https://office-api-ist-dx.iflyaisol.com"
XF_UPLOAD_PATH = "/v2/upload"
XF_GET_RESULT_PATH = "/v2/getResult"

# 讯飞 orderInfo.status 取值
_XF_STATUS_PROCESSING = 3
_XF_STATUS_DONE = 4
_XF_STATUS_FAILED = -1

# 讯飞 orderInfo.failType 常见值 → 用户友好中文说明
_XF_FAIL_TYPE_MESSAGES: dict[int, str] = {
    1: "音频解码失败，请检查文件是否完整或使用受支持的格式",
    2: "音频时长超过上限（5 小时）",
    3: "音频文件过大",
    4: "音频采样率不支持（建议 16kHz 或 8kHz）",
    5: "音频声道不支持（需要单声道）",
    6: "未检测到有效语音，请确认音频中是否有可识别的说话内容",
    7: "音频内容过短或静音",
    8: "系统内部错误，请稍后重试",
}


def _xf_datetime(now: datetime | None = None) -> str:
    """返回 ISO-8601 形式：2025-09-08T22:58:29+0800（北京时间，时区无冒号）。"""
    if now is None:
        now = datetime.now(timezone(timedelta(hours=8)))
    return now.strftime("%Y-%m-%dT%H:%M:%S%z")


def _random_alphanum(length: int = 16) -> str:
    charset = string.ascii_letters + string.digits
    return "".join(secrets.choice(charset) for _ in range(length))


def _sign(params: dict[str, object], api_secret: str) -> str:
    """按字典序排序参数后用 form-urlencoded 方式编码（空格编 +，与 httpx 发送的实际
    query 字符串一致），再对整串做 HMAC-SHA1，返回 base64。

    关键坑：quote(safe='') 把空格编成 %20，httpx 发 query 时把空格编成 +，如果不对齐
    会导致服务端签名校验失败（文件名含中文或空格的场景）。
    """
    sorted_pairs = [(str(k), str(params[k])) for k in sorted(params.keys())]
    base_string = urlencode(sorted_pairs)
    digest = hmac.new(
        api_secret.encode("utf-8"),
        base_string.encode("utf-8"),
        hashlib.sha1,
    ).digest()
    return base64.b64encode(digest).decode("ascii")


async def transcribe_audio(content: bytes, *, filename: str, mime_type: str) -> str:
    """把录音字节送到讯飞转写，返回文本。失败抛 LLMError（带 status_code）。

    mime_type 当前讯飞链路不需要（按 octet-stream 上传），保留入参以兼容调用方。
    """
    settings = get_settings()
    if not settings.asr_enabled:
        raise LLMError("录音转写未启用，请在 backend/.env 里设置 ASR_ENABLED=true。", status_code=503)
    if not (settings.xf_appid and settings.xf_api_key and settings.xf_api_secret):
        raise LLMError(
            "未配置讯飞转写凭证（XF_APPID / XF_API_KEY / XF_API_SECRET）。",
            status_code=500,
        )

    size = len(content)
    if size <= 0:
        raise LLMError("录音内容为空，无法转写。", status_code=400)
    if size > settings.asr_max_file_bytes:
        limit_mb = settings.asr_max_file_bytes // (1024 * 1024)
        raise LLMError(
            f"录音超过 {limit_mb}MB 上限，请压缩或截取后再上传。",
            status_code=413,
        )

    safe_name = (filename or "").strip() or "audio.m4a"
    order_id, estimate_seconds = await _xf_upload(
        settings, filename=safe_name, data=content
    )
    logger.info(
        "iFlytek ASR upload ok orderId=%s estimate=%ds size=%d",
        order_id, estimate_seconds, size,
    )
    payload = await _xf_poll(
        settings,
        order_id=order_id,
        initial_wait=estimate_seconds,
    )
    text = _parse_order_result(payload)
    return text or "（音频内未检测到可识别的语音内容）"


async def _xf_upload(settings, *, filename: str, data: bytes) -> tuple[str, int]:
    params: dict[str, object] = {
        "appId": settings.xf_appid,
        "accessKeyId": settings.xf_api_key,
        "dateTime": _xf_datetime(),
        "signatureRandom": _random_alphanum(16),
        "fileSize": str(len(data)),
        "fileName": filename,
        "language": settings.asr_language or "autodialect",
        "roleType": str(settings.asr_role_type or 0),
        # 免去填写 duration（需要音频时长计算，依赖 ffprobe）
        "durationCheckDisable": "true",
    }
    signature = _sign(params, settings.xf_api_secret)

    url = f"{XF_BASE_URL}{XF_UPLOAD_PATH}"
    headers = {
        "Content-Type": "application/octet-stream",
        "signature": signature,
    }

    try:
        async with httpx.AsyncClient(timeout=settings.asr_timeout_seconds) as client:
            resp = await client.post(url, params=params, headers=headers, content=data)
    except httpx.TimeoutException as exc:
        raise LLMError("讯飞转写上传超时，请稍后重试。", status_code=504) from exc
    except httpx.HTTPError as exc:
        raise LLMError(f"无法连接讯飞转写接口：{exc}", status_code=502) from exc

    return _parse_upload_response(resp)


def _parse_upload_response(resp: httpx.Response) -> tuple[str, int]:
    body_text = resp.text[:800]
    if resp.status_code >= 400:
        raise LLMError(
            f"讯飞转写上传失败：HTTP {resp.status_code} {body_text}", status_code=502
        )

    try:
        payload = resp.json()
    except json.JSONDecodeError as exc:
        raise LLMError("讯飞转写上传返回非法 JSON。", status_code=502) from exc

    code = str(payload.get("code") or "")
    if code != "0" and code.lower() != "000000":
        desc = payload.get("descInfo") or payload.get("desc") or payload.get("message") or ""
        raise LLMError(
            f"讯飞转写上传失败 code={code} desc={desc}", status_code=502
        )

    content = payload.get("content") or {}
    order_id = content.get("orderId") or payload.get("orderId")
    if not order_id:
        raise LLMError(
            f"讯飞上传返回无 orderId: {json.dumps(payload, ensure_ascii=False)[:400]}",
            status_code=502,
        )

    estimate_raw = content.get("taskEstimateTime") or payload.get("taskEstimateTime") or 0
    try:
        estimate_ms = int(estimate_raw)
    except (TypeError, ValueError):
        estimate_ms = 0
    # taskEstimateTime 是毫秒；向上转秒，给个最小等待 3 秒。
    estimate_seconds = max(estimate_ms // 1000, 3)
    return str(order_id), estimate_seconds


async def _xf_poll(settings, *, order_id: str, initial_wait: int) -> dict:
    url = f"{XF_BASE_URL}{XF_GET_RESULT_PATH}"
    interval = max(settings.asr_poll_interval_seconds, 1)
    deadline = time.monotonic() + max(settings.asr_poll_max_seconds, 30)

    # 先等待服务端初步处理，再开始轮询。
    await asyncio.sleep(min(initial_wait, max(settings.asr_poll_max_seconds - 1, 1)))

    while time.monotonic() < deadline:
        params: dict[str, object] = {
            "appId": settings.xf_appid,
            "accessKeyId": settings.xf_api_key,
            "dateTime": _xf_datetime(),
            "signatureRandom": _random_alphanum(16),
            "orderId": order_id,
            "resultType": "transfer",
        }
        signature = _sign(params, settings.xf_api_secret)
        headers = {"signature": signature}

        try:
            async with httpx.AsyncClient(timeout=settings.asr_timeout_seconds) as client:
                resp = await client.post(url, params=params, headers=headers)
        except httpx.TimeoutException:
            await asyncio.sleep(interval)
            continue
        except httpx.HTTPError as exc:
            raise LLMError(f"讯飞查询接口连接失败：{exc}", status_code=502) from exc

        body_text = resp.text[:800]
        if resp.status_code >= 400:
            raise LLMError(
                f"讯飞查询失败：HTTP {resp.status_code} {body_text}", status_code=502
            )

        try:
            payload = resp.json()
        except json.JSONDecodeError as exc:
            raise LLMError("讯飞查询返回非法 JSON。", status_code=502) from exc

        code = str(payload.get("code") or "")
        if code != "0" and code.lower() != "000000":
            desc = payload.get("descInfo") or payload.get("desc") or ""
            raise LLMError(
                f"讯飞查询失败 code={code} desc={desc}", status_code=502
            )

        content = payload.get("content") or {}
        order_info = content.get("orderInfo") or {}
        status = order_info.get("status")

        if status == _XF_STATUS_DONE:
            return content
        if status == _XF_STATUS_FAILED:
            fail_type_raw = order_info.get("failType")
            try:
                fail_type = int(fail_type_raw)
            except (TypeError, ValueError):
                fail_type = -999
            friendly = _XF_FAIL_TYPE_MESSAGES.get(fail_type, f"讯飞转写失败（failType={fail_type_raw}）")
            raise LLMError(friendly, status_code=502)
        # status 3 / 0 — 继续轮询
        await asyncio.sleep(interval)

    raise LLMError(
        f"讯飞转写超时（{settings.asr_poll_max_seconds}s 未返回结果）。",
        status_code=504,
    )


def _parse_order_result(content: dict) -> str:
    """讯飞 orderResult 是嵌套 JSON 字符串，逐层解包，按说话人拼成多行文本。"""
    order_result_raw = content.get("orderResult")
    if not order_result_raw:
        return ""

    try:
        order_result = (
            json.loads(order_result_raw)
            if isinstance(order_result_raw, str)
            else order_result_raw
        )
    except json.JSONDecodeError:
        logger.warning("orderResult is not valid JSON: %r", order_result_raw[:200])
        return ""

    # 优先使用 lattice2（带标点整理版），没有就退回 lattice（原始词级）
    lattice = order_result.get("lattice2") or order_result.get("lattice") or []
    if not isinstance(lattice, list):
        return ""

    lines: list[str] = []
    last_speaker: str | None = None

    for entry in lattice:
        if not isinstance(entry, dict):
            continue
        inner_raw = entry.get("json_1best")
        try:
            inner = (
                json.loads(inner_raw) if isinstance(inner_raw, str) else (inner_raw or {})
            )
        except json.JSONDecodeError:
            continue

        st = inner.get("st") or {}
        # 说话人角色
        rl_raw = st.get("rl") or st.get("role") or ""
        rl = str(rl_raw).strip()
        speaker_label: str | None = None
        if rl and rl not in {"0", ""}:
            speaker_label = f"说话人{rl}" if rl.isdigit() else str(rl)

        # 拼接词
        text_parts: list[str] = []
        for rt in st.get("rt") or []:
            if not isinstance(rt, dict):
                continue
            for ws in rt.get("ws") or []:
                if not isinstance(ws, dict):
                    continue
                for cw in ws.get("cw") or []:
                    if not isinstance(cw, dict):
                        continue
                    text_parts.append(str(cw.get("w") or ""))
        segment_text = "".join(text_parts).strip()
        if not segment_text:
            continue

        if speaker_label:
            if speaker_label != last_speaker:
                lines.append(f"{speaker_label}: {segment_text}")
                last_speaker = speaker_label
            else:
                lines[-1] = f"{lines[-1]}{segment_text}"
        else:
            lines.append(segment_text)
            last_speaker = None

    return "\n".join(lines).strip()
