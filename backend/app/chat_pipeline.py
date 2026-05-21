"""LLM orchestration shared by training and exam flows."""
from __future__ import annotations

import json
import logging
from typing import Any

from .config import Settings
from .llm import build_kb_rag_block, call_llm_json
from .rule_loader import KNOWLEDGE_RULES_BY_TRAINING, RuleLoader
from .scenarios import format_scenario_block
from .schemas import ChatTurn, SessionState, VisibleBrief
from .state_machine import apply_round_update, enforce_finish_constraints

logger = logging.getLogger(__name__)


ATTACHMENT_VIRTUAL_NOTICE = (
    "## 系统级规则：附件视为已发送（不可违背）\n"
    "本陪练系统当前不提供真实的文件、图片、链接发送能力。\n"
    "当 trainee 的回复中包含口头承诺发送某类资料的措辞时，必须认为 trainee 已经成功发送了对应内容。\n"
    "触发关键词示例包括但不限于：我这就发您、我发你看下、稍等我把图/视频发过去、"
    "链接发您看一下、资料我发到您微信、价格表/产品图/宣传册我马上发、让我发您一份。\n"
    "也接受显式标记，例如 [发送 产品图]、[发送 价格表]、[发送 链接]、[发送 视频]。\n"
    "落实方式：\n"
    "1. 客户在下一句回复时应假定已收到，先自然反馈，再继续推进对话；\n"
    "2. 评分时不得以 trainee 没真发资料为理由扣分；completed_actions 按口头交付计算；\n"
    "3. 复盘时不得把未发送实体附件列为不足或合规风险。\n"
    "这条规则优先级高于知识库里的任何 prompt 或 rule。"
)


def compose_system_prompt(rule_texts: dict[str, str], extra: str = "") -> str:
    parts: list[str] = [ATTACHMENT_VIRTUAL_NOTICE]
    for rule_id, text in rule_texts.items():
        if text:
            parts.append(f"## 规则 {rule_id}\n{text}")
    if extra:
        parts.append(extra)
    return "\n\n".join(parts).strip()


def serialize_chat_history(turns: list[ChatTurn]) -> list[dict[str, Any]]:
    return [
        {"round": turn.round, "role": turn.role, "content": turn.content, "stage": turn.stage or ""}
        for turn in turns
    ]


async def run_start_pipeline(
    rule_loader: RuleLoader,
    settings: Settings,
    *,
    training_type: str,
    difficulty: str,
    customer_type: str,
    variety_hints: dict | None = None,
) -> tuple[VisibleBrief, dict[str, Any], str]:
    rule_texts = await rule_loader.get_many(
        [
            "PROMPT_PREPARE_TRAINING_PACK",
            "PROMPT_JSON_OUTPUT_FORMAT",
            "RULE_TRAINING_FLOW",
            "RULE_AI_CUSTOMER_SIMULATION",
            "RULE_CUSTOMER_PROFILE_QUESTION_BANK",
        ]
    )

    knowledge_rules = KNOWLEDGE_RULES_BY_TRAINING.get(
        training_type,
        KNOWLEDGE_RULES_BY_TRAINING["全链路成交"],
    )
    knowledge_query = " ".join([training_type, *knowledge_rules, "销售知识"])
    knowledge_paragraphs = await rule_loader.retrieve_knowledge(knowledge_query)
    document_block = build_kb_rag_block(knowledge_paragraphs)

    system_prompt = compose_system_prompt(
        rule_texts,
        extra=(
            "你是一名酒类销售陪练系统的训练包生成器。\n"
            "请严格按照 PROMPT_PREPARE_TRAINING_PACK 和 PROMPT_JSON_OUTPUT_FORMAT 输出 JSON。"
        ),
    )

    scenario_block = format_scenario_block(variety_hints or {})
    user_prompt = (
        "【训练参数】\n"
        f"- training_type: {training_type}\n"
        f"- difficulty: {difficulty}\n"
        f"- customer_type: {customer_type}\n"
    )
    if scenario_block:
        user_prompt += f"\n{scenario_block}\n"
    user_prompt += (
        "\n请输出严格 JSON，必须包含以下顶层字段：\n"
        '  - "visible_brief": {"training_title","training_type","difficulty","exam_scope":[],"trainee_notice"}\n'
        '  - "hidden_training_pack": {"customer_profile":{}, "budget":..., "deal_conditions":[], "objection_pool":[], "scoring_focus":[]}\n'
        '  - "first_customer_message": "客户开场第一句"\n'
        "不要输出任何 JSON 之外的文字。"
    )

    data = await call_llm_json(
        settings,
        [{"role": "user", "content": user_prompt}],
        system=system_prompt,
        document_block=document_block,
        temperature=0.85,
    )

    visible_raw = data.get("visible_brief") or {}
    if not isinstance(visible_raw, dict):
        visible_raw = {}
    visible_raw.setdefault("training_type", training_type)
    visible_raw.setdefault("difficulty", difficulty)
    visible_raw["min_rounds"] = settings.min_rounds
    try:
        visible_brief = VisibleBrief.model_validate(visible_raw)
    except Exception:
        visible_brief = VisibleBrief(
            training_type=training_type,
            difficulty=difficulty,
            min_rounds=settings.min_rounds,
        )

    hidden_pack = data.get("hidden_training_pack") or {}
    if not isinstance(hidden_pack, dict):
        hidden_pack = {}
    if variety_hints:
        hidden_pack["scenario_seed"] = dict(variety_hints)

    first_message = str(data.get("first_customer_message") or "").strip()
    if not first_message:
        first_message = "你好，我想了解一下你们这款酒。"

    return visible_brief, hidden_pack, first_message


