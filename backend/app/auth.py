"""鉴权：MD5 密码 + JWT（HS256，30 天）。

- 密码存 md5(plaintext) 32 位小写 hex
- 登录成功后颁发 JWT，前端放 localStorage，请求带 Authorization: Bearer <token>
- get_current_user 统一从 Authorization header 或 ?access_token 取 token
- require_admin 用作管理员路由 guard
"""
from __future__ import annotations

import asyncio
import hashlib
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .access import ensure_super_admin, is_admin_like, is_super_admin
from .config import get_settings
from .db import get_db
from .models import User

router = APIRouter(prefix="/api/auth", tags=["auth"])

_settings = get_settings()


def md5_password(raw: str) -> str:
    return hashlib.md5((raw or "").encode("utf-8")).hexdigest()


def create_token(user_id: int, username: str, role: str) -> tuple[str, int]:
    now = datetime.now(tz=timezone.utc)
    exp = now + timedelta(hours=_settings.jwt_ttl_hours)
    payload = {
        "sub": str(user_id),
        "username": username,
        "role": role,
        "iat": int(now.timestamp()),
        "exp": int(exp.timestamp()),
    }
    token = jwt.encode(payload, _settings.jwt_secret, algorithm=_settings.jwt_algorithm)
    return token, int(exp.timestamp())


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, _settings.jwt_secret, algorithms=[_settings.jwt_algorithm])
    except jwt.ExpiredSignatureError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="登录已过期，请重新登录。") from exc
    except jwt.InvalidTokenError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="登录态无效。") from exc


def _extract_token(request: Request) -> str | None:
    auth = request.headers.get("authorization") or request.headers.get("Authorization")
    if auth:
        parts = auth.strip().split(" ", 1)
        if len(parts) == 2 and parts[0].lower() == "bearer":
            return parts[1].strip()
    qp = request.query_params.get("access_token")
    if qp:
        return qp.strip()
    return None


async def get_current_user(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> User:
    token = _extract_token(request)
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="未登录。")
    payload = decode_token(token)
    try:
        user_id = int(payload.get("sub") or 0)
    except (TypeError, ValueError):
        user_id = 0
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="登录态无效。")

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user or user.disabled:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="账号不存在或已禁用。")
    return user


async def require_admin(user: User = Depends(get_current_user)) -> User:
    if not is_admin_like(user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="仅管理员可访问该接口。",
        )
    return user


async def require_super_admin(user: User = Depends(get_current_user)) -> User:
    return ensure_super_admin(user)


async def ensure_builtin_super_admin(db: AsyncSession) -> None:
    username = (_settings.super_admin_username or "").strip()
    password = (_settings.super_admin_password or "").strip()
    display_name = (_settings.super_admin_name or "").strip()
    if not username or not password:
        return

    result = await db.execute(select(User).where(User.username == username))
    existing = result.scalar_one_or_none()
    if existing:
        if not is_super_admin(existing):
            existing.role = "super_admin"
            if not existing.display_name:
                existing.display_name = display_name or username
            if not existing.real_name:
                existing.real_name = display_name or username
            existing.disabled = False
            existing.status = "active"
            await db.flush()
        return

    user = User(
        username=username,
        password_md5=md5_password(password),
        display_name=display_name or username,
        real_name=display_name or username,
        department="",
        position="",
        role="super_admin",
        is_newcomer=False,
        status="active",
        disabled=False,
    )
    db.add(user)
    await db.flush()


# --------- DTO ---------


class LoginRequest(BaseModel):
    username: str = Field(..., min_length=1, max_length=64)
    # 前端约定提交 32 位 md5 小写。兼容明文：长度 != 32 时按明文做一次 md5。
    password: str = Field(..., min_length=1, max_length=256)

    @field_validator("username")
    @classmethod
    def _strip_user(cls, v: str) -> str:
        v = (v or "").strip()
        if not v:
            raise ValueError("用户名不能为空。")
        return v

    @field_validator("password")
    @classmethod
    def _strip_pwd(cls, v: str) -> str:
        v = (v or "").strip()
        if not v:
            raise ValueError("密码不能为空。")
        return v


class LoginResponse(BaseModel):
    token: str
    expires_at: int
    user: dict


class MeResponse(BaseModel):
    id: int
    username: str
    display_name: str
    real_name: str = ""
    department: str = ""
    position: str = ""
    role: str
    is_newcomer: bool = False
    status: str = "active"


# --------- routes ---------


@router.post("/login", response_model=LoginResponse)
async def login(payload: LoginRequest, db: AsyncSession = Depends(get_db)) -> LoginResponse:
    raw = payload.password
    digest = (
        raw.lower()
        if len(raw) == 32 and all(c in "0123456789abcdefABCDEF" for c in raw)
        else md5_password(raw)
    )

    result = await db.execute(select(User).where(User.username == payload.username))
    user = result.scalar_one_or_none()
    if not user or user.disabled or user.password_md5.lower() != digest.lower():
        # 防爆破：失败稍微等一下
        await asyncio.sleep(0.3)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="账号或密码错误。")

    token, exp = create_token(user.id, user.username, user.role)
    return LoginResponse(
        token=token,
        expires_at=exp,
        user={
            "id": user.id,
            "username": user.username,
            "display_name": user.real_name or user.display_name or user.username,
            "real_name": user.real_name or "",
            "department": user.department or "",
            "position": user.position or "",
            "role": user.role,
            "is_newcomer": bool(user.is_newcomer),
            "status": user.status or "active",
        },
    )


@router.get("/me", response_model=MeResponse)
async def me(user: User = Depends(get_current_user)) -> MeResponse:
    return MeResponse(
        id=user.id,
        username=user.username,
        display_name=user.real_name or user.display_name or user.username,
        real_name=user.real_name or "",
        department=user.department or "",
        position=user.position or "",
        role=user.role,
        is_newcomer=bool(user.is_newcomer),
        status=user.status or "active",
    )


@router.post("/logout")
async def logout() -> dict:
    """JWT 是无状态的，登出由前端清 token 即可；这里仅返回 ok。"""
    return {"ok": True}
