"""LLM 调用：流式 chat（用于客户回复等可流场景）+ 一次性 JSON（用于训练包/评分/复盘）。

走 OpenAI 兼容协议（默认指向 ofox 网关），单一 provider，不做多模型分派。
"""
from __future__ import annotations

import json
import logging
import re
from typing import AsyncIterator, Iterable

from openai import APIConnectionError, APIError, APIStatusError, AsyncOpenAI, RateLimitError

from .config import Settings
from .llm_errors import LLMError

logger = logging.getLogger(__name__)

__all__ = [
    "LLMError",
    "stream_llm",
    "call_llm_json",
    "build_document_block",
    "build_rag_block",
    "build_kb_rag_block",
]


_client_cache: dict[tuple[str, str, int], AsyncOpenAI] = {}


def _get_client(base_url: str, api_key: str, timeout_seconds: int) -> AsyncOpenAI:
    key = (base_url, api_key, timeout_seconds)
    client = _client_cache.get(key)
    if client is None:
        client = AsyncOpenAI(
            base_url=base_url,
            api_key=api_key or "sk-missing",
            timeout=timeout_seconds,
        )
        _client_cache[key] = client
    return client


def get_client(settings: Settings) -> AsyncOpenAI:
    return _get_client(settings.llm_base_url, settings.llm_api_key, settings.llm_timeout_seconds)


def _normalize_messages(messages: Iterable[dict]) -> list[dict]:
    normalized: list[dict] = []
    for item in messages:
        role = item.get("role") if isinstance(item, dict) else getattr(item, "role", None)
        content = item.get("content") if isinstance(item, dict) else getattr(item, "content", None)
        if role not in ("system", "user", "assistant") or not isinstance(content, str):
            continue
        text = content.strip()
        if not text:
            continue
        normalized.append({"role": role, "content": text})
    return normalized


def _compose_messages(
    messages: Iterable[dict],
    *,
    system: str | None,
    document_block: str | None,
) -> list[dict]:
    normalized = _normalize_messages(messages)
    system_parts: list[str] = []
    if system:
        system_parts.append(system.strip())
    if document_block:
        system_parts.append(document_block.strip())

    injected_system = "\n\n".join(part for part in system_parts if part)

    out: list[dict] = []
    if injected_system:
        out.append({"role": "system", "content": injected_system})
    out.extend(normalized)
    return out


async def stream_llm(
    settings: Settings,
    messages: Iterable[dict],
    *,
    system: str | None = None,
    document_block: str | None = None,
    temperature: float = 0.4,
) -> AsyncIterator[str]:
    if not settings.llm_api_key:
        raise LLMError("未配置 LLM_API_KEY，请检查 backend/.env。", status_code=500)

    final_messages = _compose_messages(messages, system=system, document_block=document_block)
    if not final_messages:
        raise LLMError("消息内容为空。", status_code=400)

    client = get_client(settings)

    try:
        stream = await client.chat.completions.create(
            model=settings.llm_model,
            messages=final_messages,
            stream=True,
            temperature=temperature,
            max_tokens=settings.llm_max_output_tokens,
        )
    except RateLimitError as exc:
        raise LLMError("上游模型接口请求过于频繁，请稍后重试。", status_code=429) from exc
    except APIStatusError as exc:
        raise LLMError(f"模型接口返回异常（{exc.status_code}）。", status_code=502) from exc
    except APIConnectionError as exc:
        raise LLMError("无法连接上游模型接口，请检查网络或 LLM_BASE_URL。", status_code=502) from exc
    except APIError as exc:
        raise LLMError(f"调用模型接口失败：{exc}", status_code=502) from exc

    try:
        async for chunk in stream:
            choices = getattr(chunk, "choices", None) or []
            if not choices:
                continue
            delta = choices[0].delta
            content = getattr(delta, "content", None) if delta else None
            if content:
                yield content
    except (APIError, APIConnectionError, RateLimitError) as exc:
        raise LLMError(f"流式读取失败：{exc}", status_code=502) from exc


_JSON_FENCE_RE = re.compile(r"```(?:json)?\s*(.*?)\s*```", re.DOTALL | re.IGNORECASE)


def _extract_json_from_text(text: str) -> dict:
    """LLM 可能用 ```json ... ``` 包裹，或者前后带说明文字。容错抽出第一段合法 JSON 对象。"""
    cleaned = (text or "").strip()
    if not cleaned:
        raise ValueError("empty")

    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass

    fence = _JSON_FENCE_RE.search(cleaned)
    if fence:
        body = fence.group(1).strip()
        try:
            return json.loads(body)
        except json.JSONDecodeError:
            pass

    # 找第一个 { 到最后一个 } 之间的子串再试一次
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start != -1 and end != -1 and end > start:
        snippet = cleaned[start : end + 1]
        try:
            return json.loads(snippet)
        except json.JSONDecodeError:
            pass

    raise ValueError("not-json")