async def run_chat_pipeline(
    rule_loader: RuleLoader,
    settings: Settings,
    *,
    session: SessionState,
    trainee_message: str,
) -> str:
    """Score one turn and generate the next customer reply."""
    scoring_rules = await rule_loader.get_many(
        [
            "PROMPT_ROUND_SCORING",
            "RULE_SCORING_RUBRIC",
            "RULE_EMOTION_UPDATE",
            "RULE_STAGE_MACHINE",
            "PROMPT_JSON_OUTPUT_FORMAT",
            "RULE_COMPLIANCE",
        ]
    )
    customer_rules = await rule_loader.get_many(
        [
            "PROMPT_CUSTOMER_CHAT",
            "RULE_AI_CUSTOMER_SIMULATION",
            "RULE_COMPLIANCE",
        ]
    )

    history_payload = serialize_chat_history(session.chat_history)
    next_round = session.round_count + 1

    scoring_user = (
        "请按 PROMPT_ROUND_SCORING、RULE_SCORING_RUBRIC、RULE_EMOTION_UPDATE、RULE_STAGE_MACHINE "
        "给本轮新人回复打分，并给出情绪、动作增量与建议下一阶段。\n\n"
        f"【训练类型】{session.training_type}\n"
        f"【难度】{session.difficulty}\n"
        f"【客户类型】{session.customer_type}\n"
        f"【当前阶段】{session.current_stage}\n"
        f"【当前轮次】{next_round}\n\n"
        "【隐藏客户画像与训练包】\n"
        f"{json.dumps(session.hidden_training_pack, ensure_ascii=False)}\n\n"
        "【对话历史】\n"
        f"{json.dumps(history_payload, ensure_ascii=False)}\n\n"
        "【当前情绪】\n"
        f"{json.dumps(session.emotion_state.model_dump(), ensure_ascii=False)}\n\n"
        "【已完成动作】\n"
        f"{json.dumps(session.completed_actions.model_dump(), ensure_ascii=False)}\n\n"
        f"【本轮 trainee 回复】{trainee_message}\n\n"
        "请输出严格 JSON：round_score, hit_points[], missed_points[], risk_points[], "
        "emotion_delta{}, completed_actions_delta{}, suggested_next_stage, next_customer_strategy。"
    )

    scoring_data = await call_llm_json(
        settings,
        [{"role": "user", "content": scoring_user}],
        system=compose_system_prompt(scoring_rules),
        temperature=0.2,
    )
    trace = apply_round_update(session, scoring_data)

    customer_user = (
        "请按 PROMPT_CUSTOMER_CHAT 和 RULE_AI_CUSTOMER_SIMULATION 扮演客户输出下一句。"
        "保持隐藏画像不暴露，回复符合当前情绪与阶段。\n\n"
        f"【训练类型】{session.training_type}\n"
        f"【难度】{session.difficulty}\n"
        f"【客户类型】{session.customer_type}\n"
        f"【当前阶段】{session.current_stage}\n"
        f"【当前轮次】{next_round}\n\n"
        "【隐藏画像】\n"
        f"{json.dumps(session.hidden_training_pack, ensure_ascii=False)}\n\n"
        "【对话历史】\n"
        f"{json.dumps(history_payload, ensure_ascii=False)}\n\n"
        "【最新情绪】\n"
        f"{json.dumps(session.emotion_state.model_dump(), ensure_ascii=False)}\n\n"
        "【建议客户策略】\n"
        f"{trace.next_customer_strategy or '按当前情绪与阶段自然回应'}\n\n"
        '请输出严格 JSON：{"customer_reply": "客户的下一句话"}。'
        "customer_reply 必须是单句或两句口语化中文，不要旁白，不要解释。"
    )

    customer_data = await call_llm_json(
        settings,
        [{"role": "user", "content": customer_user}],
        system=compose_system_prompt(customer_rules),
        temperature=0.7,
    )

    customer_reply = str(customer_data.get("customer_reply") or "").strip()
    if not customer_reply:
        customer_reply = "（客户沉默）"

    session.chat_history.append(
        ChatTurn(
            round=next_round,
            role="customer",
            content=customer_reply,
            stage=session.current_stage,
        )
    )
    session.round_count = next_round
    return customer_reply


