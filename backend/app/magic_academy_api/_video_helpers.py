from __future__ import annotations

from typing import Any

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..access import get_user_whitelist_permissions, is_super_admin
from ..models import (
    MagicAudioUpload,
    MagicQuestion,
    MagicVideo,
    MagicVideoProgress,
    MagicVideoQuizPoint,
    MagicVideoSeries,
    MagicVideoSeriesItem,
    MagicVideoTarget,
    MagicVideoWatchConfirmSetting,
    MagicVideoWhitelist,
    MaterialAsset,
    MaterialProject,
    User,
)
from ._utils import (
    SOURCE_MANUAL,
    SOURCE_WHITELIST_AUTO,
    SOURCE_WHITELIST_EXEMPT,
    WATCH_CONFIRM_DEFAULT_BUTTON,
    WATCH_CONFIRM_DEFAULT_MESSAGE,
    UNASSIGNED_DEPARTMENT_FILTER,
    _department_matches_filter,
    _iso,
    _json_loads,
    _now,
)


async def _get_video_or_404(db: AsyncSession, video_id: int) -> MagicVideo:
    video = await db.get(MagicVideo, video_id)
    if not video or video.deleted_at:
        raise HTTPException(status_code=404, detail="视频不存在。")
    return video


async def _get_progress(
    db: AsyncSession,
    user_id: int,
    video_id: int,
    create: bool = True,
) -> MagicVideoProgress | None:
    result = await db.execute(
        select(MagicVideoProgress).where(
            MagicVideoProgress.user_id == user_id,
            MagicVideoProgress.video_id == video_id,
        )
    )
    progress = result.scalar_one_or_none()
    if progress or not create:
        return progress
    progress = MagicVideoProgress(user_id=user_id, video_id=video_id)
    db.add(progress)
    await db.flush()
    return progress


def _reset_progress_for_quiz_version(progress: MagicVideoProgress, video: MagicVideo) -> None:
    progress.current_position = 0
    progress.max_watched_position = 0
    progress.progress_percent = 0
    progress.is_completed = False
    progress.completed_at = None
    progress.last_watched_at = None
    progress.total_duration = float(video.duration_seconds or progress.total_duration or 0)
    progress.quiz_passed = False
    progress.answered_point_ids_json = "[]"
    progress.quiz_version = int(video.quiz_version or 1)
    progress.answer_attempt_count = 0


async def _ensure_progress_quiz_version(
    db: AsyncSession,
    progress: MagicVideoProgress | None,
    video: MagicVideo,
) -> MagicVideoProgress | None:
    if not progress:
        return None
    current_version = int(video.quiz_version or 1)
    if int(progress.quiz_version or 0) <= 0:
        progress.quiz_version = current_version
        await db.flush()
        return progress
    if int(progress.quiz_version or 1) != current_version:
        _reset_progress_for_quiz_version(progress, video)
        await db.flush()
    return progress


async def _bump_video_quiz_version(db: AsyncSession, video_id: int) -> MagicVideo:
    video = await _get_video_or_404(db, video_id)
    video.quiz_version = int(video.quiz_version or 1) + 1
    await db.flush()
    return video


async def _get_video_targets(db: AsyncSession, video_ids: list[int]) -> dict[int, list[MagicVideoTarget]]:
    if not video_ids:
        return {}
    result = await db.execute(
        select(MagicVideoTarget).where(MagicVideoTarget.video_id.in_(video_ids)).order_by(MagicVideoTarget.id.asc())
    )
    mapping: dict[int, list[MagicVideoTarget]] = {}
    for item in result.scalars().all():
        mapping.setdefault(item.video_id, []).append(item)
    return mapping


async def _get_quiz_points_map(db: AsyncSession, video_ids: list[int]) -> dict[int, list[MagicVideoQuizPoint]]:
    if not video_ids:
        return {}
    result = await db.execute(
        select(MagicVideoQuizPoint)
        .where(MagicVideoQuizPoint.video_id.in_(video_ids))
        .order_by(MagicVideoQuizPoint.trigger_second.asc(), MagicVideoQuizPoint.id.asc())
    )
    mapping: dict[int, list[MagicVideoQuizPoint]] = {}
    for item in result.scalars().all():
        mapping.setdefault(item.video_id, []).append(item)
    return mapping


