from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime
from typing import Any
from urllib.parse import unquote, urlparse

from fastapi import HTTPException

from ..db import session_scope
from ..models import MagicVideo
from ._oss import _build_delivery_object_url, _delete_oss_prefix, _ensure_oss_settings, settings
from ._utils import _strip_slashes

logger = logging.getLogger("app.magic_academy_api.ims")

IMS_PROVIDER = "ims"
RUNNING_STATUSES = {"pending", "processing"}


def _now() -> datetime:
    return datetime.now()


def _extract_region_from_oss_endpoint(endpoint: str) -> str:
    host = (endpoint or "").strip().replace("https://", "").replace("http://", "").split("/", 1)[0]
    marker = "oss-"
    if host.startswith(marker):
        return host[len(marker) :].split(".", 1)[0]
    if ".oss-" in host:
        return host.split(".oss-", 1)[1].split(".", 1)[0]
    return ""


def _ims_region() -> str:
    configured = (settings.aliyun_ims_region or "").strip()
    if configured:
        return configured
    return _extract_region_from_oss_endpoint(settings.oss_endpoint)


def _ims_credentials() -> tuple[str, str]:
    access_key_id = (settings.aliyun_ims_access_key_id or settings.oss_access_key_id or "").strip()
    access_key_secret = (settings.aliyun_ims_access_key_secret or settings.oss_access_key_secret or "").strip()
    return access_key_id, access_key_secret


def _require_ims_base_settings() -> dict[str, str]:
    access_key_id, access_key_secret = _ims_credentials()
    region = _ims_region()
    if not access_key_id or not access_key_secret:
        raise HTTPException(status_code=500, detail="阿里云 IMS AccessKey 未配置。")
    if not region:
        raise HTTPException(status_code=500, detail="ALIYUN_IMS_REGION 未配置，且无法从 OSS_ENDPOINT 推断。")
    return {
        "access_key_id": access_key_id,
        "access_key_secret": access_key_secret,
        "region": region,
    }


def _require_ims_settings() -> dict[str, str]:
    ims_settings = _require_ims_base_settings()
    template_id = (settings.aliyun_ims_template_id or "").strip()
    if not template_id:
        raise HTTPException(status_code=500, detail="ALIYUN_IMS_TEMPLATE_ID 未配置，请先在阿里云 IMS 创建转码模板。")
    ims_settings["template_id"] = template_id
    return ims_settings


def _output_root_prefix() -> str:
    configured = _strip_slashes(settings.aliyun_ims_output_prefix)
    if configured:
        return configured
    upload_prefix = _strip_slashes(settings.oss_upload_prefix)
    return f"{upload_prefix}/ims-hls" if upload_prefix else "magic-videos/ims-hls"


def _output_extension() -> str:
    value = (settings.aliyun_ims_output_extension or "m3u8").strip().lower().lstrip(".")
    return value or "m3u8"


def _build_oss_media_url(bucket: str, object_key: str) -> str:
    return f"oss://{bucket}/{_strip_slashes(object_key)}"


def _object_key_from_file_url(file_url: str, expected_bucket: str = "") -> str:
    value = (file_url or "").strip()
    if not value:
        return ""
    expected_bucket = (expected_bucket or "").strip()
    if value.startswith("oss://"):
        path = value[len("oss://") :]
        bucket, _, object_key = path.partition("/")
        if expected_bucket and bucket and bucket != expected_bucket:
            return ""
        return _strip_slashes(unquote(object_key))
    parsed = urlparse(value)
    if parsed.scheme in {"http", "https"}:
        return _strip_slashes(unquote(parsed.path or ""))
    return ""


def _build_output_key(video_id: int) -> tuple[str, str]:
    output_prefix = f"{_output_root_prefix()}/{int(video_id)}/{uuid.uuid4().hex}"
    extension = _output_extension()
    output_name = "index" if extension == "m3u8" else "low"
    return output_prefix, f"{output_prefix}/{output_name}.{extension}"


