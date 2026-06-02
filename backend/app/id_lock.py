"""按业务 ID 维度的 asyncio.Lock 注册表。

需求：
- 同一 ID 的并发请求要串行（用同一把 Lock）
- 不同 ID 之间互不影响
- 不能像原来那样 defaultdict 永不回收 —— 长期运行下会泄漏

方案：定期扫描自身字典，把"当前没人在等 + 没人持有"的 Lock 删掉。
和直接用 WeakValueDictionary 不同：在锁刚释放还没回收时立刻被 GC，
会导致下一个请求拿到新 Lock 失去互斥。这里用引用计数显式控制，
用完才有机会被清理。
"""
from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)


@dataclass
class _LockEntry:
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    waiters: int = 0


class IdLockRegistry:
    def __init__(self, *, name: str = "id-lock") -> None:
        self.name = name
        self._entries: dict[int, _LockEntry] = {}
        self._registry_lock = asyncio.Lock()

    @asynccontextmanager
    async def acquire(self, key: int):
        key = int(key)
        async with self._registry_lock:
            entry = self._entries.get(key)
            if entry is None:
                entry = _LockEntry()
                self._entries[key] = entry
            entry.waiters += 1
        try:
            async with entry.lock:
                yield
        finally:
            async with self._registry_lock:
                entry.waiters -= 1
                # 没人在排队也没人持有 → 可以丢掉 entry，避免长期堆积
                if entry.waiters <= 0 and not entry.lock.locked():
                    self._entries.pop(key, None)

    def size(self) -> int:
        return len(self._entries)
