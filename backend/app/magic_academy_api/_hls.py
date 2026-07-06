from __future__ import annotations

import asyncio
import logging
import mimetypes
import shutil
import subprocess
import tempfile
import time
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from fastapi import HTTPException
from sqlalchemy import and_, case, func, or_, select, text

from ..db import session_scope
from ..models import MagicVideo
from ._oss import (
    _build_delivery_object_url,
    _delete_oss_prefix,
    _download_oss_object_to_file,
    _ensure_oss_settings,
    _upload_file_to_oss,
    settings,
)
from ._utils import _strip_slashes

logger = logging.getLogger("app.magic_academy_api.hls")

HLS_INDEX_FILENAME = "index.m3u8"
TRANSCODE_CLAIM_LOCK = "shangxueai:magic-video-hls-claim"
HLS_UPLOAD_RETRIES = 3
FFMPEG_CRASH_RETURN_CODES = {-11, 139, -1073741819, 3221225477}
_running_video_ids: set[int] = set()
_worker_stop_event: asyncio.Event | None = None
_worker_task: asyncio.Task | None = None


class FfmpegProcessError(RuntimeError):
    def __init__(self, message: str, *, returncode: int) -> None:
        super().__init__(message)
        self.returncode = returncode


def _hls_root_prefix() -> str:
    configured = _strip_slashes(settings.magic_video_hls_prefix)
    if configured:
        return configured
    oss_settings = _ensure_oss_settings()
    return f"{oss_settings['prefix']}/hls"


def _transcode_concurrency() -> int:
    return max(int(settings.magic_video_transcode_concurrency or 1), 1)


def _transcode_poll_seconds() -> int:
    return max(int(settings.magic_video_transcode_poll_seconds or 15), 3)


def _transcode_stale_seconds() -> int:
    return max(int(settings.magic_video_transcode_stale_seconds or 900), 120)


def _transcode_source_expire_seconds() -> int:
    return max(
        int(settings.magic_video_transcode_source_expire_seconds or 0),
        int(settings.oss_signed_url_expire_seconds or 21600),
        21600,
    )


def _clean_rate_value(value: str | None) -> str:
    return str(value or "").strip()