async def _get_questions_map(db: AsyncSession, point_ids: list[int]) -> dict[int, list[MagicQuestion]]:
    if not point_ids:
        return {}
    result = await db.execute(
        select(MagicQuestion)
        .where(MagicQuestion.quiz_point_id.in_(point_ids))
        .order_by(MagicQuestion.sort_order.asc(), MagicQuestion.id.asc())
    )
    mapping: dict[int, list[MagicQuestion]] = {}
    for item in result.scalars().all():
        mapping.setdefault(item.quiz_point_id, []).append(item)
    return mapping


async def _is_whitelisted(db: AsyncSession, video_id: int, user_id: int) -> bool:
    result = await db.execute(
        select(MagicVideoWhitelist.id).where(
            MagicVideoWhitelist.video_id == video_id,
            MagicVideoWhitelist.user_id == user_id,
        )
    )
    return result.scalar_one_or_none() is not None


def _can_seek_freely(video_whitelisted: bool, permissions: dict[str, Any]) -> bool:
    return bool(
        video_whitelisted
        or permissions.get("allow_video_seek")
        or permissions.get("course_exempt_enabled")
    )


def _is_video_upload_ready(video: MagicVideo) -> bool:
    upload_status = (video.upload_status or "completed").strip().lower()
    if upload_status != "completed":
        return False
    if (video.storage_type or "local").strip().lower() == "oss":
        return bool((video.oss_object_key or "").strip())
    return bool((video.file_path or "").strip())


def _video_status_label(video: MagicVideo) -> str:
    status = (video.status or "draft").strip().lower()
    upload_status = (video.upload_status or "completed").strip().lower()
    if upload_status == "failed":
        return "上传失败"
    if upload_status in {"pending", "uploading"}:
        return "上传中"
    if status == "published":
        return "已发布"
    if status == "disabled":
        return "已下架"
    if upload_status == "completed":
        return "已上传未发布"
    return "草稿"


def _build_progress_payload(
    video: MagicVideo,
    progress: MagicVideoProgress | None,
    permissions: dict[str, Any],
    *,
    video_whitelisted: bool = False,
) -> dict[str, Any] | None:
    if not progress and not permissions.get("course_exempt_enabled"):
        return None
    answered = _json_loads(progress.answered_point_ids_json, []) if progress else []
    current_position = float(progress.current_position or 0) if progress else 0.0
    max_watched_position = float(progress.max_watched_position or 0) if progress else 0.0
    total_duration = float(progress.total_duration or video.duration_seconds or 0) if progress else float(video.duration_seconds or 0)
    payload = {
        "current_position": current_position,
        "max_watched_position": max_watched_position,
        "progress_percent": float(progress.progress_percent or 0) if progress else 0.0,
        "is_completed": bool(progress.is_completed) if progress else False,
        "completed_at": _iso(progress.completed_at) if progress else None,
        "last_watched_at": _iso(progress.last_watched_at) if progress else None,
        "answered_point_ids": answered,
        "quiz_passed": bool(progress.quiz_passed) if progress else False,
        "answer_attempt_count": int(progress.answer_attempt_count or 0) if progress else 0,
        "source": (progress.progress_source or SOURCE_MANUAL) if progress else SOURCE_MANUAL,
        "completed_by_whitelist": bool(progress.completed_by_whitelist) if progress else False,
        "total_duration": total_duration,
    }
    if permissions.get("course_exempt_enabled"):
        payload["progress_percent"] = max(float(payload["progress_percent"] or 0), 100.0)
        payload["is_completed"] = True
        payload["quiz_passed"] = True
        payload["completed_by_whitelist"] = True
        payload["source"] = SOURCE_WHITELIST_EXEMPT
        if not payload["completed_at"]:
            payload["completed_at"] = _iso(_now())
    payload["can_seek_freely"] = _can_seek_freely(video_whitelisted, permissions)
    return payload


