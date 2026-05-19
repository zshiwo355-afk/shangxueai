"""规则缓存重载接口。"""
from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException

from .maxkb import MaxKBError
from .rule_loader import RuleLoader
from .schemas import ReloadRulesResponse

logger = logging.getLogger(__name__)


def build_router(*, rule_loader: RuleLoader) -> APIRouter:
    router = APIRouter(prefix="/api/rules", tags=["rules"])

    @router.post("/reload", response_model=ReloadRulesResponse)
    async def reload_rules() -> ReloadRulesResponse:
        try:
            count = await rule_loader.reload_all()
        except MaxKBError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc
        return ReloadRulesResponse(success=True, loaded_rule_count=count)

    return router