def _to_map(value: Any) -> dict[str, Any]:
    if value is None:
        return {}
    if hasattr(value, "to_map"):
        return value.to_map() or {}
    if isinstance(value, dict):
        return value
    return {}


def _raise_ims_client_error(exc: Exception) -> None:
    code = str(getattr(exc, "code", "") or "")
    message = str(getattr(exc, "message", "") or str(exc))
    request_id = str(getattr(exc, "request_id", "") or "")
    suffix = f" RequestId: {request_id}" if request_id else ""
    if code == "InvalidStorage.NotFound":
        raise HTTPException(
            status_code=502,
            detail=(
                "阿里云 IMS 还没有登记当前 OSS Bucket，无法提交云转码。"
                "请在智能媒体服务控制台 > 配置管理 > 存储管理中添加当前 OSS 存储地址后重试。"
                f"{suffix}"
            ),
        ) from exc
    raise HTTPException(status_code=502, detail=f"阿里云 IMS 调用失败：{code or message}{suffix}") from exc


def _make_client():
    try:
        from alibabacloud_ice20201109.client import Client as IceClient
        from alibabacloud_tea_openapi import models as open_api_models
    except ImportError as exc:
        raise HTTPException(
            status_code=500,
            detail="缺少阿里云 IMS SDK，请先安装 alibabacloud-ice20201109。",
        ) from exc

    ims_settings = _require_ims_base_settings()
    config = open_api_models.Config(
        access_key_id=ims_settings["access_key_id"],
        access_key_secret=ims_settings["access_key_secret"],
        region_id=ims_settings["region"],
        endpoint=f"ice.{ims_settings['region']}.aliyuncs.com",
    )
    return IceClient(config)


def _submit_ims_job(
    *,
    video_id: int,
    title: str,
    input_media: str,
    output_media: str,
) -> dict[str, Any]:
    from alibabacloud_ice20201109 import models as ice_models

    ims_settings = _require_ims_settings()
    schedule_config = ice_models.SubmitTranscodeJobRequestScheduleConfig(
        pipeline_id=(settings.aliyun_ims_pipeline_id or "").strip() or None,
        priority=max(1, min(int(settings.aliyun_ims_priority or 5), 10)),
    )
    request = ice_models.SubmitTranscodeJobRequest(
        client_token=f"magic-video-{video_id}-{uuid.uuid4().hex}",
        name=(title or f"magic-video-{video_id}")[:128],
        input_group=[
            ice_models.SubmitTranscodeJobRequestInputGroup(type="OSS", media=input_media),
        ],
        output_group=[
            ice_models.SubmitTranscodeJobRequestOutputGroup(
                output=ice_models.SubmitTranscodeJobRequestOutputGroupOutput(
                    type="OSS",
                    media=output_media,
                ),
                process_config=ice_models.SubmitTranscodeJobRequestOutputGroupProcessConfig(
                    transcode=ice_models.SubmitTranscodeJobRequestOutputGroupProcessConfigTranscode(
                        template_id=ims_settings["template_id"],
                    ),
                ),
            ),
        ],
        schedule_config=schedule_config,
    )
    try:
        response = _make_client().submit_transcode_job(request)
    except Exception as exc:  # noqa: BLE001
        _raise_ims_client_error(exc)
    body = _to_map(getattr(response, "body", None))
    parent_job = body.get("TranscodeParentJob") or {}
    parent_job_id = str(parent_job.get("ParentJobId") or "").strip()
    if not parent_job_id:
        raise HTTPException(status_code=502, detail="阿里云 IMS 未返回转码任务 ID。")
    return {
        "parent_job_id": parent_job_id,
        "status": str(parent_job.get("Status") or "Init"),
        "percent": int(parent_job.get("Percent") or 0),
        "raw": body,
    }


