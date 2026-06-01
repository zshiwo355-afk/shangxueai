from __future__ import annotations

import asyncio
import logging

from ._oss import _delete_oss_object

_cleanup_tasks: set[asyncio.Task] = set()
def _normalize_keys(object_keys: list[str] | tuple[str, ...] | set[str]) -> list[str]:
    seen: set[str] = set()
    normalized: list[str] = []
    for item in object_keys:
        key = str(item or "").strip()
        if not key or key in seen:
            continue
        seen.add(key)
        normalized.append(key)
    return normalized


async def _delete_objects(keys: list[str], logger: logging.Logger) -> None:
    for key in keys:
        try:
            await asyncio.to_thread(_delete_oss_object, key)
        except Exception:  # noqa: BLE001
            logger.exception("Failed to delete OSS object asynchronously: %s", key)


def schedule_oss_object_cleanup(
    object_keys: list[str] | tuple[str, ...] | set[str],
    *,
    logger: logging.Logger,
) -> None:
    keys = _normalize_keys(object_keys)
    if not keys:
        return

    async def _runner() -> None:
        try:
            await _delete_objects(keys, logger)
        finally:
            _cleanup_tasks.discard(task)

    task = asyncio.create_task(_runner())
    _cleanup_tasks.add(task)
