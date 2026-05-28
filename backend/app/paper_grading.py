"""试卷判分 helper：覆盖 single / multiple / judge / blank / short_answer。

设计上向后兼容 magic_academy_api 的 _parse_answer / _score_answer 行为，但解耦自 ORM —
score_question() 只接收纯数据，便于在导入预览、提交判分两处复用。
"""
from __future__ import annotations

import json
import logging
from typing import Any

from .config import Settings, get_settings
from .llm import call_llm_json
from .llm_errors import LLMError

logger = logging.getLogger("app.paper_grading")

QUESTION_TYPES = ("single", "multiple", "judge", "blank", "short_answer")
SUBJECTIVE_TYPES = {"short_answer"}
OBJECTIVE_TYPES = {"single", "multiple", "judge", "blank"}


def _json_loads(text: str | None, default: Any = None) -> Any:
    if text is None or text == "":
        return default
    try:
        return json.loads(text)
    except (TypeError, ValueError):
        return default


def parse_answer(value: Any) -> list[str]:
    """把任意形态的答案归一成 list[str]。空答案返回 []。"""
    if value is None:
        return []
    if isinstance(value, (list, tuple, set)):
        return [str(item).strip() for item in value if str(item).strip()]
    text = str(value).strip()
    if not text:
        return []
    parsed = _json_loads(text, None)
    if isinstance(parsed, (list, tuple, set)):
        return parse_answer(parsed)
    if isinstance(parsed, str) and parsed != text:
        return parse_answer(parsed)
    if parsed is not None and not isinstance(parsed, str):
        normalized = str(parsed).strip()
        return [normalized] if normalized else []
    if "\n" in text:
        return [item.strip() for item in text.splitlines() if item.strip()]
    if "|" in text:
        return [item.strip() for item in text.split("|") if item.strip()]
    if "," in text or "，" in text:
        normalized = text.replace("，", ",")
        return [item.strip() for item in normalized.split(",") if item.strip()]
    return [text]


def parse_options(value: Any) -> list[str]:
    return parse_answer(value)


def _normalize_set(values: list[str]) -> list[str]:
    return sorted({(v or "").strip().lower() for v in values if (v or "").strip()})


def is_objective(question_type: str) -> bool:
    return (question_type or "").strip().lower() in OBJECTIVE_TYPES


def is_subjective(question_type: str) -> bool:
    return (question_type or "").strip().lower() in SUBJECTIVE_TYPES


def score_question(
    question_type: str,
    correct_answers: list[str],
    user_answer: Any,
    full_score: float,
) -> tuple[bool | None, float | None]:
    """对单题判分。

    返回 (is_correct, auto_score)：
      - 客观题：返回明确 bool / float
      - 简答题：返回 (None, None) — 留待人工评分
    """
    qtype = (question_type or "").strip().lower()
    answer = parse_answer(user_answer)
    correct = parse_answer(correct_answers)
    full = float(full_score or 0)

    if qtype == "short_answer" or qtype == "short":
        return None, None

    if qtype == "multiple":
        ok = bool(answer) and _normalize_set(answer) == _normalize_set(correct)
        return ok, full if ok else 0.0

    if qtype in {"single", "judge"}:
        a = (answer[0] if answer else "").strip().lower()
        c = (correct[0] if correct else "").strip().lower()
        ok = bool(a) and a == c
        return ok, full if ok else 0.0

    if qtype in {"blank", "fill"}:
        if not correct:
            return None, None
        normalized_answer = _normalize_set(answer)
        normalized_correct = _normalize_set(correct)
        ok = bool(normalized_answer) and bool(set(normalized_answer) & set(normalized_correct))
        return ok, full if ok else 0.0

    return False, 0.0


def question_type_label(qtype: str) -> str:
    return {
        "single": "单选",
        "multiple": "多选",
        "judge": "判断",
        "blank": "填空",
        "short_answer": "简答",
    }.get((qtype or "").lower(), qtype or "")


