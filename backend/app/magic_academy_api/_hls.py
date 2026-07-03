from __future__ import annotations

import asyncio
import logging
import mimetypes
import shutil
import subprocess
import tempfile
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

from fastapi import HTTPException

from ..db import session_scope
from ..models import MagicVideo
from ._oss import (
    _build_delivery_object_url,
    _build_signed_stream_url,
    _delete_oss_prefix,
    _ensure_oss_settings,
    _upload_file_to_oss,
    settings,
)
from ._utils import _strip_slashes

logger = logging.getLogger("app.magic_academy_api.hls")

HLS_INDEX_FILENAME = "index.m3u8"
_transcode_tasks: set[asyncio.Task] = set()
_running_video_ids: set[int] = set()
_transcode_semaphore: asyncio.Semaphore | None = None


def _hls_root_prefix() -> str:
    configured = _strip_slashes(settings.magic_video_hls_prefix)
    if configured:
        return configured
    oss_settings = _ensure_oss_settings()
    return f"{oss_settings['prefix']}/hls"


def _get_transcode_semaphore() -> asyncio.Semaphore:
    global _transcode_semaphore
    if _transcode_semaphore is None:
        concurrency = max(int(settings.magic_video_transcode_concurrency or 1), 1)
        _transcode_semaphore = asyncio.Semaphore(concurrency)
    return _transcode_semaphore


def _transcode_source_expire_seconds() -> int:
    return max(
        int(settings.magic_video_transcode_source_expire_seconds or 0),
        int(settings.oss_signed_url_expire_seconds or 21600),
        21600,
    )


