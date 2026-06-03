"""试卷派发 / 提交 / 复核（人工评分）模块包。

历史 ``backend/app/paper_assignments_api.py`` 单文件 1700+ 行，承担：
派发管理、批量推送、复核、用户端答题、AI 主观题评分、submission/assignment 状态推算。

2026 年起按 ``dtos.py`` / ``helpers.py`` / ``grading.py`` / ``admin_routes.py`` /
``user_routes.py`` 拆分；外部模块仍可通过 ``from .paper_assignments_api import router,
submit_router, _recalc_submission, _ensure_assignment_status`` 使用旧符号
（``paper_ai_worker.py`` 依赖后两个内部 helper）。
"""
from __future__ import annotations

from .admin_routes import router
from .grading import _ensure_assignment_status, _recalc_submission
from .user_routes import submit_router

__all__ = [
    "router",
    "submit_router",
    "_recalc_submission",
    "_ensure_assignment_status",
]
