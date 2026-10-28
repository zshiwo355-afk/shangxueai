"""管理员发放的商城积分与学习积分隔离；余额、库存、订单在同一事务更新。"""
from __future__ import annotations

import asyncio
import hashlib
import io
import json
import math
import uuid
import warnings
from datetime import datetime, timezone
from typing import Annotated, Any, Literal
from urllib.parse import unquote, urlsplit

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.dialects.mysql import insert as mysql_insert

from .auth import get_current_user, require_admin
from .db import get_db
from .magic_academy_api._oss import (
    MAX_READING_IMAGE_SIZE,
    _build_object_key_and_name,
    _build_oss_object_url,
    _ensure_oss_settings,
    _upload_binary_to_oss,
)
from .models import MallAccount, MallDanmaku, MallGrant, MallProduct, MallRedemption, User

router = APIRouter(prefix="/api/mall", tags=["mall"])
admin_router = APIRouter(prefix="/api/admin/mall", tags=["admin-mall"])
POINT_VALUE_YUAN = 20
MAX_ACCOUNT_POINTS = 9_000_000_000_000
MALL_HIDDEN_RANKING_USERNAMES = ("admin", "superadmin")
RequestId = Annotated[str, Field(min_length=8, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")]
Price = Annotated[int, Field(strict=True, ge=20, le=2_000_000_000, multiple_of=20)]


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None, microsecond=0)


def _iso(value: datetime | None) -> str | None:
    return value.replace(tzinfo=timezone.utc).isoformat(timespec="seconds") if value else None


def _name(user: User) -> str:
    return user.display_name or user.real_name or user.username


def _image_url(value: str) -> str:
    value = value.strip()
    if not value:
        return ""
    decoded = unquote(value)
    if any(ord(char) < 32 for char in decoded) or "\\" in decoded:
        raise ValueError("图片地址格式不正确。")
    parsed = urlsplit(value)
    if parsed.username or parsed.password or parsed.fragment:
        raise ValueError("图片地址不能包含账号信息或片段。")
    if parsed.scheme == "https" and parsed.hostname:
        return value
    if (
        not parsed.scheme and not parsed.netloc and not parsed.query
        and decoded.startswith("/assets/") and ".." not in decoded.split("/")
    ):
        return value
    raise ValueError("图片地址须为 HTTPS 或系统 /assets/ 静态图片路径。")


class ProductPayload(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=2000)
    image_url: str = Field(default="", max_length=2048)
    price_yuan: Price
    stock: int = Field(strict=True, ge=0, le=1_000_000_000)
    enabled: bool = True
    request_id: RequestId | None = None

    _validate_image = field_validator("image_url")(_image_url)


class GrantPayload(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    user_id: int = Field(strict=True, gt=0)
    points: int = Field(strict=True, ge=1, le=1_000_000_000)
    remark: str = Field(min_length=1, max_length=500)
    request_id: RequestId


class CreateProductPayload(ProductPayload):
    request_id: RequestId


class UpdateProductPayload(ProductPayload):
    expected_version: int = Field(strict=True, ge=1)


class RedemptionPayload(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    product_id: int = Field(strict=True, gt=0)
    expected_price_yuan: Price
    request_id: RequestId


class DanmakuPayload(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    content: str = Field(min_length=1, max_length=50)


def _danmaku(row: MallDanmaku, viewer_id: int) -> dict[str, Any]:
    return {
        "id": row.id, "user_name": row.user_name, "content": row.content,
        "created_at": _iso(row.created_at), "is_mine": row.user_id == viewer_id,
    }


def _danmaku_cooldown(last_sent: datetime | None, now: datetime) -> int:
    return max(0, min(5, math.ceil(5 - (now - last_sent).total_seconds()))) if last_sent else 0


def _product(row: MallProduct) -> dict[str, Any]:
    return {
        "id": row.id, "name": row.name, "description": row.description,
        "image_url": row.image_url, "price_yuan": row.price_yuan,
        "points_cost": row.price_yuan // POINT_VALUE_YUAN, "stock": row.stock,
        "enabled": row.enabled, "version": row.version, "created_at": _iso(row.created_at),
    }


def _redemption(row: MallRedemption) -> dict[str, Any]:
    return {
        "id": row.id, "code": row.code, "user_id": row.user_id,
        "user_name": row.user_name, "department": row.department,
        "product_id": row.product_id, "product_name": row.product_name,
        "image_url": row.image_url, "price_yuan": row.price_yuan,
        "points_cost": row.points_cost, "status": row.status,
        "created_at": _iso(row.created_at), "redeemed_at": _iso(row.redeemed_at),
        "redeemed_by_name": row.redeemed_by_name,
    }


def _grant(row: MallGrant) -> dict[str, Any]:
    return {
        "id": row.id, "user_id": row.user_id, "points": row.points,
        "remark": row.remark, "created_at": _iso(row.created_at),
        "balance_points": row.balance_after, "total_points": row.total_after,
        "user_name": row.user_name, "department": row.department, "operator_name": row.operator_name,
    }


async def _page(db: AsyncSession, statement: Any, page: int, page_size: int):
    total = (await db.execute(select(func.count()).select_from(statement.order_by(None).subquery()))).scalar_one()
    rows = (await db.execute(statement.offset((page - 1) * page_size).limit(page_size))).all()
    return rows, {"total": int(total), "page": page, "page_size": page_size}


async def _lock_users(db: AsyncSession, *user_ids: int) -> dict[int, User]:
    # Grant and redemption share this lock, including the first grant before an account exists.
    rows = (await db.execute(
        select(User).where(User.id.in_(set(user_ids))).order_by(User.id)
        .with_for_update().execution_options(populate_existing=True)
    )).scalars().all()
    return {row.id: row for row in rows}


async def _account(db: AsyncSession, user_id: int) -> MallAccount:
    # Insert first: locking a missing row would gap-lock other users' first grants.
    await db.execute(mysql_insert(MallAccount).values(
        user_id=user_id, balance_points=0, total_points=0,
    ).on_duplicate_key_update(user_id=user_id))
    # A locking read sees the latest committed balance under MySQL REPEATABLE READ.
    row = (await db.execute(
        select(MallAccount).where(MallAccount.user_id == user_id)
        .with_for_update().execution_options(populate_existing=True)
    )).scalar_one_or_none()
    return row


async def _summary(db: AsyncSession, user: User) -> dict[str, Any]:
    account = await db.get(MallAccount, user.id)
    balance = int(account.balance_points) if account else 0
    total = int(account.total_points) if account else 0
    rank = None
    # Exclude only the two built-in accounts, not employees with admin roles.
    if not user.disabled and user.username.lower() not in MALL_HIDDEN_RANKING_USERNAMES:
        score = func.coalesce(MallAccount.total_points, 0)
        above = (await db.execute(
            select(func.count()).select_from(User).outerjoin(MallAccount, MallAccount.user_id == User.id)
            .where(
                User.disabled.is_(False), User.username.not_in(MALL_HIDDEN_RANKING_USERNAMES),
                or_(score > total, and_(score == total, User.id < user.id)),
            )
        )).scalar_one()
        rank = int(above) + 1
    return {
        "balance_points": balance, "total_points": total, "redeemed_points": total - balance,
        "rank": rank, "point_value_yuan": POINT_VALUE_YUAN,
    }


@router.get("/danmaku")
async def list_danmaku(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    rows = (await db.execute(select(MallDanmaku).order_by(MallDanmaku.id.desc()).limit(100))).scalars().all()
    last_sent = (await db.execute(
        select(MallDanmaku.created_at).where(MallDanmaku.user_id == user.id)
        .order_by(MallDanmaku.id.desc()).limit(1)
    )).scalar_one_or_none()
    return {
        "items": [_danmaku(row, user.id) for row in reversed(rows)],
        "cooldown_seconds": _danmaku_cooldown(last_sent, datetime.now(timezone.utc).replace(tzinfo=None)),
    }


@router.post("/danmaku")
async def send_danmaku(payload: DanmakuPayload, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    owner = (await _lock_users(db, user.id)).get(user.id)
    if owner is None or owner.disabled:
        raise HTTPException(403, "账号已不可用。")
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    # Insert before the range read: locking a missing history would gap-lock
    # other accounts' first sends. A rejected send rolls this insert back.
    row = MallDanmaku(user_id=owner.id, user_name=_name(owner), content=payload.content, created_at=now)
    db.add(row)
    await db.flush()
    # Authentication has opened a REPEATABLE READ snapshot; a locking read sees
    # the previous sender's commit after the shared users-row lock is acquired.
    last_sent = (await db.execute(
        select(MallDanmaku.created_at).where(MallDanmaku.user_id == owner.id, MallDanmaku.id < row.id)
        .order_by(MallDanmaku.id.desc()).limit(1).with_for_update()
    )).scalar_one_or_none()
    cooldown = _danmaku_cooldown(last_sent, now)
    if cooldown:
        raise HTTPException(429, f"发送太快，请 {cooldown} 秒后再试。", headers={"Retry-After": str(cooldown)})
    return _danmaku(row, user.id)


@router.get("/summary")
async def summary(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    return await _summary(db, user)


@admin_router.get("/users/{user_id}/summary")
async def admin_user_summary(user_id: int, db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)):
    target = await db.get(User, user_id)
    if target is None:
        raise HTTPException(404, "用户不存在。")
    return await _summary(db, target)


@router.get("/leaderboard")
async def leaderboard(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    score = func.coalesce(MallAccount.total_points, 0)
    rows = (await db.execute(
        select(User, score).outerjoin(MallAccount, MallAccount.user_id == User.id)
        .where(User.disabled.is_(False), User.username.not_in(MALL_HIDDEN_RANKING_USERNAMES))
        .order_by(score.desc(), User.id.asc()).limit(10)
    )).all()
    items = [
        {"user_id": person.id, "name": _name(person), "department": person.department,
         "total_points": int(points), "rank": index}
        for index, (person, points) in enumerate(rows, 1)
    ]
    mine = await _summary(db, user)
    return {"items": items, "me": {
        "user_id": user.id, "name": _name(user), "department": user.department,
        "total_points": mine["total_points"], "balance_points": mine["balance_points"], "rank": mine["rank"],
    }}


@router.get("/products")
async def products(
    filter: Literal["all", "affordable"] = "all",
    page: int = Query(1, ge=1), page_size: int = Query(12, ge=1, le=100),
    db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user),
):
    statement = select(MallProduct).where(MallProduct.enabled.is_(True))
    if filter == "affordable":
        account = await db.get(MallAccount, user.id)
        balance = int(account.balance_points) if account else 0
        statement = statement.where(MallProduct.stock > 0, MallProduct.price_yuan <= balance * POINT_VALUE_YUAN)
    rows, paging = await _page(db, statement.order_by(MallProduct.id.desc()), page, page_size)
    return {"items": [_product(row[0]) for row in rows], **paging}


@admin_router.get("/products")
async def admin_products(
    page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin),
):
    rows, paging = await _page(db, select(MallProduct).order_by(MallProduct.id.desc()), page, page_size)
    return {"items": [_product(row[0]) for row in rows], **paging}


@admin_router.post("/products")
async def create_product(payload: CreateProductPayload, db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)):
    values = payload.model_dump(exclude={"request_id"})
    fingerprint = hashlib.sha256(json.dumps(values, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    await _lock_users(db, admin.id)
    result = await db.execute(mysql_insert(MallProduct).values(
        **values, created_by=admin.id, request_id=payload.request_id,
        create_payload_hash=fingerprint, created_at=_now(),
    ).on_duplicate_key_update(id=func.last_insert_id(MallProduct.id)))
    row = (await db.execute(select(MallProduct).where(MallProduct.id == result.lastrowid)
                            .with_for_update().execution_options(populate_existing=True))).scalar_one()
    if row.create_payload_hash != fingerprint:
        raise HTTPException(409, "该请求编号已用于其他商品内容，请刷新后重试。")
    return _product(row)


@admin_router.put("/products/{product_id}")
async def update_product(product_id: int, payload: UpdateProductPayload, db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)):
    row = (await db.execute(select(MallProduct).where(MallProduct.id == product_id)
                            .with_for_update().execution_options(populate_existing=True))).scalar_one_or_none()
    if row is None:
        raise HTTPException(404, "商品不存在。")
    if row.version != payload.expected_version:
        raise HTTPException(409, "商品信息或库存已变动，请刷新后重新编辑。")
    values = payload.model_dump(exclude={"request_id", "expected_version"})
    for field, value in values.items():
        setattr(row, field, value)
    row.version += 1
    await db.flush()
    return _product(row)


@admin_router.post("/grants")
async def grant_points(payload: GrantPayload, db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)):
    users = await _lock_users(db, admin.id, payload.user_id)
    target = users.get(payload.user_id)
    result = await db.execute(mysql_insert(MallGrant).values(
        user_id=payload.user_id, points=payload.points, remark=payload.remark,
        operator_id=admin.id, request_id=payload.request_id, balance_after=0, total_after=0, created_at=_now(),
        user_name=_name(target) if target else "", department=(target.department or "") if target else "",
        operator_name=_name(admin),
    ).on_duplicate_key_update(id=func.last_insert_id(MallGrant.id)))
    row = (await db.execute(select(MallGrant).where(MallGrant.id == result.lastrowid)
                            .with_for_update().execution_options(populate_existing=True))).scalar_one()
    if (row.user_id, row.points, row.remark) != (payload.user_id, payload.points, payload.remark):
        raise HTTPException(409, "该请求编号已用于其他积分发放，请刷新后重试。")
    # A successful positive grant always has total_after > 0; 0 exists only inside this transaction.
    if row.total_after > 0:
        return _grant(row)
    if target is None or target.disabled:
        raise HTTPException(404, "用户不存在或已禁用。")
    account = await _account(db, target.id)
    if account.total_points + payload.points > MAX_ACCOUNT_POINTS:
        raise HTTPException(400, "累计积分已超过允许范围。")
    account.balance_points += payload.points
    account.total_points += payload.points
    row.balance_after = account.balance_points
    row.total_after = account.total_points
    await db.flush()
    return _grant(row)


@admin_router.get("/grants")
async def grants(
    keyword: str = Query("", max_length=128), page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin),
):
    statement = select(MallGrant)
    if keyword.strip():
        statement = statement.where(MallGrant.user_name.contains(keyword.strip(), autoescape=True))
    rows, paging = await _page(db, statement.order_by(MallGrant.id.desc()), page, page_size)
    return {"items": [_grant(row[0]) for row in rows], **paging}


@router.post("/redemptions")
async def redeem(payload: RedemptionPayload, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    users = await _lock_users(db, user.id)
    owner = users.get(user.id)
    if owner is None or owner.disabled:
        raise HTTPException(403, "账号已不可用。")
    new_code = "DH" + uuid.uuid4().hex[:24].upper()
    result = await db.execute(mysql_insert(MallRedemption).values(
        code=new_code, user_id=owner.id, user_name=_name(owner), department=owner.department or "",
        product_id=payload.product_id, product_name="", image_url="", price_yuan=payload.expected_price_yuan,
        points_cost=payload.expected_price_yuan // POINT_VALUE_YUAN, request_id=payload.request_id,
        status="pending", created_at=_now(), redeemed_by_name="",
    ).on_duplicate_key_update(id=func.last_insert_id(MallRedemption.id)))
    row = (await db.execute(select(MallRedemption).where(MallRedemption.id == result.lastrowid)
                            .with_for_update().execution_options(populate_existing=True))).scalar_one()
    if (row.user_id, row.product_id, row.price_yuan, row.request_id) != (user.id, payload.product_id, payload.expected_price_yuan, payload.request_id):
        raise HTTPException(409, "该请求编号已用于其他兑换，请刷新后重试。")
    if row.code != new_code:
        return _redemption(row)
    product = (await db.execute(select(MallProduct).where(MallProduct.id == payload.product_id)
                                .with_for_update().execution_options(populate_existing=True))).scalar_one_or_none()
    if product is None or not product.enabled:
        raise HTTPException(409, "商品已下架或不存在，请刷新商城。")
    if product.price_yuan != payload.expected_price_yuan:
        raise HTTPException(409, "商品价格已变动，请刷新后重新确认兑换。")
    if product.stock <= 0:
        raise HTTPException(409, "商品已兑完。")
    account = await _account(db, user.id)
    cost = product.price_yuan // POINT_VALUE_YUAN
    if account.balance_points < cost:
        raise HTTPException(409, "可用积分不足。")
    account.balance_points -= cost
    product.stock -= 1
    product.version += 1
    row.product_name = product.name
    row.image_url = product.image_url
    await db.flush()
    return _redemption(row)


@router.get("/redemptions")
async def redemptions(
    page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user),
):
    statement = select(MallRedemption).where(MallRedemption.user_id == user.id).order_by(MallRedemption.id.desc())
    rows, paging = await _page(db, statement, page, page_size)
    return {"items": [_redemption(row[0]) for row in rows], **paging}


@admin_router.get("/redemptions")
async def admin_redemptions(
    keyword: str = Query("", max_length=128), status: Literal["", "pending", "redeemed"] = "",
    page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin),
):
    statement = select(MallRedemption)
    if status:
        statement = statement.where(MallRedemption.status == status)
    if keyword.strip():
        statement = statement.where(or_(MallRedemption.code.contains(keyword.strip(), autoescape=True),
                                       MallRedemption.user_name.contains(keyword.strip(), autoescape=True)))
    rows, paging = await _page(db, statement.order_by(MallRedemption.id.desc()), page, page_size)
    return {"items": [_redemption(row[0]) for row in rows], **paging}


@admin_router.post("/redemptions/{redemption_id}/verify")
async def verify(redemption_id: int, db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)):
    row = (await db.execute(select(MallRedemption).where(MallRedemption.id == redemption_id)
                            .with_for_update().execution_options(populate_existing=True))).scalar_one_or_none()
    if row is None:
        raise HTTPException(404, "兑换记录不存在。")
    if row.status == "pending":
        row.status = "redeemed"
        row.redeemed_at = _now()
        row.redeemed_by = admin.id
        row.redeemed_by_name = _name(admin)
        await db.flush()
    elif row.status != "redeemed":
        raise HTTPException(409, "当前状态不能核销。")
    return _redemption(row)


@admin_router.post("/images")
async def upload_image(file: UploadFile = File(...), admin: User = Depends(require_admin)):
    raw = await file.read(MAX_READING_IMAGE_SIZE + 1)
    if not raw or len(raw) > MAX_READING_IMAGE_SIZE:
        raise HTTPException(400, "图片大小须大于 0 且不超过 10MB。")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(raw)) as picture:
                image_format = picture.format
                if image_format not in {"JPEG", "PNG", "WEBP"}:
                    raise ValueError("unsupported image")
                picture.verify()
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise HTTPException(400, "请上传有效的 JPG、PNG 或 WebP 图片。") from None
    extension, mime_type = {"JPEG": (".jpg", "image/jpeg"), "PNG": (".png", "image/png"), "WEBP": (".webp", "image/webp")}[image_format]
    key, _ = _build_object_key_and_name("mall-image" + extension, extension)
    url = _build_oss_object_url(_ensure_oss_settings()["public_base_url"], key)
    try:
        _image_url(url)
    except ValueError:
        raise HTTPException(503, "商城图片存储需要配置 HTTPS 公网地址。") from None
    await asyncio.to_thread(_upload_binary_to_oss, key, raw, mime_type)
    return {"image_url": url}