def _hls_mime_type(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix == ".m3u8":
        return "application/vnd.apple.mpegurl"
    if suffix == ".ts":
        return "video/mp2t"
    return mimetypes.guess_type(path.name)[0] or "application/octet-stream"


def _is_http_source(source: str) -> bool:
    normalized = str(source or "").strip().lower()
    return normalized.startswith("http://") or normalized.startswith("https://")


def _ffmpeg_command(source_url: str, output_dir: Path, *, safe_mode: bool = False) -> list[str]:
    segment_seconds = max(int(settings.magic_video_hls_segment_seconds or 6), 2)
    height = int(settings.magic_video_hls_height or 0)
    crf = min(max(int(settings.magic_video_hls_crf or 23), 16), 32)
    preset = (settings.magic_video_hls_preset or "veryfast").strip() or "veryfast"
    audio_bitrate = (settings.magic_video_hls_audio_bitrate or "128k").strip() or "128k"
    video_bitrate = _clean_rate_value(getattr(settings, "magic_video_hls_video_bitrate", "1400k"))
    maxrate = _clean_rate_value(getattr(settings, "magic_video_hls_maxrate", "1800k"))
    bufsize = _clean_rate_value(getattr(settings, "magic_video_hls_bufsize", "3600k"))
    command = [
        settings.magic_video_ffmpeg_path or "ffmpeg",
        "-hide_banner",
        "-nostdin",
        "-nostats",
        "-y",
    ]
    if _is_http_source(source_url):
        command.extend([
            "-reconnect",
            "1",
            "-reconnect_streamed",
            "1",
            "-reconnect_on_network_error",
            "1",
            "-reconnect_delay_max",
            "30",
        ])
    if safe_mode:
        command.extend([
            "-fflags",
            "+discardcorrupt+genpts",
            "-err_detect",
            "ignore_err",
            "-analyzeduration",
            "100M",
            "-probesize",
            "100M",
        ])
    command.extend([
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
    ])
    if safe_mode:
        command.extend(["-threads", "1"])
    if video_bitrate:
        command.extend(["-b:v", video_bitrate])
    else:
        command.extend(["-crf", str(crf)])
    if maxrate:
        command.extend(["-maxrate", maxrate])
    if bufsize:
        command.extend(["-bufsize", bufsize])
    command.extend([
        "-profile:v",
        "main",
        "-pix_fmt",
        "yuv420p",
    ])
    if height > 0:
        command.extend(["-vf", f"scale=-2:{height}"])
    if safe_mode:
        command.extend(["-max_muxing_queue_size", "4096"])
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


def _is_ffmpeg_crash_code(returncode: int) -> bool:
    return int(returncode) in FFMPEG_CRASH_RETURN_CODES


def _reset_output_directory(output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    for path in output_dir.iterdir():
        if path.is_dir():
            shutil.rmtree(path, ignore_errors=True)
        else:
            path.unlink(missing_ok=True)


def _run_ffmpeg_once(source_url: str, output_dir: Path, *, safe_mode: bool = False) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    command = _ffmpeg_command(source_url, output_dir, safe_mode=safe_mode)
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
        mode = "safe retry" if safe_mode else "primary"
        tail = stderr[-2000:] if stderr else f"ffmpeg exited with code {result.returncode}"
        raise FfmpegProcessError(f"{mode} ffmpeg failed: {tail}", returncode=int(result.returncode))
    if not (output_dir / HLS_INDEX_FILENAME).exists():
        raise RuntimeError("ffmpeg did not generate index.m3u8")


def _run_ffmpeg(source_url: str, output_dir: Path) -> None:
    try:
        _run_ffmpeg_once(source_url, output_dir, safe_mode=False)
        return
    except FfmpegProcessError as exc:
        if not _is_ffmpeg_crash_code(exc.returncode):
            raise
        logger.warning("ffmpeg crashed with code %s; retrying in safe mode", exc.returncode)
        primary_error = str(exc)

    _reset_output_directory(output_dir)
    try:
        _run_ffmpeg_once(source_url, output_dir, safe_mode=True)
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError(f"{primary_error}\nsafe retry failed: {exc}") from exc


def _upload_hls_file_with_retry(path: Path, object_key: str) -> None:
    last_error: BaseException | None = None
    for attempt in range(1, HLS_UPLOAD_RETRIES + 1):
        try:
            _upload_file_to_oss(object_key, path, _hls_mime_type(path))
            return
        except Exception as exc:  # noqa: BLE001
            last_error = exc
            if attempt >= HLS_UPLOAD_RETRIES:
                break
            time.sleep(min(2 ** attempt, 10))
    raise RuntimeError(f"upload HLS asset failed: {path.name}: {last_error}") from last_error


def _upload_hls_directory(output_dir: Path, object_prefix: str) -> str:
    files = sorted(path for path in output_dir.iterdir() if path.is_file())
    if not files:
        raise RuntimeError("HLS output directory is empty")
    for path in files:
        object_key = f"{object_prefix}/{path.name}"
        _upload_hls_file_with_retry(path, object_key)
    return f"{object_prefix}/{HLS_INDEX_FILENAME}"


def _transcode_temp_parent() -> str | None:
    configured = str(getattr(settings, "magic_video_transcode_tmp_dir", "") or "").strip()
    if not configured:
        return None
    path = Path(configured)
    path.mkdir(parents=True, exist_ok=True)
    return str(path)


def _transcode_and_upload(video_id: int, object_key: str, object_prefix: str) -> str:
    temp_root = Path(tempfile.mkdtemp(prefix=f"magic-hls-{video_id}-", dir=_transcode_temp_parent()))
    source_suffix = Path(object_key).suffix.lower() or ".mp4"
    source_path = temp_root / f"source{source_suffix}"
    output_dir = temp_root / "hls"
    try:
        logger.info("HLS transcode downloading source video_id=%s key=%s", video_id, object_key)
        source_size = _download_oss_object_to_file(object_key, source_path)
        if source_size <= 0:
            raise RuntimeError("source video download is empty")
        logger.info("HLS transcode source downloaded video_id=%s bytes=%s", video_id, source_size)
        _run_ffmpeg(str(source_path), output_dir)
        index_key = _upload_hls_directory(output_dir, object_prefix)
        return _build_delivery_object_url(index_key)
    finally:
        shutil.rmtree(temp_root, ignore_errors=True)


def _error_message(exc: BaseException) -> str:
    text_value = str(exc).strip()
    return text_value[-2000:] if text_value else exc.__class__.__name__


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
        video.updated_at = datetime.now()
        if status == "completed":
            video.transcoded_at = datetime.now()


async def _touch_video_transcode(video_id: int, object_key: str) -> None:
    async with session_scope() as db:
        video = await db.get(MagicVideo, int(video_id))
        if video is None or video.deleted_at is not None:
            return
        if (video.oss_object_key or "").strip() != object_key:
            return
        if (video.transcode_status or "").strip().lower() != "processing":
            return
        video.updated_at = datetime.now()


async def _is_video_current_for_transcode(video_id: int, object_key: str) -> bool:
    async with session_scope() as db:
        video = await db.get(MagicVideo, int(video_id))
        if video is None or video.deleted_at is not None:
            return False
        return (
            (video.oss_object_key or "").strip() == object_key
            and (video.upload_status or "completed").strip().lower() == "completed"
            and (video.transcode_status or "").strip().lower() == "processing"
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
            "transcode_status": (video.transcode_status or "none").strip().lower(),
        }


async def _heartbeat_loop(video_id: int, object_key: str, stop_event: asyncio.Event) -> None:
    while not stop_event.is_set():
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=30)
            break
        except (TimeoutError, asyncio.TimeoutError):
            try:
                await _touch_video_transcode(video_id, object_key)
            except Exception:  # noqa: BLE001
                logger.exception("HLS transcode heartbeat failed video_id=%s", video_id)


async def _run_transcode_job(job: dict[str, Any]) -> None:
    video_id = int(job["video_id"])
    object_key = str(job["object_key"])
    object_prefix = str(job["object_prefix"])
    old_prefix = str(job.get("old_hls_object_prefix") or "")
    _running_video_ids.add(video_id)
    heartbeat_stop = asyncio.Event()
    heartbeat_task: asyncio.Task | None = None
    try:
        if not await _is_video_current_for_transcode(video_id, object_key):
            return
        heartbeat_task = asyncio.create_task(_heartbeat_loop(video_id, object_key, heartbeat_stop))
        hls_url = await asyncio.to_thread(_transcode_and_upload, video_id, object_key, object_prefix)
        heartbeat_stop.set()
        if heartbeat_task is not None:
            await heartbeat_task
        heartbeat_task = None
        if not await _is_video_current_for_transcode(video_id, object_key):
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
        if await _is_video_current_for_transcode(video_id, object_key):
            await _mark_video_transcode(video_id, status="failed", error=_error_message(exc))
        else:
            try:
                await asyncio.to_thread(_delete_oss_prefix, object_prefix)
            except Exception:  # noqa: BLE001
                logger.exception("failed to cleanup abandoned HLS prefix video_id=%s prefix=%s", video_id, object_prefix)
    finally:
        heartbeat_stop.set()
        if heartbeat_task is not None:
            try:
                await heartbeat_task
            except Exception:  # noqa: BLE001
                logger.exception("HLS heartbeat task stopped with error video_id=%s", video_id)
        _running_video_ids.discard(video_id)


async def _try_claim_lock(db) -> bool:
    result = await db.execute(text("SELECT GET_LOCK(:name, 0)"), {"name": TRANSCODE_CLAIM_LOCK})
    return bool(result.scalar())


async def _release_claim_lock(db) -> None:
    await db.execute(text("SELECT RELEASE_LOCK(:name)"), {"name": TRANSCODE_CLAIM_LOCK})


async def _claim_next_transcode_job() -> dict[str, Any] | None:
    async with session_scope() as db:
        if not await _try_claim_lock(db):
            return None
        try:
            now = datetime.now()
            stale_cutoff = now - timedelta(seconds=_transcode_stale_seconds())
            active_count = (
                await db.execute(
                    select(func.count(MagicVideo.id)).where(
                        MagicVideo.deleted_at.is_(None),
                        MagicVideo.transcode_status == "processing",
                        MagicVideo.updated_at >= stale_cutoff,
                    )
                )
            ).scalar_one()
            if int(active_count or 0) >= _transcode_concurrency():
                return None

            result = await db.execute(
                select(MagicVideo)
                .where(
                    MagicVideo.deleted_at.is_(None),
                    MagicVideo.storage_type == "oss",
                    MagicVideo.upload_status == "completed",
                    MagicVideo.oss_object_key != "",
                    or_(
                        MagicVideo.transcode_status == "pending",
                        and_(
                            MagicVideo.transcode_status == "processing",
                            MagicVideo.updated_at < stale_cutoff,
                        ),
                    ),
                )
                .order_by(
                    case((MagicVideo.transcode_status == "pending", 0), else_=1),
                    MagicVideo.updated_at.asc(),
                    MagicVideo.id.asc(),
                )
                .with_for_update()
                .limit(1)
            )
            video = result.scalars().first()
            if video is None:
                return None
            video_id = int(video.id)
            if video_id in _running_video_ids:
                return None
            object_key = (video.oss_object_key or "").strip()
            old_prefix = (video.hls_object_prefix or "").strip()
            object_prefix = f"{_hls_root_prefix()}/{video_id}/{uuid.uuid4().hex}"
            video.transcode_status = "processing"
            video.transcode_error = ""
            video.updated_at = now
            await db.flush()
            await db.commit()
            logger.info("HLS transcode job claimed video_id=%s", video_id)
            return {
                "video_id": video_id,
                "object_key": object_key,
                "object_prefix": object_prefix,
                "old_hls_object_prefix": old_prefix,
            }
        finally:
            try:
                await _release_claim_lock(db)
            except Exception:  # noqa: BLE001
                logger.exception("release HLS transcode claim lock failed")


async def enqueue_video_hls_transcode(video_id: int, *, force: bool = False) -> dict[str, Any]:
    video_id = int(video_id)
    snapshot = await _load_video_for_transcode(video_id)
    if snapshot["transcode_status"] in {"pending", "processing"}:
        ensure_video_hls_transcode_worker()
        return {"queued": False, "video_id": video_id, "transcode_status": snapshot["transcode_status"]}
    if snapshot["transcode_status"] == "completed" and not force:
        return {"queued": False, "video_id": video_id, "transcode_status": "completed"}

    async with session_scope() as db:
        video = await db.get(MagicVideo, video_id)
        if video is None or video.deleted_at is not None:
            raise HTTPException(status_code=404, detail="Video not found.")
        current_status = (video.transcode_status or "none").strip().lower()
        if current_status in {"pending", "processing"}:
            ensure_video_hls_transcode_worker()
            return {"queued": False, "video_id": video_id, "transcode_status": current_status}
        if current_status == "completed" and not force:
            return {"queued": False, "video_id": video_id, "transcode_status": "completed"}
        video.transcode_status = "pending"
        video.transcode_error = ""
        video.updated_at = datetime.now()
    ensure_video_hls_transcode_worker()
    return {"queued": True, "video_id": video_id, "transcode_status": "pending"}


async def video_hls_transcode_worker(stop_event: asyncio.Event) -> None:
    logger.info("HLS transcode worker started")
    while not stop_event.is_set():
        try:
            job = await _claim_next_transcode_job()
        except Exception:  # noqa: BLE001
            logger.exception("HLS transcode worker claim failed")
            job = None
        if job is None:
            try:
                await asyncio.wait_for(stop_event.wait(), timeout=_transcode_poll_seconds())
            except (TimeoutError, asyncio.TimeoutError):
                pass
            continue
        await _run_transcode_job(job)


def ensure_video_hls_transcode_worker() -> asyncio.Task:
    global _worker_stop_event, _worker_task
    if _worker_stop_event is None:
        _worker_stop_event = asyncio.Event()
    if _worker_task is None or _worker_task.done():
        _worker_stop_event.clear()
        _worker_task = asyncio.create_task(video_hls_transcode_worker(_worker_stop_event))
    return _worker_task


async def stop_video_hls_transcode_worker() -> None:
    global _worker_task
    if _worker_task is None:
        return
    if _worker_stop_event is not None:
        _worker_stop_event.set()
    try:
        await _worker_task
    except Exception:  # noqa: BLE001
        logger.exception("HLS transcode worker stopped with error")
    finally:
        _worker_task = None


__all__ = [
    "enqueue_video_hls_transcode",
    "ensure_video_hls_transcode_worker",
    "stop_video_hls_transcode_worker",
    "video_hls_transcode_worker",
]
