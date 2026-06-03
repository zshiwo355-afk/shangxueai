"""试卷派发 / 提交 / 复核 模块的兼容入口。

历史代码使用 ``from .paper_assignments_api import router, submit_router,
_recalc_submission, _ensure_assignment_status``。2026 年起业务被拆到
:mod:`app.paper_assignments` 包（``dtos.py`` / ``helpers.py`` /
``grading.py`` / ``admin_routes.py`` / ``user_routes.py``）。本文件继续重导出
旧符号；``paper_ai_worker.py`` 仍按旧路径 import 即可正常工作。
"""
from __future__ import annotations

from .paper_assignments import (
    _ensure_assignment_status,
    _recalc_submission,
    router,
    submit_router,
)

__all__ = [
    "router",
    "submit_router",
    "_recalc_submission",
    "_ensure_assignment_status",
]