def _apply_whitelist_quiz_points(
    payload: dict[str, Any],
    permissions: dict[str, Any],
) -> None:
    if not permissions.get("course_exempt_enabled"):
        return
    quiz_points = payload.get("quiz_points") or []
    payload.setdefault("progress", {})
    payload["progress"]["answered_point_ids"] = [int(item["id"]) for item in quiz_points]
    payload["progress"]["quiz_passed"] = True


async def _ensure_auto_audio_checkin(
    db: AsyncSession,
    user: User,
    permissions: dict[str, Any],
) -> None:
    from datetime import date

    today = date.today()
    existing_result = await db.execute(
        select(MagicAudioUpload)
        .where(
            MagicAudioUpload.user_id == user.id,
            MagicAudioUpload.is_deleted.is_(False),
            MagicAudioUpload.uploaded_date == today,
        )
        .order_by(MagicAudioUpload.id.asc())
    )
    existing_rows = existing_result.scalars().all()
    # Historical duplicate rows can exist from earlier auto-checkin writes.
    # Keep one row and soft-delete the extras so employee/admin pages stop showing duplicates.
    if existing_rows:
        primary = existing_rows[0]
        for duplicate in existing_rows[1:]:
            duplicate.is_deleted = True
            duplicate.deleted_at = _now()
        if len(existing_rows) > 1:
            await db.flush()
        if (primary.source or "") == SOURCE_WHITELIST_AUTO:
            if not (primary.file_name or "").strip():
                primary.file_name = "whitelist_auto_checkin"
            if primary.file_size is None:
                primary.file_size = 0
            if primary.mime_type is None:
                primary.mime_type = ""
            if primary.remark is None:
                primary.remark = "白名单自动打卡"
            await db.flush()
    # Auto check-ins are no longer created on page access.
    # They are scheduled only after admin-triggered reading tasks.


def _serialize_watch_confirm_setting(
    setting: MagicVideoWatchConfirmSetting | None,
    video_id: int | None = None,
) -> dict[str, Any]:
    return {
        "video_id": int(setting.video_id if setting else video_id or 0),
        "enabled": bool(setting.enabled) if setting else False,
        "interval_seconds": int(setting.interval_seconds or 300) if setting else 300,
        "message": (setting.message or WATCH_CONFIRM_DEFAULT_MESSAGE) if setting else WATCH_CONFIRM_DEFAULT_MESSAGE,
        "button_text": (setting.button_text or WATCH_CONFIRM_DEFAULT_BUTTON) if setting else WATCH_CONFIRM_DEFAULT_BUTTON,
    }


async def _get_watch_confirm_settings_map(
    db: AsyncSession,
    video_ids: list[int],
) -> dict[int, MagicVideoWatchConfirmSetting]:
    if not video_ids:
        return {}
    result = await db.execute(
        select(MagicVideoWatchConfirmSetting).where(MagicVideoWatchConfirmSetting.video_id.in_(video_ids))
    )
    return {item.video_id: item for item in result.scalars().all()}


def _is_effectively_completed(
    progress: MagicVideoProgress | None,
    permissions: dict[str, Any] | None = None,
) -> bool:
    if permissions and permissions.get("course_exempt_enabled"):
        return True
    return bool(progress and progress.is_completed)