async def call_llm_json(
    settings: Settings,
    messages: Iterable[dict],
    *,
    system: str | None = None,
    document_block: str | None = None,
    temperature: float = 0.2,
    response_format_json: bool = True,
    max_tokens: int | None = None,
) -> dict:
    """一次性调用 LLM 并强制返回 JSON。失败时容错抽取 → 再失败用强化 prompt 重试一次 → 仍然失败抛 LLMError。

    陪练里训练包生成、单轮评分、最终复盘三处使用。
    """
    if not settings.llm_api_key:
        raise LLMError("未配置 LLM_API_KEY，请检查 backend/.env。", status_code=500)

    final_messages = _compose_messages(messages, system=system, document_block=document_block)
    if not final_messages:
        raise LLMError("消息内容为空。", status_code=400)

    client = get_client(settings)
    effective_max_tokens = int(max_tokens or settings.llm_max_output_tokens)

    create_kwargs: dict = {
        "model": settings.llm_model,
        "messages": final_messages,
        "temperature": temperature,
        "max_tokens": effective_max_tokens,
    }
    if response_format_json:
        create_kwargs["response_format"] = {"type": "json_object"}

    async def _call(kwargs: dict) -> str:
        try:
            response = await client.chat.completions.create(**kwargs)
        except RateLimitError as exc:
            raise LLMError("上游模型接口请求过于频繁，请稍后重试。", status_code=429) from exc
        except APIStatusError as exc:
            # 部分网关不认 response_format 参数 → 退化重试
            if "response_format" in kwargs and exc.status_code in (400, 422):
                kwargs2 = dict(kwargs)
                kwargs2.pop("response_format", None)
                try:
                    response = await client.chat.completions.create(**kwargs2)
                except APIError as inner:
                    raise LLMError(f"模型接口返回异常：{inner}", status_code=502) from inner
            else:
                raise LLMError(f"模型接口返回异常（{exc.status_code}）。", status_code=502) from exc
        except APIConnectionError as exc:
            raise LLMError("无法连接上游模型接口，请检查网络或 LLM_BASE_URL。", status_code=502) from exc
        except APIError as exc:
            raise LLMError(f"调用模型接口失败：{exc}", status_code=502) from exc

        choices = getattr(response, "choices", None) or []
        if not choices:
            raise LLMError("模型未返回有效结果。", status_code=502)
        return choices[0].message.content or ""

    text = await _call(create_kwargs)
    try:
        return _extract_json_from_text(text)
    except ValueError:
        # 第一次失败：把原文打到日志（同时落 stdout 方便用户在终端直接看）
        head = text[:500].replace("\n", " ")
        logger.warning("call_llm_json non-json output, retrying. head=%r", head)
        print(f"[llm.json:retry] non-JSON head: {head}", flush=True)

    # 第二次：明确告诉模型只输出 JSON
    reinforced = list(final_messages)
    reinforced.append({
        "role": "user",
        "content": (
            "你刚才的回复不是合法 JSON。请重新输出，只允许返回一个 JSON 对象，"
            "不要任何前后说明、不要 ```json 代码块标记、不要思考过程。"
            "字段缺失时使用空字符串、空数组或合理默认值。"
        ),
    })
    retry_kwargs = dict(create_kwargs)
    retry_kwargs["messages"] = reinforced
    retry_kwargs["temperature"] = 0
    text2 = await _call(retry_kwargs)
    try:
        return _extract_json_from_text(text2)
    except ValueError as exc:
        head = text2[:500].replace("\n", " ")
        logger.error("call_llm_json final non-json, head=%r", head)
        print(f"[llm.json:final-fail] head: {head}", flush=True)
        raise LLMError(
            f"LLM 两次都没返回合法 JSON。模型原文片段：{head[:200]}",
            status_code=502,
        ) from exc


def build_document_block(document_name: str, document_text: str) -> str:
    return (
        "以下内容来自指定的知识库文档，请优先依据它作答；"
        "如果问题无法从文档中得到答案，请明确说明。\n\n"
        f"[文档：{document_name}]\n{document_text}\n[文档结束]"
    )


def build_rag_block(document_name: str, paragraphs: list[str]) -> str:
    body_parts = [f"片段 {index + 1}：\n{content}" for index, content in enumerate(paragraphs) if content]
    if not body_parts:
        return build_document_block(document_name, "（未检索到相关片段）")
    body = "\n\n".join(body_parts)
    return (
        "以下是从指定知识库文档中检索到的相关片段，请优先依据它们作答；"
        "如果片段不足以回答问题，请明确说明未在文档中找到相关内容。\n\n"
        f"[文档：{document_name}]\n{body}\n[文档结束]"
    )


def build_kb_rag_block(paragraphs: list[dict]) -> str:
    """跨多个文档的命中段落组装成单个 document_block，每段自带来源标注。"""
    if not paragraphs:
        return (
            "以下来自知识库的检索结果：\n\n"
            "（在知识库里没有找到与问题相关的片段）\n\n"
            "请严格基于【已检索到的片段】作答；既然上面提示没有找到相关内容，"
            "请直接告知【没有在知识库里找到相关内容】，不要编造答案。"
        )

    parts: list[str] = []
    for index, paragraph in enumerate(paragraphs, start=1):
        content = str(paragraph.get("content") or paragraph.get("text") or "").strip()
        if not content:
            continue
        doc_name = (
            str(paragraph.get("document_name") or "").strip()
            or str(paragraph.get("title") or "").strip()
            or "未命名文档"
        )
        similarity = paragraph.get("similarity") or paragraph.get("comprehensive_score")
        header = f"片段 {index}（来源：{doc_name}"
        try:
            if similarity is not None:
                header += f"，相似度 {float(similarity):.2f}"
        except (TypeError, ValueError):
            pass
        header += "）："
        parts.append(f"{header}\n{content}")

    if not parts:
        return build_kb_rag_block([])

    body = "\n\n".join(parts)
    return (
        "以下是从知识库里按相似度检索到的相关片段：\n\n"
        f"{body}\n"
        "\n[知识库片段结束]"
    )