def _hls_mime_type(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix == ".m3u8":
        return "application/vnd.apple.mpegurl"
    if suffix == ".ts":
        return "video/mp2t"
    return mimetypes.guess_type(path.name)[0] or "application/octet-stream"


def _ffmpeg_command(source_url: str, output_dir: Path) -> list[str]:
    segment_seconds = max(int(settings.magic_video_hls_segment_seconds or 6), 2)
    height = int(settings.magic_video_hls_height or 0)
    crf = min(max(int(settings.magic_video_hls_crf or 23), 16), 32)
    preset = (settings.magic_video_hls_preset or "veryfast").strip() or "veryfast"
    audio_bitrate = (settings.magic_video_hls_audio_bitrate or "128k").strip() or "128k"
    command = [
        settings.magic_video_ffmpeg_path or "ffmpeg",
        "-hide_banner",
        "-nostdin",
        "-nostats",
        "-y",
        "-i",
        source_url,
        "-map",
        "0:v:0",
        "-map",
        "0:a:0?",
        "-c:v",
        "libx264",
        "-preset",
        preset,
        "-crf",
        str(crf),
        "-profile:v",
        "main",
        "-pix_fmt",
        "yuv420p",
    ]
    if height > 0:
        command.extend(["-vf", f"scale=-2:{height}"])
    command.extend([
        "-c:a",
        "aac",
        "-b:a",
        audio_bitrate,
        "-ac",
        "2",
        "-f",
        "hls",
        "-hls_time",
        str(segment_seconds),
        "-hls_playlist_type",
        "vod",
        "-hls_segment_filename",
        str(output_dir / "segment_%05d.ts"),
        str(output_dir / HLS_INDEX_FILENAME),
    ])
    return command


def _run_ffmpeg(source_url: str, output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    command = _ffmpeg_command(source_url, output_dir)
    timeout = int(settings.magic_video_transcode_timeout_seconds or 0) or None
    try:
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
    except FileNotFoundError as exc:
        raise RuntimeError(f"ffmpeg not found: {settings.magic_video_ffmpeg_path or 'ffmpeg'}") from exc
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError("ffmpeg transcode timed out") from exc
    if result.returncode != 0:
        stderr = (result.stderr or result.stdout or "").strip()
        tail = stderr[-2000:] if stderr else f"ffmpeg exited with code {result.returncode}"
        raise RuntimeError(tail)
    if not (output_dir / HLS_INDEX_FILENAME).exists():
        raise RuntimeError("ffmpeg did not generate index.m3u8")


def _upload_hls_directory(output_dir: Path, object_prefix: str) -> str:
    files = sorted(path for path in output_dir.iterdir() if path.is_file())
    if not files:
        raise RuntimeError("HLS output directory is empty")
    for path in files:
        object_key = f"{object_prefix}/{path.name}"
        _upload_file_to_oss(object_key, path, _hls_mime_type(path))
    return f"{object_prefix}/{HLS_INDEX_FILENAME}"


def _transcode_and_upload(video_id: int, object_key: str, object_prefix: str) -> str:
    source_url = _build_signed_stream_url(object_key, expire_seconds=_transcode_source_expire_seconds())
    temp_dir = Path(tempfile.mkdtemp(prefix=f"magic-hls-{video_id}-"))
    try:
        _run_ffmpeg(source_url, temp_dir)
        index_key = _upload_hls_directory(temp_dir, object_prefix)
        return _build_delivery_object_url(index_key)
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


def _error_message(exc: BaseException) -> str:
    text = str(exc).strip()
    return text[-2000:] if text else exc.__class__.__name__


async def _mark_video_transcode(
    video_id: int,
    *,
    status: str,
    hls_url: str | None = None,
    hls_object_prefix: str | None = None,
    error: str = "",
) -> None:
    async with session_scope() as db:
        video = await db.get(MagicVideo, int(video_id))
        if video is None or video.deleted_at is not None:
            return
        video.transcode_status = status
        if hls_url is not None:
            video.hls_url = hls_url
            if hls_url:
                video.play_url = hls_url
                video.cdn_url = hls_url
        if hls_object_prefix is not None:
            video.hls_object_prefix = hls_object_prefix
        video.transcode_error = error
        if status == "completed":
            video.transcoded_at = datetime.now()


async def _is_video_current_for_transcode(video_id: int, object_key: str, object_prefix: str) -> bool:
    async with session_scope() as db:
        video = await db.get(MagicVideo, int(video_id))
        if video is None or video.deleted_at is not None:
            return False
        return (
            (video.oss_object_key or "").strip() == object_key
            and (video.hls_object_prefix or "").strip() == object_prefix
        )


async def _load_video_for_transcode(video_id: int) -> dict[str, Any]:
    async with session_scope() as db:
        video = await db.get(MagicVideo, int(video_id))
        if video is None or video.deleted_at is not None:
            raise HTTPException(status_code=404, detail="Video not found.")
        if (video.storage_type or "").strip().lower() != "oss" or not (video.oss_object_key or "").strip():
            raise HTTPException(status_code=400, detail="Only OSS videos can be transcoded to HLS.")
        if (video.upload_status or "completed").strip().lower() != "completed":
            raise HTTPException(status_code=400, detail="Video upload is not completed.")
        return {
            "id": int(video.id),
            "object_key": video.oss_object_key.strip(),
            "old_hls_object_prefix": (video.hls_object_prefix or "").strip(),
            "transcode_status": (video.transcode_status or "none").strip().lower(),
        }


async def _run_transcode_job(video_id: int, object_key: str, object_prefix: str, old_prefix: str) -> None:
    try:
        async with _get_transcode_semaphore():
            if not await _is_video_current_for_transcode(video_id, object_key, object_prefix):
                return
            await _mark_video_transcode(
                video_id,
                status="processing",
                hls_object_prefix=object_prefix,
                error="",
            )
            hls_url = await asyncio.to_thread(_transcode_and_upload, video_id, object_key, object_prefix)
            if not await _is_video_current_for_transcode(video_id, object_key, object_prefix):
                try:
                    await asyncio.to_thread(_delete_oss_prefix, object_prefix)
                except Exception:  # noqa: BLE001
                    logger.exception("failed to cleanup stale HLS prefix video_id=%s prefix=%s", video_id, object_prefix)
                return
            await _mark_video_transcode(
                video_id,
                status="completed",
                hls_url=hls_url,
                hls_object_prefix=object_prefix,
                error="",
            )
            if old_prefix and old_prefix != object_prefix:
                try:
                    await asyncio.to_thread(_delete_oss_prefix, old_prefix)
                except Exception:  # noqa: BLE001
                    logger.exception("failed to cleanup old HLS prefix video_id=%s prefix=%s", video_id, old_prefix)
            logger.info("HLS transcode completed video_id=%s url=%s", video_id, hls_url)
    except Exception as exc:  # noqa: BLE001
        logger.exception("HLS transcode failed video_id=%s", video_id)
        await _mark_video_transcode(video_id, status="failed", error=_error_message(exc))
    finally:
        _running_video_ids.discard(int(video_id))


async def enqueue_video_hls_transcode(video_id: int, *, force: bool = False) -> dict[str, Any]:
    video_id = int(video_id)
    if video_id in _running_video_ids:
        return {"queued": False, "video_id": video_id, "transcode_status": "processing"}
    snapshot = await _load_video_for_transcode(video_id)
    if snapshot["transcode_status"] in {"pending", "processing"} and not force:
        return {"queued": False, "video_id": video_id, "transcode_status": snapshot["transcode_status"]}
    if snapshot["transcode_status"] == "completed" and not force:
        return {"queued": False, "video_id": video_id, "transcode_status": "completed"}

    root_prefix = _hls_root_prefix()
    object_prefix = f"{root_prefix}/{video_id}/{uuid.uuid4().hex}"
    await _mark_video_transcode(
        video_id,
        status="pending",
        hls_object_prefix=object_prefix,
        error="",
    )

    _running_video_ids.add(video_id)
    task = asyncio.create_task(
        _run_transcode_job(
            video_id,
            snapshot["object_key"],
            object_prefix,
            snapshot["old_hls_object_prefix"],
        )
    )
    _transcode_tasks.add(task)
    task.add_done_callback(_transcode_tasks.discard)
    return {"queued": True, "video_id": video_id, "transcode_status": "pending"}


__all__ = ["enqueue_video_hls_transcode"]