async def run_finish_pipeline(
    rule_loader: RuleLoader,
    settings: Settings,
    *,
    session: SessionState,
) -> dict[str, Any]:
    """Generate the final review JSON and normalize its structure."""
    review_rules = await rule_loader.get_many(
        [
            "PROMPT_FINAL_REVIEW",
            "RULE_REVIEW_OUTPUT",
            "RULE_DEAL_DECISION",
            "RULE_COMPLIANCE",
            "RULE_SCORING_RUBRIC",
            "PROMPT_JSON_OUTPUT_FORMAT",
        ]
    )

    history_payload = serialize_chat_history(session.chat_history)
    score_trace_payload = [trace.model_dump() for trace in session.score_trace]

    review_user = (
        "请按 PROMPT_FINAL_REVIEW、RULE_REVIEW_OUTPUT、RULE_DEAL_DECISION、RULE_COMPLIANCE "
        "对本次完整训练给出最终复盘。\n"
        "用户可能在任意轮次主动结束，请只基于已经发生的对话内容评分，不要因为轮次少而自动判负。\n\n"
        "【result 可选值】\n"
        '  - "成交"：客户当场明确承诺购买、答应下单、已付定金，或明确要付款方式。\n'
        '  - "意向客户"：客户表达正向意愿但未当场决定，例如回家商量、再考虑一下、先要资料、改天再来等，'
        "且 trainee 已经留下后续跟进钩子。\n"
        '  - "未成交"：客户明确拒绝、毫无兴趣、关键异议无法解决、出现合规风险，'
        "或 trainee 表现明显不合格。\n\n"
        f"【训练类型】{session.training_type}\n"
        f"【难度】{session.difficulty}\n"
        f"【客户类型】{session.customer_type}\n"
        f"【完成轮次】{session.round_count}\n\n"
        "【隐藏画像】\n"
        f"{json.dumps(session.hidden_training_pack, ensure_ascii=False)}\n\n"
        "【对话历史】\n"
        f"{json.dumps(history_payload, ensure_ascii=False)}\n\n"
        "【单轮评分轨迹】\n"
        f"{json.dumps(score_trace_payload, ensure_ascii=False)}\n\n"
        "【最终情绪】\n"
        f"{json.dumps(session.emotion_state.model_dump(), ensure_ascii=False)}\n\n"
        "【已完成动作】\n"
        f"{json.dumps(session.completed_actions.model_dump(), ensure_ascii=False)}\n\n"
        '请输出严格 JSON：result("成交"/"意向客户"/"未成交"), score, is_pass, '
        "dimension_scores{}, customer_pain_points[], strengths[], weaknesses[], "
        "key_turning_points[], deal_reason, lost_reason, compliance_risks[], "
        "next_training_focus[], suggested_better_replies[]。\n"
        "其中 deal_reason 在 result 为成交或意向客户时填写正向原因，"
        "lost_reason 仅在 result 为未成交时填写。"
    )

    review_data = await call_llm_json(
        settings,
        [{"role": "user", "content": review_user}],
        system=compose_system_prompt(review_rules),
        temperature=0.2,
        max_tokens=max(settings.llm_max_output_tokens, 6000),
    )

    normalized = enforce_finish_constraints(review_data, session, settings)
    try:
        normalized["is_pass"] = float(normalized.get("score") or 0) >= 60
    except (TypeError, ValueError):
        normalized["is_pass"] = False
    return normalized
