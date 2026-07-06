from __future__ import annotations

import asyncio
import logging
import signal

from ..config import get_settings
from ._hls import video_hls_transcode_worker


logger = logging.getLogger("app.magic_academy_api.hls_worker")


async def main() -> None:
    logging.basicConfig(level=logging.INFO)
    if not get_settings().magic_video_transcode_enabled:
        logger.warning("HLS transcode worker disabled by MAGIC_VIDEO_TRANSCODE_ENABLED=false.")
        return

    stop_event = asyncio.Event()

    def stop() -> None:
        logger.info("HLS transcode worker stopping...")
        stop_event.set()

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, stop)
        except (NotImplementedError, RuntimeError):
            signal.signal(sig, lambda *_: stop())

    await video_hls_transcode_worker(stop_event)


if __name__ == "__main__":
    asyncio.run(main())
