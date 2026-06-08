from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta

from .config import get_settings
from .db import session_scope
from .employee_open_client import EmployeeOpenApiError
from .employee_sync import execute_employee_sync

logger = logging.getLogger("app.employee_sync_worker")

SYNC_HOUR = 8
SYNC_MINUTE = 0


def _seconds_until_next_run(now: datetime | None = None) -> float:
    current = now or datetime.now()
    next_run = current.replace(hour=SYNC_HOUR, minute=SYNC_MINUTE, second=0, microsecond=0)
    if next_run <= current:
        next_run += timedelta(days=1)
    return max((next_run - current).total_seconds(), 0.0)


async def _run_employee_sync_once() -> None:
    settings = get_settings()
    if not settings.employee_sync_ready:
        logger.info("employee_sync_worker skipped: employee sync not configured.")
        return
    async with session_scope() as session:
        result = await execute_employee_sync(
            session,
            actor=None,
            mode="scheduled",
            initial_mode=False,
        )
        logger.info(
            "scheduled employee sync finished batch_id=%s summary=%s",
            result.get("batch_id"),
            result.get("summary"),
        )


async def employee_sync_worker(stop_event: asyncio.Event) -> None:
    logger.info("employee_sync_worker started, scheduled daily at 08:00")
    while not stop_event.is_set():
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=_seconds_until_next_run())
            continue
        except (TimeoutError, asyncio.TimeoutError):
            pass

        if stop_event.is_set():
            break
        try:
            await _run_employee_sync_once()
        except EmployeeOpenApiError as exc:
            logger.warning("scheduled employee sync failed: %s", exc)
        except Exception:  # noqa: BLE001
            logger.exception("scheduled employee sync unexpected error")


__all__ = ["employee_sync_worker", "_seconds_until_next_run"]
