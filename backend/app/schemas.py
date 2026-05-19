"""Pydantic schemas: 接口请求 / 响应 + Session 内部数据结构。

字段对齐 02_后端接口设计.md 与 03_后端状态机与数据结构.md。
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


# -------- 训练类型枚举 --------

TrainingType = Literal["初购转化", "复购转化", "全链路成交"]
Difficulty = Literal["简单", "中等", "困难"]
CustomerType = Literal[
    "随机", "送礼客户", "商务接待客户", "自饮客户", "企业客户", "价格敏感客户"
]


# -------- 内部状态结构 --------


class EmotionState(BaseModel):
    trust: int = 50
    interest: int = 50
    impatience: int = 20
    price_resistance: int = 50
    deal_willingness: int = 30


class CompletedActions(BaseModel):
    asked_use_scene: bool = False
    asked_budget: bool = False
    built_brand_trust: bool = False
    recommended_product: bool = False
    handled_objection: bool = False
    attempted_close: bool = False
    confirmed_order: bool = False


class ChatTurn(BaseModel):
    round: int
    role: Literal["customer", "trainee"]
    content: str
    stage: str | None = None


class ScoreTrace(BaseModel):
    round: int
    round_score: float = 0
    hit_points: list[str] = Field(default_factory=list)
    missed_points: list[str] = Field(default_factory=list)
    risk_points: list[str] = Field(default_factory=list)
    emotion_delta: dict[str, float] = Field(default_factory=dict)
    completed_actions_delta: dict[str, bool] = Field(default_factory=dict)
    next_customer_strategy: str = ""


class VisibleBrief(BaseModel):
    """前端可见的训练简报。绝不能掺入 hidden_training_pack 的字段。"""
    training_title: str = ""
    training_type: str = ""
    difficulty: str = ""
    exam_scope: list[str] = Field(default_factory=list)
    min_rounds: int = 10
    trainee_notice: str = ""


class StateView(BaseModel):
    round_count: int
    min_rounds: int
    current_stage: str
    emotion_label: str
    can_finish: bool


class SessionState(BaseModel):
    """完整的 session 状态。绝不直接返回前端，前端只看 StateView + VisibleBrief。"""
    session_id: str
    created_at: datetime
    training_type: str
    difficulty: str
    customer_type: str
    visible_brief: VisibleBrief = Field(default_factory=VisibleBrief)
    hidden_training_pack: dict[str, Any] = Field(default_factory=dict)
    round_count: int = 0
    current_stage: str = "opening"
    chat_history: list[ChatTurn] = Field(default_factory=list)
    score_trace: list[ScoreTrace] = Field(default_factory=list)
    emotion_state: EmotionState = Field(default_factory=EmotionState)
    completed_actions: CompletedActions = Field(default_factory=CompletedActions)
    is_finished: bool = False
    first_customer_message: str = ""


# -------- 接口 DTO --------


class TrainingStartRequest(BaseModel):
    training_type: TrainingType
    difficulty: Difficulty
    customer_type: CustomerType


class TrainingStartResponse(BaseModel):
    session_id: str
    visible_brief: VisibleBrief
    first_customer_message: str
    state: StateView


class TrainingChatRequest(BaseModel):
    session_id: str
    message: str = Field(..., min_length=1, max_length=4000)


class TrainingChatResponse(BaseModel):
    customer_reply: str
    state: StateView


class TrainingFinishRequest(BaseModel):
    session_id: str


class TrainingFinishResponse(BaseModel):
    """复盘响应。

    类型故意放松：LLM 返回的字段不一定干净（dimension_scores 可能给字符串、
    suggested_better_replies 可能是 str 数组等）。如果 schema 卡得太严，pydantic
    在 response_model 校验阶段会抛 ValidationError，进而触发 get_db 的 rollback，
    把刚刚插入 training_records 的复盘行也一并回滚 —— 用户看到的就是
    "复盘没出来 + 历史记录也没有"。这里全部用 Any，保留一手数据原样回前端。
    """
    result: str = "未成交"
    score: float = 0
    is_pass: bool = False
    dimension_scores: dict[str, Any] = Field(default_factory=dict)
    customer_pain_points: list[Any] = Field(default_factory=list)
    strengths: list[Any] = Field(default_factory=list)
    weaknesses: list[Any] = Field(default_factory=list)
    key_turning_points: list[Any] = Field(default_factory=list)
    deal_reason: str = ""
    lost_reason: str = ""
    compliance_risks: list[Any] = Field(default_factory=list)
    next_training_focus: list[Any] = Field(default_factory=list)
    suggested_better_replies: list[Any] = Field(default_factory=list)


class ResetRequest(BaseModel):
    session_id: str


class OkResponse(BaseModel):
    success: bool = True


class ReloadRulesResponse(BaseModel):
    success: bool = True
    loaded_rule_count: int = 0
