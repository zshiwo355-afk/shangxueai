from __future__ import annotations

from fastapi import APIRouter

router = APIRouter(prefix="/api/magic-academy", tags=["magic-academy"])
magic_video_router = APIRouter(prefix="/api/magic", tags=["magic-videos"])

from . import (  # noqa: E402,F401  -- triggers route registration
    videos,
    series,
    quiz,
    learning,
    stats,
    whitelist,
    reading,
    audio,
)

__all__ = ["router", "magic_video_router"]
