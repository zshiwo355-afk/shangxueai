from __future__ import annotations

from typing import Any

from fastapi import Depends, HTTPException
from sqlalchemy import delete as sql_delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import require_admin
from ..db import get_db
from ..magic_academy_schemas import (
    VideoSeriesAddItemPayload,
    VideoSeriesPayload,
    VideoSeriesReorderPayload,
    WatchConfirmSettingPayload,
)
from ..models import (
    MagicVideo,
    MagicVideoSeries,
    MagicVideoSeriesItem,
    MagicVideoWatchConfirmSetting,
    User,
)
from . import router
from ._utils import (
    WATCH_CONFIRM_DEFAULT_BUTTON,
    WATCH_CONFIRM_DEFAULT_MESSAGE,
    _now,
)
from ._video_helpers import (
    _get_video_or_404,
    _serialize_watch_confirm_setting,
    _series_to_dict,
)


async def _build_series_list(db: AsyncSession) -> list[dict[str, Any]]:
    result = await db.execute(
        select(MagicVideoSeries)
        .where(MagicVideoSeries.is_deleted.is_(False))
        .order_by(MagicVideoSeries.created_at.desc(), MagicVideoSeries.id.desc())
    )
    series_rows = result.scalars().all()
    if not series_rows:
        return []
    series_ids = [item.id for item in series_rows]
    items_result = await db.execute(
        select(MagicVideoSeriesItem, MagicVideo)
        .join(MagicVideo, MagicVideo.id == MagicVideoSeriesItem.video_id)
        .where(
            MagicVideoSeriesItem.series_id.in_(series_ids),
            MagicVideo.deleted_at.is_(None),
        )
        .order_by(MagicVideoSeriesItem.sort_order.asc(), MagicVideoSeriesItem.id.asc())
    )
    items_map: dict[int, list[dict[str, Any]]] = {}
    for item, video in items_result.all():
        items_map.setdefault(item.series_id, []).append({
            "id": int(item.id),
            "video_id": int(video.id),
            "title": video.title,
            "category": video.category or "",
            "sort_order": int(item.sort_order or 0),
            "status": video.status,
        })
    return [_series_to_dict(item, items_map.get(item.id, [])) for item in series_rows]


async def _get_series_detail(db: AsyncSession, series_id: int) -> dict[str, Any]:
    rows = await _build_series_list(db)
    row = next((item for item in rows if item["id"] == series_id), None)
    if not row:
        raise HTTPException(status_code=404, detail="系列不存在。")
    return row


