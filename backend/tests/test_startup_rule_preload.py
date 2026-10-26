"""Exercise the real startup handler without importing live clients/workers."""
import ast
import asyncio
from contextlib import asynccontextmanager
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock


def isolated_startup(reload_all):
    # Compile only the production handler: importing app.main would initialize
    # unrelated clients and would turn this bounded-startup test into an env test.
    source_path = Path(__file__).parents[1] / "app" / "main.py"
    tree = ast.parse(source_path.read_text(encoding="utf-8"))
    handler = next(node for node in tree.body if isinstance(node, ast.AsyncFunctionDef) and node.name == "_preload_rules")
    handler.decorator_list = []
    module = ast.Module(body=[handler], type_ignores=[])
    observed_timeouts = []

    async def fast_wait_for(coroutine, *, timeout):
        observed_timeouts.append(timeout)
        # Keep the production deadline assertion while making timeout tests fast.
        return await asyncio.wait_for(coroutine, timeout=min(timeout, 0.01))

    @asynccontextmanager
    async def session_scope():
        yield object()

    async def worker(stop_event):
        await stop_event.wait()

    namespace = {
        "asyncio": SimpleNamespace(wait_for=fast_wait_for, create_task=asyncio.create_task),
        "session_scope": session_scope,
        "ensure_builtin_super_admin": AsyncMock(),
        "rule_loader": SimpleNamespace(reload_all=reload_all),
        "logger": Mock(),
        "_auto_action_task": None,
        "_auto_action_stop_event": asyncio.Event(),
        "auto_action_worker": worker,
    }
    for name in ("_paper_ai_task", "_reading_push_task", "_deadline_reminder_task", "_employee_sync_task",
                 "_personality_retention_task", "_reading_file_cleanup_task"):
        namespace[name] = SimpleNamespace(done=lambda: False)
    exec(compile(module, str(source_path), "exec"), namespace)
    return namespace, observed_timeouts


async def stop_worker(namespace):
    namespace["_auto_action_stop_event"].set()
    await namespace["_auto_action_task"]


def test_successful_rule_preload_returns_and_starts_workers():
    async def scenario():
        namespace, timeouts = isolated_startup(AsyncMock(return_value=21))
        await namespace["_preload_rules"]()
        assert timeouts == [10.0]
        namespace["ensure_builtin_super_admin"].assert_awaited_once()
        namespace["logger"].info.assert_called_once_with("rule_loader preloaded %d rules", 21)
        namespace["logger"].warning.assert_not_called()
        assert isinstance(namespace["_auto_action_task"], asyncio.Task)
        await stop_worker(namespace)

    asyncio.run(scenario())


def test_preload_timeout_cancels_children_and_continues_startup():
    async def scenario():
        cancelled = set()
        lock = asyncio.Lock()

        async def slow_login(index):
            try:
                async with lock:
                    await asyncio.Event().wait()
            finally:
                cancelled.add(index)

        async def slow_preload():
            # Mirrors RuleLoader.gather and MaxKB's serialized admin login lock.
            await asyncio.gather(*(slow_login(index) for index in range(3)), return_exceptions=True)

        namespace, timeouts = isolated_startup(slow_preload)
        await namespace["_preload_rules"]()
        assert timeouts == [10.0] and cancelled == {0, 1, 2}
        namespace["logger"].warning.assert_called_once()
        assert isinstance(namespace["logger"].warning.call_args.args[1], TimeoutError)
        assert isinstance(namespace["_auto_action_task"], asyncio.Task)
        assert not lock.locked()
        await stop_worker(namespace)

    asyncio.run(scenario())
