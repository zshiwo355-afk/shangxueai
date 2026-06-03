"""推送监控：notification_logs 查询。

只读接口，给管理端「推送监控」菜单使用：
- 列表分页 + 状态 / event_type / business_type / 关键词 / 时间区间筛选
- 单条详情（payload / response / error 完整 JSON 字符串）
- 概览统计（按状态 / event_type 计数，便于一眼看出失败堆积）
"""
from __future__ import annotations

import json
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import and_, delete as sql_delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from .auth import require_admin
from .db import get_db
from .models import NotificationLog, User
from .notification_service import resend_notification, resend_notifications_bulk
from .wecom_client import WecomApiError

router = APIRouter(prefix="/api/admin/notifications", tags=["admin-notifications"])


# 事件类型 → 中文标签 / 业务大类。前端筛选下拉直接读这里。
EVENT_TYPE_META: dict[str, dict[str, str]] = {
    "paper_assigned": {"label": "试卷派发通知", "category": "paper"},
    "paper_deadline_reminder": {"label": "试卷截止提醒", "category": "paper"},
    "paper_submission_received": {"label": "试卷提交进度", "category": "paper"},
    "exam_assigned": {"label": "AI通关派发", "category": "exam"},
    "exam_deadline_reminder": {"label": "AI通关截止提醒", "category": "exam"},
    "magic_video_assigned": {"label": "魔法学院课程派发", "category": "magic"},
    "magic_reading_published": {"label": "魔法学院读物派发", "category": "magic"},
}

STATUS_LABEL = {
    "pending": "待发送",
    "sent": "已发送",
    "failed": "失败",
}


class NotificationLogDTO(BaseModel):
    id: int
    channel: str
    event_type: str
    event_label: str
    business_type: str
    business_id: int | None
    status: str
    status_label: str
    recipient_user_id: int | None
    recipient_username: str = ""
    recipient_display_name: str = ""
    recipient_wecom_userid: str | None
    title: str = ""
    description: str = ""
    error: str | None = None
    sent_at: str | None = None
    created_at: str = ""
    updated_at: str = ""


class NotificationLogDetailDTO(NotificationLogDTO):
    payload_json: str | None = None
    response_json: str | None = None


class NotificationListResponse(BaseModel):
    items: list[NotificationLogDTO]
    total: int
    page: int
    page_size: int


class NotificationStats(BaseModel):
    total: int
    pending: int
    sent: int
    failed: int
    failed_recent_24h: int


class EventTypeOption(BaseModel):
    value: str
    label: str
    category: str = ""
    count: int = 0


class BulkDeletePayload(BaseModel):
    ids: list[int] = Field(default_factory=list)


class BulkResendPayload(BaseModel):
    ids: list[int] = Field(default_factory=list)


class ResendItemDTO(BaseModel):
    log_id: int
    status: str
    message: str = ""


class BulkResendResponse(BaseModel):
    sent: int
    failed: int
    skipped: int
    items: list[ResendItemDTO]


def _parse_dt(value: str | None, *, end: bool = False) -> datetime | None:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"日期格式错误：{value}") from exc
    return dt


def _peek_payload(payload_json: str | None) -> tuple[str, str]:
    """从 payload_json 里读 title/description，给前端列表展示用。"""
    if not payload_json:
        return "", ""
    try:
        data = json.loads(payload_json)
    except (TypeError, ValueError):
        return "", ""
    if not isinstance(data, dict):
        return "", ""
    return str(data.get("title") or "").strip(), str(data.get("description") or "").strip()


