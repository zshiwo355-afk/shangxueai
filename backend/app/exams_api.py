"""考试 / 通关模块的兼容入口。

历史代码使用 ``from .exams_api import admin_router, review_router, build_user_router``。
2026 年起业务被拆到 :mod:`app.exams` 包（``dtos.py`` / ``helpers.py`` /
``admin_routes.py`` / ``user_routes.py``）。本文件继续重导出旧符号，
不再承载业务逻辑，方便其它模块沿用旧路径而无需改动。
"""
from __future__ import annotations

from .exams import admin_router, build_user_router, review_router

__all__ = ["admin_router", "review_router", "build_user_router"]
