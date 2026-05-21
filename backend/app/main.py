"""FastAPI 入口（V2）：CORS + 路由聚合 + 启动钩子（规则预热） + 前端静态托管。"""
from __future__ import annotations

import logging
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .auth import router as auth_router
from .config import get_settings
from .exams_api import (
    admin_router as exams_admin_router,
    review_router as exams_review_router,
    build_user_router as build_exams_user_router,
)
from .magic_academy_api import magic_video_router, router as magic_academy_router
from .maxkb import MaxKBClient
from .options_api import admin_router as options_admin_router, user_router as options_user_router
from .rule_loader import RuleLoader
from .rules_api import build_router as build_rules_router
from .training_api import build_router as build_training_router
from .training_records_api import router as training_records_router
from .users_api import router as users_admin_router

logger = logging.getLogger(__name__)

app = FastAPI(title="商学院AI培训", version="2.0.0")

settings = get_settings()
maxkb_client = MaxKBClient(settings)
rule_loader = RuleLoader(maxkb_client, settings)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_origin_regex=settings.allowed_origin_regex or None,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def _no_cache_for_api(request: Request, call_next):
    """所有 /api/* 响应禁用浏览器缓存，避免历史 SPA 回退被磁盘缓存劫持。"""
    response = await call_next(request)
    path = request.url.path or ""
    if path.startswith("/api/") or path == "/api":
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response

# 鉴权
app.include_router(auth_router)
# 选项
app.include_router(options_user_router)
app.include_router(options_admin_router)
# 用户管理（管理员）
app.include_router(users_admin_router)
app.include_router(magic_academy_router)
app.include_router(magic_video_router)
# 训练
app.include_router(build_training_router(settings=settings, rule_loader=rule_loader))
app.include_router(training_records_router)
# 考试
app.include_router(exams_admin_router)
app.include_router(exams_review_router)
app.include_router(build_exams_user_router(settings=settings, rule_loader=rule_loader))
# 规则重载
app.include_router(build_rules_router(rule_loader=rule_loader))


@app.on_event("startup")
async def _preload_rules() -> None:
    try:
        count = await rule_loader.reload_all()
        logger.info("rule_loader preloaded %d rules", count)
    except Exception as exc:  # noqa: BLE001
        logger.warning("rule preload failed (will lazy-load on demand): %s", exc)


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


# ---- 静态托管前端构建产物 ----
frontend_dist = Path(__file__).resolve().parents[2] / "frontend" / "dist"
assets_dir = frontend_dist / "assets"

if assets_dir.exists():
    app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")


@app.get("/{full_path:path}", response_model=None)
async def frontend(full_path: str):
    normalized = full_path.strip("/")
    if normalized == "api" or normalized.startswith("api/"):
        raise HTTPException(status_code=404, detail=f"API endpoint not found: /{normalized}")

    index_file = frontend_dist / "index.html"
    if index_file.exists():
        return FileResponse(index_file)
    return {
        "message": "前端尚未构建，请进入 frontend 目录执行 npm run build，或开发模式 npm run dev。",
    }
