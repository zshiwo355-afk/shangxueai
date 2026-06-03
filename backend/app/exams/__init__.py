"""考试（AI 通关）模块包。

历史上整模块都在 `backend/app/exams_api.py`（1100+ 行），随着多次迭代变得不便维护。
这里按 dtos / helpers / admin_routes / user_routes 拆分；外部模块仍然按原签名
通过 `from .exams import admin_router, review_router, build_user_router` 使用。
"""
from __future__ import annotations

from .admin_routes import admin_router, review_router
from .user_routes import build_user_router

__all__ = ["admin_router", "review_router", "build_user_router"]
