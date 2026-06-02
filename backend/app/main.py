"""FastAPI 入口（V2）：CORS + 路由聚合 + 启动钩子（规则预热） + 前端静态托管。"""
from __future__ import annotations

import asyncio
import logging
import os
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .auth import ensure_builtin_super_admin, router as auth_router
from .config import get_settings
from .db import session_scope
from .employee_open_client import EmployeeOpenClient
from .magic_auto_actions import auto_action_worker
from .exams_api import (
    admin_router as exams_admin_router,
    review_router as exams_review_router,
    build_user_router as build_exams_user_router,
)
from .magic_academy_api import magic_video_router, router as magic_academy_router
from .materials_api import router as materials_router
from .maxkb import MaxKBClient
from .options_api import admin_router as options_admin_router, user_router as options_user_router
from .paper_ai_worker import paper_ai_worker
from .paper_assignments_api import (
    router as paper_assignments_router,
    submit_router as paper_submit_router,
)
from .papers_api import router as papers_router
from .question_bank_api import router as question_bank_router
from .question_imports_api import router as question_imports_router
from .rule_loader import RuleLoader
from .rules_api import build_router as build_rules_router
from .training_api import build_router as build_training_router
from .training_records_api import router as training_records_router, admin_router as training_records_admin_router
from .users_api import router as users_admin_router
from .wecom_client import WecomClient
from .wecom_sync import wecom_daily_sync_worker
from .whitelist_api import router as whitelist_router

logger = logging.getLogger(__name__)

app = FastAPI(title="怀仁商学院", version="2.0.0")

settings = get_settings()
maxkb_client = MaxKBClient(settings)
rule_loader = RuleLoader(maxkb_client, settings)
_auto_action_stop_event = asyncio.Event()
_auto_action_task: asyncio.Task | None = None
_wecom_sync_stop_event = asyncio.Event()
_wecom_sync_task: asyncio.Task | None = None
_paper_ai_stop_event = asyncio.Event()
_paper_ai_task: asyncio.Task | None = None

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
app.include_router(whitelist_router)
app.include_router(magic_academy_router)
app.include_router(magic_video_router)
app.include_router(materials_router)
# 训练
app.include_router(build_training_router(settings=settings, rule_loader=rule_loader))
app.include_router(training_records_router)
app.include_router(training_records_admin_router)
# 考试
app.include_router(exams_admin_router)
app.include_router(exams_review_router)
app.include_router(build_exams_user_router(settings=settings, rule_loader=rule_loader))
# 考试管理（独立卷库式：题库 / 试卷 / 派发 / 导入）
app.include_router(question_bank_router)
app.include_router(papers_router)
app.include_router(paper_assignments_router)
app.include_router(question_imports_router)
app.include_router(paper_submit_router)
# 规则重载
app.include_router(build_rules_router(rule_loader=rule_loader))


@app.on_event("startup")
async def _preload_rules() -> None:
    global _auto_action_task, _wecom_sync_task, _paper_ai_task
    try:
        async with session_scope() as session:
            await ensure_builtin_super_admin(session)
    except Exception as exc:  # noqa: BLE001
        logger.warning("super admin bootstrap failed: %s", exc)
    try:
        count = await rule_loader.reload_all()
        logger.info("rule_loader preloaded %d rules", count)
    except Exception as exc:  # noqa: BLE001
        logger.warning("rule preload failed (will lazy-load on demand): %s", exc)
    if _auto_action_task is None or _auto_action_task.done():
        _auto_action_stop_event.clear()
        _auto_action_task = asyncio.create_task(auto_action_worker(_auto_action_stop_event))
    if _wecom_sync_task is None or _wecom_sync_task.done():
        _wecom_sync_stop_event.clear()
        _wecom_sync_task = asyncio.create_task(wecom_daily_sync_worker(_wecom_sync_stop_event))
    if _paper_ai_task is None or _paper_ai_task.done():
        _paper_ai_stop_event.clear()
        _paper_ai_task = asyncio.create_task(paper_ai_worker(_paper_ai_stop_event))


@app.on_event("shutdown")
async def _stop_auto_action_worker() -> None:
    global _auto_action_task, _wecom_sync_task, _paper_ai_task
    _auto_action_stop_event.set()
    _wecom_sync_stop_event.set()
    _paper_ai_stop_event.set()
    if _auto_action_task is None:
        pass
    else:
        try:
            await _auto_action_task
        except Exception:  # noqa: BLE001
            logger.exception("auto action worker stopped with error")
        finally:
            _auto_action_task = None
    if _wecom_sync_task is None:
        pass
    else:
        try:
            await _wecom_sync_task
        except Exception:  # noqa: BLE001
            logger.exception("WeCom sync worker stopped with error")
        finally:
            _wecom_sync_task = None
    if _paper_ai_task is None:
        pass
    else:
        try:
            await _paper_ai_task
        except Exception:  # noqa: BLE001
            logger.exception("paper AI worker stopped with error")
        finally:
            _paper_ai_task = None
    # 关闭共享 httpx 客户端，避免 "Event loop is closed" 警告与文件描述符泄漏。
    try:
        await WecomClient.aclose()
    except Exception:  # noqa: BLE001
        logger.exception("close shared WeCom http client failed")
    try:
        await EmployeeOpenClient.aclose()
    except Exception:  # noqa: BLE001
        logger.exception("close shared employee sync http client failed")


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


# ---- 静态托管前端构建产物 ----
# 查找顺序：
#   1) 环境变量 FRONTEND_DIST_PATH（绝对路径或相对 backend 目录）
#   2) <project_root>/frontend/dist     （仓库默认结构）
#   3) <backend>/../frontend/dist       （和 #2 等价，保险）
#   4) <backend>/../dist                 （把 dist 直接放在 backend 同级）
#   5) <backend>/dist                    （把 dist 放进 backend）
# 第一个存在 index.html 的就用它。
def _resolve_frontend_dist() -> Path | None:
    backend_dir = Path(__file__).resolve().parents[1]
    project_root = backend_dir.parent
    candidates: list[Path] = []
    env_path = (os.environ.get("FRONTEND_DIST_PATH") or "").strip()
    if env_path:
        env_dir = Path(env_path)
        if not env_dir.is_absolute():
            env_dir = (backend_dir / env_dir).resolve()
        candidates.append(env_dir)
    candidates.extend([
        project_root / "frontend" / "dist",
        backend_dir.parent / "frontend" / "dist",
        backend_dir.parent / "dist",
        backend_dir / "dist",
    ])
    for path in candidates:
        if (path / "index.html").exists():
            logger.info("frontend dist resolved at: %s", path)
            return path
    logger.warning("no frontend dist found in any of: %s", [str(p) for p in candidates])
    return None


frontend_dist = _resolve_frontend_dist()
assets_dir = (frontend_dist / "assets") if frontend_dist else None

if assets_dir and assets_dir.exists():
    app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")


@app.get("/{full_path:path}", response_model=None)
async def frontend(full_path: str):
    normalized = full_path.strip("/")
    if normalized == "api" or normalized.startswith("api/"):
        raise HTTPException(status_code=404, detail=f"API endpoint not found: /{normalized}")

    if frontend_dist:
        index_file = frontend_dist / "index.html"
        if index_file.exists():
            return FileResponse(index_file)
    return {
        "message": "前端尚未构建或目录不对。请确认 frontend/dist/index.html 存在，"
                   "或设置 FRONTEND_DIST_PATH 环境变量指向 dist 目录。",
    }