async def _get_series_context_map(
    db: AsyncSession,
    video_ids: list[int],
    *,
    progress_map: dict[int, MagicVideoProgress] | None = None,
    whitelist_permissions: dict[str, Any] | None = None,
) -> dict[int, dict[str, Any]]:
    if not video_ids:
        return {}
    result = await db.execute(
        select(MagicVideoSeriesItem, MagicVideoSeries)
        .join(MagicVideoSeries, MagicVideoSeries.id == MagicVideoSeriesItem.series_id)
        .where(
            MagicVideoSeriesItem.video_id.in_(video_ids),
            MagicVideoSeries.is_deleted.is_(False),
        )
        .order_by(MagicVideoSeriesItem.sort_order.asc(), MagicVideoSeriesItem.id.asc())
    )
    rows = result.all()
    by_video: dict[int, dict[str, Any]] = {}
    series_items_map: dict[int, list[dict[str, Any]]] = {}
    for item, series in rows:
        payload = {
            "series_id": int(series.id),
            "series_title": series.title,
            "series_description": series.description or "",
            "series_enabled": bool(series.enabled),
            "series_order": int(item.sort_order or 0),
            "series_item_id": int(item.id),
            "sequential_unlock_enabled": bool(series.sequential_unlock_enabled),
            "video_id": int(item.video_id),
        }
        by_video[item.video_id] = payload
        series_items_map.setdefault(series.id, []).append(payload)

    permissions = whitelist_permissions or {}
    for video_id, payload in by_video.items():
        payload["previous_video_id"] = None
        payload["previous_video_completed"] = True
        payload["is_locked"] = False
        payload["locked_reason"] = ""
        if not payload["series_enabled"] or not payload["sequential_unlock_enabled"]:
            continue
        items = series_items_map.get(payload["series_id"], [])
        current_index = next((index for index, item in enumerate(items) if item["video_id"] == video_id), -1)
        if current_index <= 0:
            continue
        previous = items[current_index - 1]
        payload["previous_video_id"] = previous["video_id"]
        previous_completed = bool(progress_map is None) or _is_effectively_completed(
            (progress_map or {}).get(previous["video_id"]),
            permissions,
        )
        payload["previous_video_completed"] = previous_completed
        if permissions.get("course_exempt_enabled"):
            continue
        if not previous_completed:
            payload["is_locked"] = True
            payload["locked_reason"] = "请先完成上一节视频后再学习本节"
    return by_video


def _apply_series_payload(payload: dict[str, Any], series_meta: dict[str, Any] | None) -> dict[str, Any]:
    if not series_meta:
        payload.setdefault("series_id", None)
        payload.setdefault("series_title", "")
        payload.setdefault("series_description", "")
        payload.setdefault("series_order", None)
        payload.setdefault("series_enabled", False)
        payload.setdefault("sequential_unlock_enabled", False)
        payload.setdefault("previous_video_id", None)
        payload.setdefault("previous_video_completed", True)
        payload.setdefault("is_locked", False)
        payload.setdefault("locked_reason", "")
        return payload
    payload.update({
        "series_id": series_meta["series_id"],
        "series_title": series_meta["series_title"],
        "series_description": series_meta["series_description"],
        "series_order": series_meta["series_order"],
        "series_enabled": series_meta["series_enabled"],
        "sequential_unlock_enabled": series_meta["sequential_unlock_enabled"],
        "previous_video_id": series_meta["previous_video_id"],
        "previous_video_completed": series_meta["previous_video_completed"],
        "is_locked": series_meta["is_locked"],
        "locked_reason": series_meta["locked_reason"],
    })
    return payload


def _user_matches_target(user: User, target: MagicVideoTarget) -> bool:
    ttype = (target.target_type or "").lower()
    tvalue = (target.target_value or "").strip()
    if ttype == "all_users":
        return True
    if ttype == "all_newcomers":
        return bool(user.is_newcomer)
    if ttype == "department":
        return (user.department or "").strip() == tvalue
    if ttype == "position":
        return (user.position or "").strip() == tvalue
    if ttype == "employment_status":
        return (user.employment_status or "").strip() == tvalue
    if ttype == "role":
        return (user.role or "").strip() == tvalue
    if ttype == "user":
        return str(user.id) == tvalue
    return False


def _video_visible_to_user(video: MagicVideo, user: User, targets: list[MagicVideoTarget], whitelisted: bool) -> bool:
    if whitelisted:
        return True
    if (user.role or "").lower() == "admin":
        return True
    if (video.upload_status or "completed") != "completed":
        return False
    if video.status != "published":
        return False
    if video.is_newcomer_required and user.is_newcomer:
        return True
    if not targets:
        return True
    return any(_user_matches_target(user, target) for target in targets)


