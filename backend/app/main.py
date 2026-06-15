"""FastAPI 入口（V2）：CORS + 路由聚合 + 启动钩子（规则预热） + 前端静态托管。"""
from __future__ import annotations

import asyncio
import html
import json
import logging
import os
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, HTMLResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from starlette.responses import Response as StarletteResponse

from .auth import ensure_builtin_super_admin, router as auth_router
from .banners_api import admin_router as banners_admin_router, user_router as banners_user_router
from .config import get_settings
from .db import session_scope
from .deadline_reminder_worker import deadline_reminder_worker
from .employee_open_client import EmployeeOpenClient
from .magic_auto_actions import auto_action_worker
from .exams_api import (
    admin_router as exams_admin_router,
    review_router as exams_review_router,
    build_user_router as build_exams_user_router,
)
from .magic_academy_api import magic_video_router, router as magic_academy_router
from .live_api import (
    admin_router as live_admin_router,
    get_public_live_meta,
    public_router as live_public_router,
)
from .magic_push_service import reading_push_worker
from .materials_api import router as materials_router
from .maxkb import MaxKBClient
from .notifications_api import router as notifications_router
from .newbie_guide_api import router as newbie_guide_router
from .options_api import admin_router as options_admin_router, user_router as options_user_router
from .paper_ai_worker import paper_ai_worker
from .points_admin_api import router as points_admin_router
from .mentors_admin_api import router as mentors_admin_router
from .mentors_public_api import router as mentors_public_router
from .dashboard_api import router as dashboard_admin_router
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
from .wechat_client import WechatMpClient
from .wecom_client import WecomClient
from .whitelist_api import router as whitelist_router

logger = logging.getLogger(__name__)
WECOM_VERIFY_FILENAME = "WW_verify_gg1rPhoArDoHroVv.txt"
WECOM_VERIFY_CONTENT = "gg1rPhoArDoHroVv"

app = FastAPI(title="怀仁商学院", version="2.0.0")

settings = get_settings()
maxkb_client = MaxKBClient(settings)
rule_loader = RuleLoader(maxkb_client, settings)
_auto_action_stop_event = asyncio.Event()
_auto_action_task: asyncio.Task | None = None
_paper_ai_stop_event = asyncio.Event()
_paper_ai_task: asyncio.Task | None = None
_reading_push_stop_event = asyncio.Event()
_reading_push_task: asyncio.Task | None = None
_deadline_reminder_stop_event = asyncio.Event()
_deadline_reminder_task: asyncio.Task | None = None

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_origin_regex=settings.allowed_origin_regex or None,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 静态资源 + JSON 响应 gzip 压缩（>1KB 才压，省 CPU）。
# vendor-antd 等大 chunk 体积可降到约 1/3，首屏传输量大幅下降。
app.add_middleware(GZipMiddleware, minimum_size=1024, compresslevel=6)


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
# 新手引导
app.include_router(newbie_guide_router)
# 轮播图
app.include_router(banners_user_router)
app.include_router(banners_admin_router)
app.include_router(points_admin_router)
app.include_router(mentors_admin_router)
app.include_router(mentors_public_router)
app.include_router(dashboard_admin_router)
# 用户管理（管理员）
app.include_router(users_admin_router)
app.include_router(whitelist_router)
app.include_router(magic_academy_router)
app.include_router(magic_video_router)
app.include_router(materials_router)
app.include_router(live_admin_router)
app.include_router(live_public_router)
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
# 推送监控
app.include_router(notifications_router)
# 规则重载
app.include_router(build_rules_router(rule_loader=rule_loader))


@app.on_event("startup")
async def _preload_rules() -> None:
    global _auto_action_task, _paper_ai_task, _reading_push_task, _deadline_reminder_task
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
    if _paper_ai_task is None or _paper_ai_task.done():
        _paper_ai_stop_event.clear()
        _paper_ai_task = asyncio.create_task(paper_ai_worker(_paper_ai_stop_event))
    if _reading_push_task is None or _reading_push_task.done():
        _reading_push_stop_event.clear()
        _reading_push_task = asyncio.create_task(reading_push_worker(_reading_push_stop_event))
    if _deadline_reminder_task is None or _deadline_reminder_task.done():
        _deadline_reminder_stop_event.clear()
        _deadline_reminder_task = asyncio.create_task(deadline_reminder_worker(_deadline_reminder_stop_event))