def _get_ims_job(parent_job_id: str) -> dict[str, Any]:
    from alibabacloud_ice20201109 import models as ice_models

    request = ice_models.GetTranscodeJobRequest(parent_job_id=parent_job_id)
    response = _make_client().get_transcode_job(request)
    body = _to_map(getattr(response, "body", None))
    parent_job = body.get("TranscodeParentJob") or {}
    transcode_jobs = parent_job.get("TranscodeJobList") or []
    child_job = transcode_jobs[0] if transcode_jobs else {}
    status = str(child_job.get("Status") or parent_job.get("Status") or "Init")
    percent = int(parent_job.get("Percent") or 0)
    submit_result = child_job.get("SubmitResultJson") or {}
    out_file_meta = child_job.get("OutFileMeta") or {}
    file_basic_info = out_file_meta.get("FileBasicInfo") or {}
    file_url = str(file_basic_info.get("FileUrl") or "")
    error_message = (
        submit_result.get("Message")
        or submit_result.get("ErrorMessage")
        or submit_result.get("Code")
        or ""
    )
    return {
        "status": status,
        "percent": percent,
        "error_message": str(error_message or ""),
        "file_url": file_url,
        "raw": body,
    }


def _normalize_ims_status(status: str) -> str:
    value = (status or "").strip().lower()
    if value == "success":
        return "completed"
    if value == "fail":
        return "failed"
    if value == "deleted":
        return "cancelled"
    if value == "processing":
        return "processing"
    return "pending"


def _public_transcode_payload(video: MagicVideo, **extra: Any) -> dict[str, Any]:
    payload = {
        "video_id": int(video.id),
        "transcode_enabled": True,
        "provider": IMS_PROVIDER,
        "transcode_provider": video.transcode_provider or IMS_PROVIDER,
        "transcode_status": (video.transcode_status or "none").strip().lower(),
        "transcode_error": video.transcode_error or "",
        "transcode_progress": int(video.transcode_progress or 0),
        "transcode_job_id": video.transcode_job_id or "",
        "hls_url": video.hls_url or "",
        "hls_object_prefix": video.hls_object_prefix or "",
    }
    payload.update(extra)
    return payload


async def submit_video_ims_transcode(video_id: int, *, force: bool = False) -> dict[str, Any]:
    _require_ims_settings()
    oss_settings = _ensure_oss_settings()
    async with session_scope() as db:
        video = await db.get(MagicVideo, int(video_id))
        if not video or video.deleted_at is not None:
            raise HTTPException(status_code=404, detail="视频不存在。")
        status = (video.transcode_status or "none").strip().lower()
        if status in RUNNING_STATUSES and (video.transcode_job_id or "").strip() and not force:
            return _public_transcode_payload(video, queued=True, submitted=False)
        if status == "completed" and not force:
            return _public_transcode_payload(video, queued=False, submitted=False)
        if (video.storage_type or "").strip().lower() != "oss" or not (video.oss_object_key or "").strip():
            raise HTTPException(status_code=400, detail="只有已上传到 OSS 的视频才能提交阿里云转码。")
        if (video.upload_status or "completed").strip().lower() != "completed":
            raise HTTPException(status_code=400, detail="视频尚未上传完成，不能提交转码。")
        input_media = _build_oss_media_url(video.oss_bucket or oss_settings["bucket"], video.oss_object_key)
        output_prefix, output_key = _build_output_key(int(video.id))
        output_media = _build_oss_media_url(oss_settings["bucket"], output_key)
        title = video.title or video.file_name or f"magic-video-{video.id}"
        object_key_snapshot = (video.oss_object_key or "").strip()

    submit_result = await asyncio.to_thread(
        _submit_ims_job,
        video_id=int(video_id),
        title=title,
        input_media=input_media,
        output_media=output_media,
    )

    async with session_scope() as db:
        video = await db.get(MagicVideo, int(video_id))
        if not video or video.deleted_at is not None:
            raise HTTPException(status_code=404, detail="视频不存在。")
        if (video.oss_object_key or "").strip() != object_key_snapshot:
            raise HTTPException(status_code=409, detail="视频文件已变更，请重新提交转码。")
        video.transcode_provider = IMS_PROVIDER
        video.transcode_job_id = submit_result["parent_job_id"]
        video.transcode_output_prefix = output_prefix
        video.transcode_output_key = output_key
        video.transcode_status = "pending"
        video.transcode_progress = max(1, int(submit_result.get("percent") or 0))
        video.transcode_error = ""
        video.transcode_started_at = _now()
        video.transcoded_at = None
        return _public_transcode_payload(video, queued=True, submitted=True)


