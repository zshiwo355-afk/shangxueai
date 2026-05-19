"""状态机与硬校验 —— 不依赖 LLM 的纯逻辑。

业务规则在知识库里（由 LLM 执行）；这里只承担：
  1. 把 LLM 返回的评分增量 clamp 到合法区间
  2. finish 阶段做工程级硬校验（< MIN_ROUNDS 强制未成交、合规风险强制未成交、result 白名单）
"""
from __future__ import annotations

from typing import Any

from .config import Settings
from .schemas import (
    CompletedActions,
    EmotionState,
    ScoreTrace,
    SessionState,
)


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
        v = float(value)
    except (TypeError, ValueError):
        return lo
    if v < lo:
        return lo
    if v > hi:
        return hi
    return v


def _emotion_label(state: EmotionState) -> str:
    """简化版情绪标签：用于前端右侧状态栏的一句话展示。"""
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
    """把 LLM 单轮评分输出应用到 session 状态。

    round_payload 期望字段（来自 RULE_SCORING_RUBRIC / PROMPT_ROUND_SCORING）：
      - round_score:int/float
      - hit_points / missed_points / risk_points: list[str]
      - emotion_delta: {trust:+5, interest:+3, ...}（增量）
      - completed_actions_delta: {asked_use_scene:true, ...}
      - suggested_next_stage: str
      - next_customer_strategy: str
    """
    emotion_delta = round_payload.get("emotion_delta") or {}
    actions_delta = round_payload.get("completed_actions_delta") or {}
    suggested_stage = str(round_payload.get("suggested_next_stage") or "").strip() or None

    # ---- 情绪 clamp ----
    e = session.emotion_state
    if isinstance(emotion_delta, dict):
        for key in ("trust", "interest", "impatience", "price_resistance", "deal_willingness"):
            if key in emotion_delta:
                try:
                    delta = float(emotion_delta[key])
                except (TypeError, ValueError):
                    continue
                setattr(e, key, int(_clamp(getattr(e, key) + delta)))

    # ---- 完成动作（只允许从 false -> true，不可回退）----
    a = session.completed_actions
    if isinstance(actions_delta, dict):
        for key in CompletedActions.model_fields.keys():
            if key in actions_delta and bool(actions_delta[key]):
                setattr(a, key, True)

    # ---- 阶段推进 ----
    if suggested_stage and suggested_stage in STAGES and suggested_stage != "finished":
        session.current_stage = suggested_stage

    # ---- 落 score_trace ----
    trace = ScoreTrace(
        round=session.round_count + 1,
        round_score=float(round_payload.get("round_score") or 0),
        hit_points=list(round_payload.get("hit_points") or []),
        missed_points=list(round_payload.get("missed_points") or []),
        risk_points=list(round_payload.get("risk_points") or []),
        emotion_delta={k: float(v) for k, v in (emotion_delta.items() if isinstance(emotion_delta, dict) else []) if isinstance(v, (int, float))},
        completed_actions_delta={k: bool(v) for k, v in (actions_delta.items() if isinstance(actions_delta, dict) else [])},
        next_customer_strategy=str(round_payload.get("next_customer_strategy") or ""),
    )
    session.score_trace.append(trace)
    return trace


def can_deal(session: SessionState, settings: Settings) -> bool:
    """方案 03 第五节硬阈值：作为 finish 兜底安全闸，规则评分仍以知识库为主。"""
    e = session.emotion_state
    a = session.completed_actions
    return (
        session.round_count >= settings.min_rounds
        and e.trust >= 70
        and e.interest >= 65
        and e.deal_willingness >= 65
        and e.price_resistance <= 55
        and a.recommended_product
        and a.handled_objection
        and a.attempted_close
    )


def build_state_view(session: SessionState, settings: Settings) -> dict[str, Any]:
    return {
        "round_count": session.round_count,
        "min_rounds": settings.min_rounds,
        "current_stage": session.current_stage,
        "emotion_label": _emotion_label(session.emotion_state),
        "can_finish": session.round_count >= settings.min_rounds,
    }


def _coerce_score_value(v: Any) -> float:
    """把 LLM 给出的『8/10』『良好』『8.5 分』等乱七八糟的值尽量转成 float。"""
    if v is None:
        return 0.0
    if isinstance(v, (int, float)):
        try:
            return float(v)
        except (TypeError, ValueError):
            return 0.0
    s = str(v).strip()
    if not s:
        return 0.0
    # 处理 "8/10"
    if "/" in s:
        try:
            numer, denom = s.split("/", 1)
            return float(numer.strip())
        except (TypeError, ValueError):
            pass
    # 抽出数字片段
    import re
    m = re.search(r"-?\d+(?:\.\d+)?", s)
    if m:
        try:
            return float(m.group(0))
        except (TypeError, ValueError):
            return 0.0
    return 0.0


def enforce_finish_constraints(
    review_payload: dict[str, Any],
    session: SessionState,
    settings: Settings,
) -> dict[str, Any]:
    """落工程级硬校验，覆写 LLM 的不合法输出。"""
    payload = dict(review_payload)

    result = str(payload.get("result") or "").strip()
    if result not in VALID_RESULTS:
        result = "未成交"

    # < MIN_ROUNDS 强制未成交
    if session.round_count < settings.min_rounds:
        result = "未成交"
        if not payload.get("lost_reason"):
            payload["lost_reason"] = f"未达到最少 {settings.min_rounds} 轮训练要求。"

    # 合规风险存在 → 强制未成交
    risks = payload.get("compliance_risks") or []
    if isinstance(risks, list) and any((str(r).strip() for r in risks)):
        result = "未成交"
        if not payload.get("lost_reason"):
            payload["lost_reason"] = "存在合规风险，禁止成交。"

    payload["result"] = result

    # 类型保护
    payload["score"] = _coerce_score_value(payload.get("score"))
    payload["is_pass"] = bool(payload.get("is_pass"))

    # 列表字段：每项强制成 str / dict（视字段而定）
    str_list_keys = (
        "customer_pain_points", "strengths", "weaknesses",
        "key_turning_points", "compliance_risks", "next_training_focus",
    )
    for key in str_list_keys:
        v = payload.get(key)
        if isinstance(v, list):
            payload[key] = [str(item).strip() for item in v if item not in (None, "")]
        elif v in (None, "", "无"):
            payload[key] = []
        else:
            payload[key] = [str(v).strip()] if str(v).strip() else []

    # suggested_better_replies：尽量变成 list[dict]
    sbr = payload.get("suggested_better_replies")
    if isinstance(sbr, list):
        normalized_sbr: list[dict[str, Any]] = []
        for idx, item in enumerate(sbr, start=1):
            if isinstance(item, dict):
                normalized_sbr.append(item)
            elif isinstance(item, str) and item.strip():
                # LLM 直接给字符串 → 包成 dict
                normalized_sbr.append({"round": idx, "better": item.strip()})
        payload["suggested_better_replies"] = normalized_sbr
    else:
        payload["suggested_better_replies"] = []

    # dimension_scores：值强制成 float
    dim = payload.get("dimension_scores")
    if isinstance(dim, dict):
        payload["dimension_scores"] = {
            str(k): _coerce_score_value(v) for k, v in dim.items()
        }
    else:
        payload["dimension_scores"] = {}

    payload["deal_reason"] = str(payload.get("deal_reason") or "")
    payload["lost_reason"] = str(payload.get("lost_reason") or "")

    return payload
