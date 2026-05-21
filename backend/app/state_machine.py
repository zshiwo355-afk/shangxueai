"""State machine helpers and finish-time safety constraints."""
from __future__ import annotations

from typing import Any

from .config import Settings
from .schemas import CompletedActions, EmotionState, ScoreTrace, SessionState


STAGES: tuple[str, ...] = (
    "opening",
    "need_probe",
    "brand_trust",
    "product_intro",
    "price_discuss",
    "objection",
    "closing",
    "after_sale",
    "finished",
)

VALID_RESULTS: tuple[str, ...] = ("成交", "意向客户", "未成交")


def _clamp(value: float, lo: float = 0.0, hi: float = 100.0) -> float:
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return lo
    if numeric < lo:
        return lo
    if numeric > hi:
        return hi
    return numeric


def _emotion_label(state: EmotionState) -> str:
    if state.impatience >= 70:
        return "急躁"
    if state.deal_willingness >= 70 and state.trust >= 60:
        return "倾向成交"
    if state.price_resistance >= 70:
        return "抗价"
    if state.interest >= 60:
        return "感兴趣"
    if state.trust < 30:
        return "戒备"
    return "平稳"


def apply_round_update(session: SessionState, round_payload: dict[str, Any]) -> ScoreTrace:
    """Apply one round of scoring feedback to the session state."""
    emotion_delta = round_payload.get("emotion_delta") or {}
    actions_delta = round_payload.get("completed_actions_delta") or {}
    suggested_stage = str(round_payload.get("suggested_next_stage") or "").strip() or None

    emotion = session.emotion_state
    if isinstance(emotion_delta, dict):
        for key in ("trust", "interest", "impatience", "price_resistance", "deal_willingness"):
            if key not in emotion_delta:
                continue
            try:
                delta = float(emotion_delta[key])
            except (TypeError, ValueError):
                continue
            setattr(emotion, key, int(_clamp(getattr(emotion, key) + delta)))

    completed_actions = session.completed_actions
    if isinstance(actions_delta, dict):
        for key in CompletedActions.model_fields.keys():
            if key in actions_delta and bool(actions_delta[key]):
                setattr(completed_actions, key, True)

    if suggested_stage and suggested_stage in STAGES and suggested_stage != "finished":
        session.current_stage = suggested_stage

    trace = ScoreTrace(
        round=session.round_count + 1,
        round_score=float(round_payload.get("round_score") or 0),
        hit_points=list(round_payload.get("hit_points") or []),
        missed_points=list(round_payload.get("missed_points") or []),
        risk_points=list(round_payload.get("risk_points") or []),
        emotion_delta={
            key: float(value)
            for key, value in (
                emotion_delta.items() if isinstance(emotion_delta, dict) else []
            )
            if isinstance(value, (int, float))
        },
        completed_actions_delta={
            key: bool(value)
            for key, value in (
                actions_delta.items() if isinstance(actions_delta, dict) else []
            )
        },
        next_customer_strategy=str(round_payload.get("next_customer_strategy") or ""),
    )
    session.score_trace.append(trace)
    return trace


def can_deal(session: SessionState, settings: Settings) -> bool:
    """A conservative fallback check kept for internal compatibility."""
    del settings
    emotion = session.emotion_state
    completed_actions = session.completed_actions
    return (
        emotion.trust >= 70
        and emotion.interest >= 65
        and emotion.deal_willingness >= 65
        and emotion.price_resistance <= 55
        and completed_actions.recommended_product
        and completed_actions.handled_objection
        and completed_actions.attempted_close
    )


def build_state_view(session: SessionState, settings: Settings) -> dict[str, Any]:
    return {
        "round_count": session.round_count,
        "min_rounds": settings.min_rounds,
        "current_stage": session.current_stage,
        "emotion_label": _emotion_label(session.emotion_state),
        "can_finish": True,
    }


def _coerce_score_value(value: Any) -> float:
    """Best-effort conversion for loosely formatted score values."""
    if value is None:
        return 0.0
    if isinstance(value, (int, float)):
        try:
            return float(value)
        except (TypeError, ValueError):
            return 0.0

    text = str(value).strip()
    if not text:
        return 0.0

    if "/" in text:
        try:
            numerator, _denominator = text.split("/", 1)
            return float(numerator.strip())
        except (TypeError, ValueError):
            pass

    import re

    match = re.search(r"-?\d+(?:\.\d+)?", text)
    if match:
        try:
            return float(match.group(0))
        except (TypeError, ValueError):
            return 0.0
    return 0.0


def enforce_finish_constraints(
    review_payload: dict[str, Any],
    session: SessionState,
    settings: Settings,
) -> dict[str, Any]:
    """Normalize finish payload while preserving free-form early endings."""
    del session
    del settings

    payload = dict(review_payload)

    result = str(payload.get("result") or "").strip()
    if result not in VALID_RESULTS:
        result = "未成交"

    risks = payload.get("compliance_risks") or []
    if isinstance(risks, list) and any(str(item).strip() for item in risks):
        result = "未成交"
        if not payload.get("lost_reason"):
            payload["lost_reason"] = "存在合规风险，禁止成交。"

    payload["result"] = result
    payload["score"] = _coerce_score_value(payload.get("score"))
    payload["is_pass"] = bool(payload.get("is_pass"))

    str_list_keys = (
        "customer_pain_points",
        "strengths",
        "weaknesses",
        "key_turning_points",
        "compliance_risks",
        "next_training_focus",
    )
    for key in str_list_keys:
        raw_value = payload.get(key)
        if isinstance(raw_value, list):
            payload[key] = [str(item).strip() for item in raw_value if item not in (None, "")]
        elif raw_value in (None, "", "无"):
            payload[key] = []
        else:
            text = str(raw_value).strip()
            payload[key] = [text] if text else []

    better_replies = payload.get("suggested_better_replies")
    if isinstance(better_replies, list):
        normalized_replies: list[dict[str, Any]] = []
        for index, item in enumerate(better_replies, start=1):
            if isinstance(item, dict):
                normalized_replies.append(item)
            elif isinstance(item, str) and item.strip():
                normalized_replies.append({"round": index, "better": item.strip()})
        payload["suggested_better_replies"] = normalized_replies
    else:
        payload["suggested_better_replies"] = []

    dimension_scores = payload.get("dimension_scores")
    if isinstance(dimension_scores, dict):
        payload["dimension_scores"] = {
            str(key): _coerce_score_value(value) for key, value in dimension_scores.items()
        }
    else:
        payload["dimension_scores"] = {}

    payload["deal_reason"] = str(payload.get("deal_reason") or "")
    payload["lost_reason"] = str(payload.get("lost_reason") or "")
    return payload