async def sync_video_ims_transcode(video_id: int) -> dict[str, Any]:
    _require_ims_base_settings()
    async with session_scope() as db:
        video = await db.get(MagicVideo, int(video_id))
        if not video or video.deleted_at is not None:
            raise HTTPException(status_code=404, detail="视频不存在。")
        job_id = (video.transcode_job_id or "").strip()
        local_status = (video.transcode_status or "none").strip().lower()
        if not job_id or local_status not in RUNNING_STATUSES:
            return _public_transcode_payload(video, synced=False)
        output_key = (video.transcode_output_key or "").strip()
        output_prefix = (video.transcode_output_prefix or "").strip()
        output_bucket = (video.oss_bucket or settings.oss_bucket or "").strip()

    remote = await asyncio.to_thread(_get_ims_job, job_id)
    next_status = _normalize_ims_status(remote.get("status", ""))
    percent = max(0, min(int(remote.get("percent") or 0), 100))
    remote_output_key = _object_key_from_file_url(str(remote.get("file_url") or ""), output_bucket)

    async with session_scope() as db:
        video = await db.get(MagicVideo, int(video_id))
        if not video or video.deleted_at is not None:
            raise HTTPException(status_code=404, detail="视频不存在。")
        if (video.transcode_job_id or "").strip() != job_id:
            return _public_transcode_payload(video, synced=False)
        video.transcode_provider = IMS_PROVIDER
        video.transcode_progress = 100 if next_status == "completed" else max(int(video.transcode_progress or 0), percent)
        video.transcode_status = next_status
        if next_status == "completed":
            final_output_key = remote_output_key or output_key
            final_output_prefix = final_output_key.rsplit("/", 1)[0] if "/" in final_output_key else output_prefix
            video.transcode_output_key = final_output_key
            video.transcode_output_prefix = final_output_prefix
            video.hls_object_prefix = final_output_prefix if final_output_key.lower().endswith(".m3u8") else ""
            video.hls_url = _build_delivery_object_url(final_output_key)
            video.play_url = video.hls_url
            video.cdn_url = video.hls_url
            video.transcode_error = ""
            video.transcoded_at = _now()
        elif next_status == "failed":
            video.transcode_error = remote.get("error_message") or "阿里云 IMS 转码失败，请到阿里云控制台查看详情。"
        elif next_status == "cancelled":
            video.transcode_error = "阿里云 IMS 任务已删除。"
        return _public_transcode_payload(video, synced=True, remote_status=remote.get("status", ""))


async def cancel_video_ims_transcode(video_id: int) -> dict[str, Any]:
    async with session_scope() as db:
        video = await db.get(MagicVideo, int(video_id))
        if not video or video.deleted_at is not None:
            raise HTTPException(status_code=404, detail="视频不存在。")
        status = (video.transcode_status or "none").strip().lower()
        output_prefix = (video.transcode_output_prefix or "").strip()
        if status not in RUNNING_STATUSES:
            return _public_transcode_payload(video, cancelled=False)
        has_completed_hls = bool((video.hls_url or "").strip())
        video.transcode_job_id = ""
        video.transcode_output_prefix = ""
        video.transcode_output_key = ""
        video.transcode_progress = 100 if has_completed_hls else 0
        if has_completed_hls:
            video.transcode_status = "completed"
            video.transcode_error = "已取消新的云转码跟踪，继续使用原低流量文件。"
        else:
            video.transcode_status = "cancelled"
            video.transcode_error = "已取消本系统中的云转码任务；如阿里云已开始处理，云端可能仍会完成并产生费用。"
        payload = _public_transcode_payload(video, cancelled=True)

    if output_prefix:
        try:
            await asyncio.to_thread(_delete_oss_prefix, output_prefix)
        except Exception:  # noqa: BLE001
            logger.exception("Failed to cleanup cancelled IMS output prefix video_id=%s", video_id)
    return payload