@router.get("/admin/video-series")
async def list_video_series(
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> list[dict[str, Any]]:
    del admin
    return await _build_series_list(db)


@router.post("/admin/video-series")
async def create_video_series(
    payload: VideoSeriesPayload,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    row = MagicVideoSeries(
        title=payload.title.strip(),
        description=payload.description.strip(),
        sequential_unlock_enabled=payload.sequential_unlock_enabled,
        enabled=payload.enabled,
        created_by=admin.id,
        is_deleted=False,
    )
    db.add(row)
    await db.flush()
    await db.refresh(row)
    return await _get_series_detail(db, row.id)


@router.put("/admin/video-series/{series_id}")
async def update_video_series(
    series_id: int,
    payload: VideoSeriesPayload,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    del admin
    row = await db.get(MagicVideoSeries, series_id)
    if not row or row.is_deleted:
        raise HTTPException(status_code=404, detail="系列不存在。")
    row.title = payload.title.strip()
    row.description = payload.description.strip()
    row.sequential_unlock_enabled = payload.sequential_unlock_enabled
    row.enabled = payload.enabled
    await db.flush()
    await db.refresh(row)
    return await _get_series_detail(db, series_id)


@router.delete("/admin/video-series/{series_id}")
async def delete_video_series(
    series_id: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, bool]:
    del admin
    row = await db.get(MagicVideoSeries, series_id)
    if not row or row.is_deleted:
        raise HTTPException(status_code=404, detail="系列不存在。")
    await db.execute(sql_delete(MagicVideoSeriesItem).where(MagicVideoSeriesItem.series_id == series_id))
    row.is_deleted = True
    row.deleted_at = _now()
    await db.flush()
    return {"success": True}


@router.post("/admin/video-series/{series_id}/items")
async def add_video_series_item(
    series_id: int,
    payload: VideoSeriesAddItemPayload,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    del admin
    series = await db.get(MagicVideoSeries, series_id)
    if not series or series.is_deleted:
        raise HTTPException(status_code=404, detail="系列不存在。")
    video = await _get_video_or_404(db, payload.video_id)
    if video.deleted_at is not None:
        raise HTTPException(status_code=400, detail="视频已删除，不能加入系列。")
    exists = await db.execute(
        select(MagicVideoSeriesItem).where(MagicVideoSeriesItem.video_id == payload.video_id)
    )
    existing = exists.scalar_one_or_none()
    if existing and existing.series_id != series_id:
        raise HTTPException(status_code=400, detail="该视频已加入其他系列。")
    if existing:
        raise HTTPException(status_code=400, detail="该视频已在当前系列中。")
    current_max = await db.execute(
        select(func.max(MagicVideoSeriesItem.sort_order)).where(MagicVideoSeriesItem.series_id == series_id)
    )
    next_sort = int(current_max.scalar_one() or 0) + 10
    row = MagicVideoSeriesItem(
        series_id=series_id,
        video_id=payload.video_id,
        sort_order=int(payload.sort_order if payload.sort_order is not None else next_sort),
    )
    db.add(row)
    await db.flush()
    await db.refresh(row)
    return await _get_series_detail(db, series_id)


@router.put("/admin/video-series/{series_id}/items/reorder")
async def reorder_video_series_items(
    series_id: int,
    payload: VideoSeriesReorderPayload,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    del admin
    series = await db.get(MagicVideoSeries, series_id)
    if not series or series.is_deleted:
        raise HTTPException(status_code=404, detail="系列不存在。")
    result = await db.execute(
        select(MagicVideoSeriesItem)
        .where(MagicVideoSeriesItem.series_id == series_id)
        .order_by(MagicVideoSeriesItem.sort_order.asc(), MagicVideoSeriesItem.id.asc())
    )
    items = result.scalars().all()
    item_map = {item.video_id: item for item in items}
    if set(payload.video_ids) != set(item_map):
        raise HTTPException(status_code=400, detail="排序数据不完整。")
    for index, video_id in enumerate(payload.video_ids, start=1):
        item_map[video_id].sort_order = index * 10
    await db.flush()
    return await _get_series_detail(db, series_id)


@router.delete("/admin/video-series/{series_id}/items/{video_id}")
async def remove_video_series_item(
    series_id: int,
    video_id: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, bool]:
    del admin
    result = await db.execute(
        select(MagicVideoSeriesItem).where(
            MagicVideoSeriesItem.series_id == series_id,
            MagicVideoSeriesItem.video_id == video_id,
        )
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="系列视频关系不存在。")
    await db.delete(row)
    await db.flush()
    return {"success": True}


@router.get("/admin/videos/{video_id}/watch-confirm-setting")
async def get_watch_confirm_setting(
    video_id: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    del admin
    await _get_video_or_404(db, video_id)
    result = await db.execute(
        select(MagicVideoWatchConfirmSetting).where(MagicVideoWatchConfirmSetting.video_id == video_id)
    )
    row = result.scalar_one_or_none()
    return _serialize_watch_confirm_setting(row, video_id)


@router.put("/admin/videos/{video_id}/watch-confirm-setting")
async def update_watch_confirm_setting(
    video_id: int,
    payload: WatchConfirmSettingPayload,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    del admin
    await _get_video_or_404(db, video_id)
    result = await db.execute(
        select(MagicVideoWatchConfirmSetting).where(MagicVideoWatchConfirmSetting.video_id == video_id)
    )
    row = result.scalar_one_or_none()
    if not row:
        row = MagicVideoWatchConfirmSetting(video_id=video_id)
        db.add(row)
    row.enabled = payload.enabled
    row.interval_seconds = int(payload.interval_seconds or 300)
    row.message = (payload.message or WATCH_CONFIRM_DEFAULT_MESSAGE).strip() or WATCH_CONFIRM_DEFAULT_MESSAGE
    row.button_text = (payload.button_text or WATCH_CONFIRM_DEFAULT_BUTTON).strip() or WATCH_CONFIRM_DEFAULT_BUTTON
    await db.flush()
    await db.refresh(row)
    return _serialize_watch_confirm_setting(row, video_id)