def parse_keywords(value: Any) -> list[str]:
    """题库存的 grading_keywords 可能是 JSON 列表 / 逗号分隔字符串 / 换行分隔字符串。
    统一归一为字符串列表。"""
    if value is None:
        return []
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    text = str(value).strip()
    if not text:
        return []
    try:
        parsed = json.loads(text)
        if isinstance(parsed, list):
            return [str(item).strip() for item in parsed if str(item).strip()]
    except (TypeError, ValueError):
        pass
    if "\n" in text:
        return [item.strip() for item in text.splitlines() if item.strip()]
    if "," in text or "，" in text:
        return [item.strip() for item in text.replace("，", ",").split(",") if item.strip()]
    return [text]


_AI_GRADING_SYSTEM = (
    "你是一名严格但公正的简答题判分助手。"
    "根据题干、参考答案和评分要点，对学员作答进行评分，并简明给出反馈。"
    "评分要点是给你的提示词，可以识别同义、近义、推理类作答；不要拘泥于字面是否完全匹配。"
    "请严格按要求输出 JSON，不要附带任何额外文本。"
)


def _build_ai_grading_prompt(
    *,
    stem: str,
    reference_answer: list[str],
    keywords: list[str],
    user_answer: list[str],
    full_score: float,
) -> str:
    reference_text = "、".join(reference_answer) if reference_answer else "（未提供）"
    keywords_text = "、".join(keywords) if keywords else "（未提供）"
    user_text = "\n".join(user_answer) if user_answer else "（学员未作答）"
    return (
        f"题目：{stem}\n"
        f"满分：{full_score} 分\n"
        f"参考答案：{reference_text}\n"
        f"评分要点（关键词或要素）：{keywords_text}\n"
        f"学员作答：\n{user_text}\n\n"
        "请输出 JSON：\n"
        '{\n'
        '  "score": <0 ~ 满分之间的数字，可以是 0.5 的倍数>,\n'
        '  "matched_keywords": [<命中的关键词字符串>],\n'
        '  "missing_keywords": [<未命中的关键词字符串>],\n'
        '  "comment": "<两三句中文反馈，说明扣分原因或亮点>"\n'
        '}'
    )


async def grade_short_answer_with_ai(
    *,
    stem: str,
    reference_answer: list[str],
    keywords: list[str],
    user_answer: list[str],
    full_score: float,
    settings: Settings | None = None,
) -> tuple[float, str]:
    """对简答题用 LLM 打分。返回 (score, comment_text)。

    失败时抛 LLMError；调用方决定是 fallback 到人工还是其它处理。
    """
    full = float(full_score or 0)
    if full <= 0:
        return 0.0, ""
    settings = settings or get_settings()
    prompt = _build_ai_grading_prompt(
        stem=stem or "",
        reference_answer=reference_answer or [],
        keywords=keywords or [],
        user_answer=user_answer or [],
        full_score=full,
    )
    raw = await call_llm_json(
        settings,
        [{"role": "user", "content": prompt}],
        system=_AI_GRADING_SYSTEM,
        temperature=0.1,
        max_tokens=600,
    )
    raw_score = raw.get("score")
    try:
        score = float(raw_score)
    except (TypeError, ValueError) as exc:
        raise LLMError(f"AI 返回的 score 不是数字：{raw_score!r}", status_code=500) from exc
    score = max(0.0, min(full, score))
    matched = raw.get("matched_keywords") or []
    missing = raw.get("missing_keywords") or []
    base_comment = str(raw.get("comment") or "").strip()
    parts: list[str] = []
    if base_comment:
        parts.append(base_comment)
    if matched:
        parts.append(f"命中要点：{ '、'.join(str(x) for x in matched) }")
    if missing:
        parts.append(f"未命中要点：{ '、'.join(str(x) for x in missing) }")
    return score, "\n".join(parts)
