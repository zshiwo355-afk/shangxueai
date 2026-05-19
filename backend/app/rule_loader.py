"""按 RULE_ID 从 MaxKB 检索规则正文，进程内缓存。

策略对齐 02_项目实现方案/05_MaxKB接入与规则加载方案.md：
  - 用统一查询语 "请从知识库中检索 RULE_ID: {rule_id} 的完整文档..." 走 hit_test
  - 命中段落按相似度排序、拼接 content 返回
  - 缓存命中直返；可手动 reload 全量
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any

from .config import Settings
from .maxkb import MaxKBClient, MaxKBError

logger = logging.getLogger(__name__)


# 方案 05 第三节列出的预热 RULE_ID 清单
KNOWN_RULE_IDS: tuple[str, ...] = (
    "KB_INDEX",
    "SALES_SOP_STANDARD",
    "KNOWLEDGE_FIRST_PURCHASE",
    "KNOWLEDGE_REPURCHASE",
    "KNOWLEDGE_BRAND_PRODUCT_CULTURE",
    "KNOWLEDGE_OBJECTION_HANDLING",
    "RULE_TRAINING_FLOW",
    "RULE_AI_CUSTOMER_SIMULATION",
    "RULE_EMOTION_UPDATE",
    "RULE_STAGE_MACHINE",
    "RULE_DEAL_DECISION",
    "RULE_SCORING_RUBRIC",
    "RULE_REVIEW_OUTPUT",
    "RULE_COMPLIANCE",
    "RULE_CUSTOMER_PROFILE_QUESTION_BANK",
    "PROMPT_PREPARE_TRAINING_PACK",
    "PROMPT_CUSTOMER_CHAT",
    "PROMPT_ROUND_SCORING",
    "PROMPT_FINAL_REVIEW",
    "PROMPT_JSON_OUTPUT_FORMAT",
    "PROMPT_RULE_EXECUTOR",
)

# 各训练类型对应的销售知识 RULE_ID（方案 05 第五节）
KNOWLEDGE_RULES_BY_TRAINING: dict[str, tuple[str, ...]] = {
    "初购转化": (
        "SALES_SOP_STANDARD",
        "KNOWLEDGE_FIRST_PURCHASE",
        "KNOWLEDGE_OBJECTION_HANDLING",
        "KNOWLEDGE_BRAND_PRODUCT_CULTURE",
    ),
    "复购转化": (
        "SALES_SOP_STANDARD",
        "KNOWLEDGE_REPURCHASE",
        "KNOWLEDGE_OBJECTION_HANDLING",
        "KNOWLEDGE_BRAND_PRODUCT_CULTURE",
    ),
    "全链路成交": (
        "SALES_SOP_STANDARD",
        "KNOWLEDGE_FIRST_PURCHASE",
        "KNOWLEDGE_REPURCHASE",
        "KNOWLEDGE_OBJECTION_HANDLING",
        "KNOWLEDGE_BRAND_PRODUCT_CULTURE",
    ),
}


def _build_rule_query(rule_id: str) -> str:
    return (
        f"请从知识库中检索 RULE_ID: {rule_id} 的完整文档。"
        "必须返回该规则的完整内容，尤其是 PROMPT_TEMPLATE 或规则正文。"
        "不要总结，不要改写。"
    )


def _join_paragraphs(paragraphs: list[dict[str, Any]]) -> str:
    parts: list[str] = []
    for paragraph in paragraphs:
        content = str(paragraph.get("content") or paragraph.get("text") or "").strip()
        if content:
            parts.append(content)
    return "\n\n".join(parts).strip()


class RuleLoader:
    def __init__(self, maxkb_client: MaxKBClient, settings: Settings) -> None:
        self.maxkb = maxkb_client
        self.settings = settings
        self._cache: dict[str, str] = {}
        self._lock = asyncio.Lock()

    async def get(self, rule_id: str) -> str:
        rid = (rule_id or "").strip()
        if not rid:
            return ""
        cached = self._cache.get(rid)
        if cached is not None:
            return cached

        kb_id = (self.settings.maxkb_kb_id or "").strip()
        if not kb_id:
            raise MaxKBError("未配置 MAXKB_KB_ID，请在 backend/.env 中填入陪练知识库 ID。", status_code=503)

        try:
            paragraphs = await self.maxkb.search_knowledge_paragraphs(
                kb_id,
                _build_rule_query(rid),
                top_k=self.settings.maxkb_rule_top_k,
                similarity=self.settings.maxkb_rule_similarity,
            )
        except MaxKBError:
            raise

        text = _join_paragraphs(paragraphs)
        if not text:
            logger.warning("rule_loader: %s 在 MaxKB 中没有命中任何段落", rid)
        async with self._lock:
            self._cache[rid] = text
        return text

    async def get_many(self, rule_ids: list[str]) -> dict[str, str]:
        unique = []
        seen: set[str] = set()
        for rid in rule_ids or []:
            r = (rid or "").strip()
            if r and r not in seen:
                seen.add(r)
                unique.append(r)
        if not unique:
            return {}
        results = await asyncio.gather(*(self.get(rid) for rid in unique), return_exceptions=True)
        out: dict[str, str] = {}
        for rid, res in zip(unique, results, strict=False):
            if isinstance(res, Exception):
                logger.warning("rule_loader.get_many: %s 失败：%s", rid, res)
                out[rid] = ""
            else:
                out[rid] = res
        return out

    async def reload_all(self) -> int:
        """清缓存 + 预热全部已知 RULE_ID。返回成功加载的非空规则条数。"""
        async with self._lock:
            self._cache.clear()
        results = await self.get_many(list(KNOWN_RULE_IDS))
        return sum(1 for v in results.values() if v)

    async def retrieve_knowledge(self, query: str) -> list[dict[str, Any]]:
        """按查询从 MaxKB 召回销售知识段落（不缓存，每次实时检索）。"""
        query_text = (query or "").strip()
        kb_id = (self.settings.maxkb_kb_id or "").strip()
        if not query_text or not kb_id:
            return []
        return await self.maxkb.search_knowledge_paragraphs(
            kb_id,
            query_text,
            top_k=self.settings.maxkb_knowledge_top_k,
            similarity=self.settings.maxkb_knowledge_similarity,
        )

    def cached_rule_ids(self) -> list[str]:
        return [rid for rid, text in self._cache.items() if text]
