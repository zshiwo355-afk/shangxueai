"""试卷判分 helper：覆盖 single / multiple / judge / blank / short_answer。

设计上向后兼容 magic_academy_api 的 _parse_answer / _score_answer 行为，但解耦自 ORM —
score_question() 只接收纯数据，便于在导入预览、提交判分两处复用。
"""
from __future__ import annotations

import json
from typing import Any

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