@app.on_event("shutdown")
async def _stop_auto_action_worker() -> None:
    global _auto_action_task, _paper_ai_task, _reading_push_task, _deadline_reminder_task
    _auto_action_stop_event.set()
    _paper_ai_stop_event.set()
    _reading_push_stop_event.set()
    _deadline_reminder_stop_event.set()
    if _auto_action_task is None:
        pass
    else:
        try:
            await _auto_action_task
        except Exception:  # noqa: BLE001
            logger.exception("auto action worker stopped with error")
        finally:
            _auto_action_task = None
    if _paper_ai_task is None:
        pass
    else:
        try:
            await _paper_ai_task
        except Exception:  # noqa: BLE001
            logger.exception("paper AI worker stopped with error")
        finally:
            _paper_ai_task = None
    if _reading_push_task is None:
        pass
    else:
        try:
            await _reading_push_task
        except Exception:  # noqa: BLE001
            logger.exception("reading push worker stopped with error")
        finally:
            _reading_push_task = None
    if _deadline_reminder_task is None:
        pass
    else:
        try:
            await _deadline_reminder_task
        except Exception:  # noqa: BLE001
            logger.exception("deadline reminder worker stopped with error")
        finally:
            _deadline_reminder_task = None
    # 关闭共享 httpx 客户端，避免 "Event loop is closed" 警告与文件描述符泄漏。
    try:
        await WecomClient.aclose()
    except Exception:  # noqa: BLE001
        logger.exception("close shared WeCom http client failed")
    try:
        await WechatMpClient.aclose()
    except Exception:  # noqa: BLE001
        logger.exception("close shared WeChat MP http client failed")
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


class _ImmutableStaticFiles(StaticFiles):
    """Vite 产物文件名带内容 hash，可长期强缓存；内容变了文件名也变，不会读到旧版本。"""

    def file_response(self, *args, **kwargs) -> StarletteResponse:
        resp = super().file_response(*args, **kwargs)
        resp.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        return resp


if assets_dir and assets_dir.exists():
    app.mount("/assets", _ImmutableStaticFiles(directory=assets_dir), name="assets")


@app.get(f"/{WECOM_VERIFY_FILENAME}", response_model=None, include_in_schema=False)
async def wecom_verify_file():
    if frontend_dist:
        verify_file = frontend_dist / WECOM_VERIFY_FILENAME
        if verify_file.exists():
            return FileResponse(verify_file, media_type="text/plain")
    return PlainTextResponse(WECOM_VERIFY_CONTENT, media_type="text/plain")


def _inject_live_meta(index_html: str, meta: dict[str, str] | None) -> str:
    if not meta:
        return index_html
    title = html.escape(meta.get("title") or "怀仁商学院")
    description = html.escape(meta.get("description") or "")
    image = html.escape(meta.get("image") or "")
    url = html.escape(meta.get("url") or "")
    tags = "\n".join([
        f"<title>{title}</title>",
        f'<meta name="description" content="{description}" />',
        f'<meta property="og:title" content="{title}" />',
        f'<meta property="og:description" content="{description}" />',
        f'<meta property="og:image" content="{image}" />',
        f'<meta property="og:url" content="{url}" />',
        '<meta property="og:type" content="website" />',
        f'<meta itemprop="name" content="{title}" />',
        f'<meta itemprop="description" content="{description}" />',
        f'<meta itemprop="image" content="{image}" />',
        f'<meta name="twitter:title" content="{title}" />',
        f'<meta name="twitter:description" content="{description}" />',
        f'<meta name="twitter:image" content="{image}" />',
    ])
    if "</head>" in index_html:
        return index_html.replace("</head>", f"{tags}\n</head>", 1)
    return f"{tags}\n{index_html}"