def _video_to_dict(
    video: MagicVideo,
    targets: list[MagicVideoTarget],
    progress: MagicVideoProgress | None = None,
    whitelisted: bool = False,
    whitelist_permissions: dict[str, Any] | None = None,
    series_meta: dict[str, Any] | None = None,
    watch_confirm_setting: MagicVideoWatchConfirmSetting | None = None,
) -> dict[str, Any]:
    permissions = whitelist_permissions or {}
    status = (video.status or "draft").strip().lower()
    upload_status = (video.upload_status or "completed").strip().lower()
    progress_payload = _build_progress_payload(video, progress, permissions, video_whitelisted=whitelisted)
    payload = {
        "id": video.id,
        "title": video.title,
        "description": video.description or "",
        "category": video.category or "",
        "file_name": video.file_name,
        "file_path": video.file_path,
        "original_filename": video.original_filename or video.file_name,
        "stored_filename": video.stored_filename or "",
        "storage_type": video.storage_type or "local",
        "oss_bucket": video.oss_bucket or "",
        "oss_endpoint": video.oss_endpoint or "",
        "oss_object_key": video.oss_object_key or "",
        "oss_url": video.oss_url or "",
        "cdn_url": video.cdn_url or "",
        "play_url": video.play_url or "",
        "hls_url": video.hls_url,
        "cover_url": video.cover_url,
        "mime_type": video.mime_type,
        "file_size": int(video.file_size or 0),
        "duration_seconds": int(video.duration_seconds or 0),
        "duration": int(video.duration or video.duration_seconds or 0),
        "is_required": bool(video.is_required),
        "is_newcomer_required": bool(video.is_newcomer_required),
        "deadline_at": _iso(video.deadline_at),
        "status": status,
        "status_label": _video_status_label(video),
        "upload_status": upload_status,
        "upload_error": video.upload_error or "",
        "transcode_status": video.transcode_status or "none",
        "material_asset_id": int(video.material_asset_id) if video.material_asset_id else None,
        "can_publish": status != "published" and _is_video_upload_ready(video),
        "can_disable": status == "published",
        "created_by": video.created_by,
        "created_at": _iso(video.created_at),
        "updated_at": _iso(video.updated_at),
        "deleted_at": _iso(video.deleted_at),
        "targets": [
            {"id": item.id, "target_type": item.target_type, "target_value": item.target_value}
            for item in targets
        ],
        "progress": progress_payload,
        "is_whitelisted": whitelisted,
        "whitelist_permissions": permissions,
        "can_seek_freely": bool(progress_payload["can_seek_freely"]) if progress_payload else _can_seek_freely(whitelisted, permissions),
        "watch_confirm_setting": _serialize_watch_confirm_setting(watch_confirm_setting, video.id),
    }
    return _apply_series_payload(payload, series_meta)


def _material_project_visible_to_admin(project: MaterialProject, user: User) -> bool:
    if is_super_admin(user):
        return True
    if int(project.created_by) == int(user.id):
        return True
    visibility = (project.visibility or "admin").strip().lower()
    return visibility in {"admin", "shared"}


async def _get_material_asset_or_403(
    db: AsyncSession,
    asset_id: int,
    admin: User,
    *,
    expected_type: str,
) -> MaterialAsset:
    result = await db.execute(
        select(MaterialAsset, MaterialProject)
        .join(MaterialProject, MaterialProject.id == MaterialAsset.project_id)
        .where(
            MaterialAsset.id == asset_id,
            MaterialAsset.is_deleted.is_(False),
            MaterialProject.is_deleted.is_(False),
        )
    )
    row = result.first()
    if not row:
        raise HTTPException(status_code=404, detail="素材不存在。")
    asset, project = row
    if asset.asset_type != expected_type:
        raise HTTPException(status_code=400, detail=f"所选素材不是{expected_type}类型。")
    if not _material_project_visible_to_admin(project, admin):
        raise HTTPException(status_code=403, detail="无权访问该素材。")
    return asset