def _to_dto(
    row: NotificationLog,
    user: User | None,
    *,
    detail: bool = False,
) -> NotificationLogDTO:
    title, description = _peek_payload(row.payload_json)
    base = {
        "id": int(row.id),
        "channel": row.channel or "wecom",
        "event_type": row.event_type,
        "event_label": EVENT_TYPE_META.get(row.event_type, {}).get("label", row.event_type),
        "business_type": row.business_type or "",
        "business_id": int(row.business_id) if row.business_id is not None else None,
        "status": row.status or "pending",
        "status_label": STATUS_LABEL.get(row.status or "pending", row.status or "pending"),
        "recipient_user_id": int(row.recipient_user_id) if row.recipient_user_id is not None else None,
        "recipient_username": user.username if user else "",
        "recipient_display_name": (user.real_name or user.display_name or user.username) if user else "",
        "recipient_wecom_userid": row.recipient_wecom_userid,
        "title": title,
        "description": description,
        "error": row.error,
        "sent_at": row.sent_at.isoformat() if row.sent_at else None,
        "created_at": row.created_at.isoformat() if row.created_at else "",
        "updated_at": row.updated_at.isoformat() if row.updated_at else "",
    }
    if detail:
        return NotificationLogDetailDTO(
            **base,
            payload_json=row.payload_json,
            response_json=row.response_json,
        )
    return NotificationLogDTO(**base)