def _render_live_share_html(meta: dict[str, str] | None) -> str:
    if not meta:
        title = "怀仁商学院"
        description = "直播活动暂不可访问。"
        image = ""
        share_url = ""
        live_url = "/"
    else:
        title = meta.get("title") or "怀仁商学院"
        description = meta.get("description") or ""
        image = meta.get("image") or ""
        share_url = meta.get("url") or meta.get("live_url") or ""
        live_url = meta.get("live_url") or share_url or "/"
    escaped_title = html.escape(title)
    escaped_description = html.escape(description)
    escaped_image = html.escape(image)
    escaped_share_url = html.escape(share_url)
    escaped_live_url = html.escape(live_url)
    live_url_json = json.dumps(live_url, ensure_ascii=False)
    image_meta_tags = ""
    preview_image = ""
    if escaped_image:
        image_meta_tags = "\n".join([
            f'  <meta property="og:image" content="{escaped_image}" />',
            f'  <meta property="og:image:secure_url" content="{escaped_image}" />',
            '  <meta property="og:image:width" content="300" />',
            '  <meta property="og:image:height" content="300" />',
            f'  <meta itemprop="image" content="{escaped_image}" />',
            f'  <meta name="twitter:image" content="{escaped_image}" />',
            f'  <link rel="image_src" href="{escaped_image}" />',
        ])
        preview_image = (
            f'<img src="{escaped_image}" alt="" '
            'style="width:96px;height:96px;object-fit:cover;border-radius:8px;flex:0 0 auto" />'
        )
    return f"""<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>{escaped_title}</title>
  <meta name="description" content="{escaped_description}" />
  <meta property="og:title" content="{escaped_title}" />
  <meta property="og:description" content="{escaped_description}" />
{image_meta_tags}
  <meta property="og:url" content="{escaped_share_url}" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="怀仁商学院" />
  <meta itemprop="name" content="{escaped_title}" />
  <meta itemprop="description" content="{escaped_description}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="{escaped_title}" />
  <meta name="twitter:description" content="{escaped_description}" />
  <link rel="canonical" href="{escaped_share_url}" />
  <meta http-equiv="refresh" content="1;url={escaped_live_url}" />
  <script>window.location.replace({live_url_json});</script>
</head>
<body style="margin:0;background:#f5f7fa;color:#1f2937;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <main style="max-width:640px;margin:24px auto;padding:16px">
    <a href="{escaped_live_url}" style="display:flex;gap:14px;align-items:center;padding:16px;background:#fff;border:1px solid #e5e7eb;border-radius:12px;text-decoration:none;color:inherit">
      {preview_image}
      <span style="min-width:0;display:block">
        <strong style="display:block;font-size:17px;line-height:1.35;margin-bottom:6px;color:#111827">{escaped_title}</strong>
        <span style="display:block;font-size:14px;line-height:1.5;color:#6b7280">{escaped_description}</span>
      </span>
    </a>
  </main>
</body>
</html>"""


@app.get("/share/live/{slug}", response_model=None, include_in_schema=False)
async def live_share_entry(slug: str, request: Request):
    meta = None
    try:
        async with session_scope() as session:
            meta = await get_public_live_meta(session, slug, request)
    except Exception as exc:  # noqa: BLE001
        logger.warning("live share meta lookup failed slug=%s err=%s", slug, exc)
    return HTMLResponse(_render_live_share_html(meta))


@app.get("/live/{slug}", response_model=None, include_in_schema=False)
async def live_public_entry(slug: str, request: Request):
    if frontend_dist:
        index_file = frontend_dist / "index.html"
        if index_file.exists():
            meta = None
            try:
                async with session_scope() as session:
                    meta = await get_public_live_meta(session, slug, request)
            except Exception as exc:  # noqa: BLE001
                logger.warning("live meta lookup failed slug=%s err=%s", slug, exc)
            html_text = index_file.read_text(encoding="utf-8")
            return HTMLResponse(_inject_live_meta(html_text, meta))
    return {"message": "前端尚未构建，无法打开直播页。"}


@app.get("/{full_path:path}", response_model=None)
async def frontend(full_path: str):
    normalized = full_path.strip("/")
    if normalized == "api" or normalized.startswith("api/"):
        raise HTTPException(status_code=404, detail=f"API endpoint not found: /{normalized}")

    if frontend_dist:
        # 先尝试把请求当作 dist 根目录下的真实文件返回（favicon.ico、robots.txt 等）。
        # 否则任何路径都会掉进 SPA 兜底返回 index.html，根目录静态文件永远取不到。
        if normalized and "\\" not in normalized:
            candidate = (frontend_dist / normalized).resolve()
            if candidate.is_file() and frontend_dist.resolve() in candidate.parents:
                return FileResponse(candidate)
        index_file = frontend_dist / "index.html"
        if index_file.exists():
            return FileResponse(index_file)
    return {
        "message": "前端尚未构建或目录不对。请确认 frontend/dist/index.html 存在，"
                   "或设置 FRONTEND_DIST_PATH 环境变量指向 dist 目录。",
    }