async def _collect_target_users(db: AsyncSession, video: MagicVideo, targets: list[MagicVideoTarget]) -> list[User]:
    result = await db.execute(
        select(User).where(User.role == "user", User.disabled.is_(False)).order_by(User.id.asc())
    )
    users = result.scalars().all()
    if not targets and not video.is_newcomer_required:
        return users
    visible_users = []
    for user in users:
        if video.is_newcomer_required and user.is_newcomer:
            visible_users.append(user)
            continue
        if any(_user_matches_target(user, target) for target in targets):
            visible_users.append(user)
    unique: dict[int, User] = {}
    for item in visible_users:
        unique[item.id] = item
    return list(unique.values())


def _filter_stats_users(
    users: list[User],
    department: list[str] | None = None,
    user_id: list[int] | None = None,
) -> list[User]:
    filtered = users
    if department:
        department_set = set(department)
        filtered = [
            item
            for item in filtered
            if any(_department_matches_filter(item, department_item) for department_item in department_set)
        ]
    if user_id:
        user_id_set = set(int(item) for item in user_id)
        filtered = [item for item in filtered if item.id in user_id_set]
    return filtered


async def _ensure_video_access(
    db: AsyncSession,
    video: MagicVideo,
    user: User,
    allow_admin: bool = True,
) -> tuple[list[MagicVideoTarget], bool]:
    targets_map = await _get_video_targets(db, [video.id])
    targets = targets_map.get(video.id, [])
    whitelisted = await _is_whitelisted(db, video.id, user.id)
    if allow_admin and (user.role or "").lower() == "admin":
        return targets, whitelisted
    if not _video_visible_to_user(video, user, targets, whitelisted):
        raise HTTPException(status_code=403, detail="无权访问该视频。")
    whitelist_permissions = await get_user_whitelist_permissions(db, user.id)
    series_context_map = await _get_series_context_map(
        db,
        [video.id],
        progress_map={
            item.video_id: item
            for item in (
                await db.execute(select(MagicVideoProgress).where(MagicVideoProgress.user_id == user.id))
            ).scalars().all()
        },
        whitelist_permissions=whitelist_permissions,
    )
    series_meta = series_context_map.get(video.id)
    if series_meta and series_meta.get("is_locked"):
        raise HTTPException(status_code=403, detail=series_meta.get("locked_reason") or "请先完成上一节视频。")
    return targets, whitelisted


def _series_to_dict(
    series: MagicVideoSeries,
    items: list[dict[str, Any]],
) -> dict[str, Any]:
    return {
        "id": int(series.id),
        "title": series.title,
        "description": series.description or "",
        "sequential_unlock_enabled": bool(series.sequential_unlock_enabled),
        "enabled": bool(series.enabled),
        "created_by": int(series.created_by),
        "created_at": _iso(series.created_at),
        "updated_at": _iso(series.updated_at),
        "items": items,
    }


__all__ = [
    "_get_video_or_404",
    "_get_progress",
    "_reset_progress_for_quiz_version",
    "_ensure_progress_quiz_version",
    "_bump_video_quiz_version",
    "_get_video_targets",
    "_get_quiz_points_map",
    "_get_questions_map",
    "_is_whitelisted",
    "_can_seek_freely",
    "_is_video_upload_ready",
    "_video_status_label",
    "_build_progress_payload",
    "_apply_whitelist_quiz_points",
    "_ensure_auto_audio_checkin",
    "_serialize_watch_confirm_setting",
    "_get_watch_confirm_settings_map",
    "_is_effectively_completed",
    "_get_series_context_map",
    "_apply_series_payload",
    "_user_matches_target",
    "_video_visible_to_user",
    "_video_to_dict",
    "_material_project_visible_to_admin",
    "_get_material_asset_or_403",
    "_collect_target_users",
    "_filter_stats_users",
    "_ensure_video_access",
    "_series_to_dict",
]