@router.get("", response_model=NotificationListResponse)
async def list_notifications(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    status_: str | None = Query(None, alias="status", description="pending / sent / failed"),
    event_type: str | None = Query(None),
    business_type: str | None = Query(None),
    keyword: str | None = Query(None, description="按标题 / 错误信息 / 接收人模糊搜索"),
    start_time: str | None = Query(None),
    end_time: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> NotificationListResponse:
    del admin

    conditions = []
    if status_:
        conditions.append(NotificationLog.status == status_.strip())
    if event_type:
        conditions.append(NotificationLog.event_type == event_type.strip())
    if business_type:
        conditions.append(NotificationLog.business_type == business_type.strip())
    start_dt = _parse_dt(start_time)
    end_dt = _parse_dt(end_time, end=True)
    if start_dt:
        conditions.append(NotificationLog.created_at >= start_dt)
    if end_dt:
        conditions.append(NotificationLog.created_at <= end_dt)
    if keyword:
        kw = f"%{keyword.strip()}%"
        # title 在 payload_json 里，做 LIKE；其余字段直接 LIKE
        conditions.append(
            or_(
                NotificationLog.payload_json.like(kw),
                NotificationLog.error.like(kw),
                NotificationLog.recipient_wecom_userid.like(kw),
            )
        )

    base_stmt = select(NotificationLog)
    count_stmt = select(func.count()).select_from(NotificationLog)
    if conditions:
        base_stmt = base_stmt.where(and_(*conditions))
        count_stmt = count_stmt.where(and_(*conditions))

    total = int((await db.execute(count_stmt)).scalar_one() or 0)
    rows = (
        await db.execute(
            base_stmt.order_by(NotificationLog.id.desc())
            .limit(page_size)
            .offset((page - 1) * page_size)
        )
    ).scalars().all()

    user_ids = sorted({int(r.recipient_user_id) for r in rows if r.recipient_user_id is not None})
    user_map: dict[int, User] = {}
    if user_ids:
        user_rows = await db.execute(select(User).where(User.id.in_(user_ids)))
        user_map = {int(u.id): u for u in user_rows.scalars().all()}

    items = [_to_dto(r, user_map.get(int(r.recipient_user_id)) if r.recipient_user_id else None) for r in rows]
    return NotificationListResponse(items=items, total=total, page=page, page_size=page_size)


@router.get("/stats", response_model=NotificationStats)
async def get_stats(
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> NotificationStats:
    del admin
    from datetime import timedelta

    rows = (
        await db.execute(
            select(NotificationLog.status, func.count()).group_by(NotificationLog.status)
        )
    ).all()
    bucket = {str(s or "pending"): int(c or 0) for s, c in rows}

    threshold = datetime.now() - timedelta(hours=24)
    failed_recent = int(
        (
            await db.execute(
                select(func.count())
                .select_from(NotificationLog)
                .where(
                    NotificationLog.status == "failed",
                    NotificationLog.created_at >= threshold,
                )
            )
        ).scalar_one()
        or 0
    )
    return NotificationStats(
        total=sum(bucket.values()),
        pending=bucket.get("pending", 0),
        sent=bucket.get("sent", 0),
        failed=bucket.get("failed", 0),
        failed_recent_24h=failed_recent,
    )


@router.get("/event-types", response_model=list[EventTypeOption])
async def list_event_types(
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> list[EventTypeOption]:
    """返回所有出现过的 event_type + 已知元数据 + 各自计数。

    前端筛选下拉用：哪怕新加了 event_type 没在 EVENT_TYPE_META 里登记，
    也能从这里看到（label 退化为 event_type 本身）。
    """
    del admin
    rows = (
        await db.execute(
            select(NotificationLog.event_type, func.count())
            .group_by(NotificationLog.event_type)
            .order_by(NotificationLog.event_type)
        )
    ).all()
    options: list[EventTypeOption] = []
    seen: set[str] = set()
    for event_type, count in rows:
        if not event_type:
            continue
        meta = EVENT_TYPE_META.get(event_type, {})
        options.append(
            EventTypeOption(
                value=event_type,
                label=meta.get("label", event_type),
                category=meta.get("category", ""),
                count=int(count or 0),
            )
        )
        seen.add(event_type)
    # 把还没用过、但代码里登记过的 event_type 也补进去，方便下拉提前可选
    for event_type, meta in EVENT_TYPE_META.items():
        if event_type in seen:
            continue
        options.append(
            EventTypeOption(
                value=event_type,
                label=meta.get("label", event_type),
                category=meta.get("category", ""),
                count=0,
            )
        )
    return options


@router.post("/bulk-delete")
async def bulk_delete_notifications(
    payload: BulkDeletePayload,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    """批量删除推送记录。仅清理 notification_logs 表，不影响业务数据。"""
    del admin
    ids = [int(x) for x in payload.ids if x is not None]
    if not ids:
        return {"success": True, "deleted": 0}
    res = await db.execute(sql_delete(NotificationLog).where(NotificationLog.id.in_(ids)))
    return {"success": True, "deleted": int(res.rowcount or 0)}


@router.post("/bulk-resend", response_model=BulkResendResponse)
async def bulk_resend_notifications(
    payload: BulkResendPayload,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> BulkResendResponse:
    """按 ids 批量重推。每条会重新走对应业务的 notify_*，并写一条新的日志。"""
    del admin
    ids = [int(x) for x in payload.ids if x is not None]
    if not ids:
        return BulkResendResponse(sent=0, failed=0, skipped=0, items=[])
    try:
        result = await resend_notifications_bulk(db, ids)
    except WecomApiError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return BulkResendResponse(
        sent=int(result.get("sent", 0)),
        failed=int(result.get("failed", 0)),
        skipped=int(result.get("skipped", 0)),
        items=[ResendItemDTO(**item) for item in result.get("items", [])],
    )


@router.post("/{log_id}/resend", response_model=ResendItemDTO)
async def resend_single_notification(
    log_id: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> ResendItemDTO:
    """单条重推。原日志保留作历史，重推过程会写一条新日志。"""
    del admin
    try:
        outcome = await resend_notification(db, log_id)
    except WecomApiError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return ResendItemDTO(
        log_id=outcome.log_id,
        status=outcome.status,
        message=outcome.message,
    )


@router.get("/{log_id}", response_model=NotificationLogDetailDTO)
async def get_notification_detail(
    log_id: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> NotificationLogDetailDTO:
    del admin
    row = (
        await db.execute(select(NotificationLog).where(NotificationLog.id == log_id))
    ).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="推送记录不存在。")
    user = None
    if row.recipient_user_id is not None:
        user = (
            await db.execute(select(User).where(User.id == int(row.recipient_user_id)))
        ).scalar_one_or_none()
    return _to_dto(row, user, detail=True)
