"""训练流程接口（V2）：start / chat / finish / reset。

- 鉴权：所有接口都要登录用户
- 持久化：session 落 DB（training_sessions 表），训练完成后 review 落 training_records
- 仅处理 mode='training'；考试模式由 exams_api 单独处理
- 业务规则全部从 MaxKB 拉，prompt 编排在 chat_pipeline 模块
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from . import session_store
from .auth import get_current_user
from .chat_pipeline import (
    run_chat_pipeline,
    run_finish_pipeline,
    run_start_pipeline,
)
from .config import Settings
from .db import get_db
from .llm_errors import LLMError
from .maxkb import MaxKBError
from .models import TrainingRecord, User
from .rule_loader import RuleLoader
from .scenarios import random_scenario_seed
from .schemas import (
    ChatTurn,
    OkResponse,
    ResetRequest,
    StateView,
    TrainingChatRequest,
    TrainingChatResponse,
    TrainingFinishRequest,
    TrainingFinishResponse,
    TrainingStartRequest,
    TrainingStartResponse,
)
from .state_machine import build_state_view

logger = logging.getLogger(__name__)


def build_router(
    *,
    settings: Settings,
    rule_loader: RuleLoader,
) -> APIRouter:
    router = APIRouter(prefix="/api/training", tags=["training"])

    def _state_view(session) -> StateView:
        return StateView(**build_state_view(session, settings))

    # ---------- /api/training/start ----------

    @router.post("/start", response_model=TrainingStartResponse)
    async def start_training(
        payload: TrainingStartRequest,
        db: AsyncSession = Depends(get_db),
        user: User = Depends(get_current_user),
    ) -> TrainingStartResponse:
        try:
            visible_brief, hidden_pack, first_msg = await run_start_pipeline(
                rule_loader,
                settings,
                training_type=payload.training_type,
                difficulty=payload.difficulty,
                customer_type=payload.customer_type,
                variety_hints=random_scenario_seed(),
            )
        except MaxKBError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc
        except LLMError as exc:
            logger.exception("training/start LLM failed")
            raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc

        session = await session_store.create_session(
            db,
            user_id=user.id,
            mode="training",
            training_type=payload.training_type,
            difficulty=payload.difficulty,
            customer_type=payload.customer_type,
        )
        session.visible_brief = visible_brief
        session.hidden_training_pack = hidden_pack
        session.first_customer_message = first_msg
        session.chat_history.append(
            ChatTurn(round=0, role="customer", content=first_msg, stage="opening")
        )
        await session_store.save_session(db, session)

        return TrainingStartResponse(
            session_id=session.session_id,
            visible_brief=visible_brief,
            first_customer_message=first_msg,
            state=_state_view(session),
        )

    # ---------- /api/training/chat ----------

    @router.post("/chat", response_model=TrainingChatResponse)
    async def chat(
        payload: TrainingChatRequest,
        db: AsyncSession = Depends(get_db),
        user: User = Depends(get_current_user),
    ) -> TrainingChatResponse:
        await session_store.assert_owner(db, payload.session_id, user.id)
        session = await session_store.get_session(db, payload.session_id)
        if session.is_finished:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="本次训练已结束。")

        # 写入 trainee 消息
        next_round = session.round_count + 1
        session.chat_history.append(
            ChatTurn(
                round=next_round,
                role="trainee",
                content=payload.message.strip(),
                stage=session.current_stage,
            )
        )

        try:
            customer_reply = await run_chat_pipeline(
                rule_loader,
                settings,
                session=session,
                trainee_message=payload.message.strip(),
            )
        except MaxKBError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc
        except LLMError as exc:
            logger.exception("training/chat LLM failed")
            raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc

        await session_store.save_session(db, session)
        return TrainingChatResponse(
            customer_reply=customer_reply,
            state=_state_view(session),
        )

    # ---------- /api/training/finish ----------

    @router.post("/finish", response_model=TrainingFinishResponse)
    async def finish_training(
        payload: TrainingFinishRequest,
        db: AsyncSession = Depends(get_db),
        user: User = Depends(get_current_user),
    ) -> TrainingFinishResponse:
        # 仅训练模式走这里；exam 模式走 /api/exams/{id}/finish
        owner_id, mode, _attempt_id = await session_store.get_session_owner(db, payload.session_id)
        if owner_id != user.id:
            raise HTTPException(status_code=403, detail="无权访问该 session。")
        if mode != "training":
            raise HTTPException(status_code=400, detail="该 session 不是训练模式，请走考试结束接口。")

        session = await session_store.get_session(db, payload.session_id)

        try:
            normalized = await run_finish_pipeline(rule_loader, settings, session=session)
        except MaxKBError as exc:
            logger.exception("finish: rule_loader failed")
            raise HTTPException(status_code=exc.status_code, detail=f"加载复盘规则失败：{exc.message}") from exc
        except LLMError as exc:
            logger.exception("finish: call_llm_json failed")
            raise HTTPException(status_code=exc.status_code, detail=f"复盘生成失败：{exc.message}") from exc
        except Exception as exc:
            logger.exception("finish: unexpected error")
            raise HTTPException(
                status_code=500, detail=f"复盘生成异常：{type(exc).__name__}: {exc}"
            ) from exc

        # 落 training_records（V2.1：保留完整对话历史 + 复盘）
        chat_history_payload = [t.model_dump() for t in session.chat_history]
        record = TrainingRecord(
            user_id=user.id,
            training_type=session.training_type,
            difficulty=session.difficulty,
            customer_type=session.customer_type,
            score=float(normalized.get("score") or 0),
            is_pass=bool(normalized.get("is_pass")),
            result=str(normalized.get("result") or ""),
            review_json=json.dumps(normalized, ensure_ascii=False),
            chat_history_json=json.dumps(chat_history_payload, ensure_ascii=False),
        )
        db.add(record)
        await db.flush()
        await db.refresh(record)

        # 删除 session 行（V2 不保留对话历史）
        await session_store.delete_session(db, payload.session_id)

        # 显式 commit：避免下方 response_model 校验万一失败时被 get_db 的 rollback
        # 一并把刚插入的复盘行抹掉。提交后 record 一定落盘。
        await db.commit()

        try:
            resp = TrainingFinishResponse(**normalized)
        except Exception as exc:
            logger.exception("finish: response_model build failed; normalized=%r", normalized)
            raise HTTPException(
                status_code=500,
                detail=f"复盘响应构造失败：{type(exc).__name__}: {exc}",
            ) from exc

        logger.info(
            "training/finish ok user=%s record_id=%s score=%s result=%s",
            user.id, record.id, normalized.get("score"), normalized.get("result"),
        )
        return resp

    # ---------- /api/training/reset ----------

    @router.post("/reset", response_model=OkResponse)
    async def reset_training(
        payload: ResetRequest,
        db: AsyncSession = Depends(get_db),
        user: User = Depends(get_current_user),
    ) -> OkResponse:
        await session_store.assert_owner(db, payload.session_id, user.id)
        await session_store.reset_session(db, payload.session_id)
        return OkResponse(success=True)

    return router
