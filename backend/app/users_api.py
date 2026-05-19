"""管理员用户 CRUD。"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import delete as sql_delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from .auth import md5_password, require_admin
from .db import get_db
from .models import User

router = APIRouter(prefix="/api/admin/users", tags=["admin-users"])


class UserDTO(BaseModel):
    id: int
    username: str
    display_name: str
    real_name: str
    department: str
    position: str
    role: str
    is_newcomer: bool
    status: str
    disabled: bool
    created_at: str = ""
    updated_at: str = ""


class UserCreateRequest(BaseModel):
    username: str = Field(..., min_length=1, max_length=64)
    password: str = Field(..., min_length=1, max_length=256)
    display_name: str = Field(default="", max_length=128)
    real_name: str = Field(default="", max_length=128)
    department: str = Field(default="", max_length=128)
    position: str = Field(default="", max_length=128)
    role: str = Field(default="user", max_length=16)
    is_newcomer: bool = False
    status: str = Field(default="active", max_length=16)
    disabled: bool = False

    @field_validator("username", "display_name", "real_name", "department", "position", mode="before")
    @classmethod
    def _strip(cls, v: str) -> str:
        return (v or "").strip()

    @field_validator("role")
    @classmethod
    def _role(cls, v: str) -> str:
        v = (v or "user").strip().lower()
        return v if v in ("admin", "user") else "user"

    @field_validator("status")
    @classmethod
    def _status(cls, v: str) -> str:
        v = (v or "active").strip().lower()
        return v if v in ("active", "inactive") else "active"


class UserUpdateRequest(BaseModel):
    """每个字段都是可选；None 表示不改。password 单独一字段 → 重置密码。"""
    password: str | None = Field(default=None, max_length=256)
    display_name: str | None = Field(default=None, max_length=128)
    real_name: str | None = Field(default=None, max_length=128)
    department: str | None = Field(default=None, max_length=128)
    position: str | None = Field(default=None, max_length=128)
    role: str | None = None
    is_newcomer: bool | None = None
    status: str | None = Field(default=None, max_length=16)
    disabled: bool | None = None

    @field_validator("role")
    @classmethod
    def _role(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = v.strip().lower()
        return v if v in ("admin", "user") else "user"

    @field_validator("status")
    @classmethod
    def _status(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = v.strip().lower()
        return v if v in ("active", "inactive") else "active"


def _digest(raw: str) -> str:
    raw = (raw or "").strip()
    if len(raw) == 32 and all(c in "0123456789abcdefABCDEF" for c in raw):
        return raw.lower()
    return md5_password(raw)


def _to_dto(user: User) -> UserDTO:
    return UserDTO(
        id=user.id,
        username=user.username,
        display_name=user.real_name or user.display_name or user.username,
        real_name=user.real_name or "",
        department=user.department or "",
        position=user.position or "",
        role=user.role or "user",
        is_newcomer=bool(user.is_newcomer),
        status=user.status or "active",
        disabled=bool(user.disabled),
        created_at=user.created_at.isoformat() if user.created_at else "",
        updated_at=user.updated_at.isoformat() if user.updated_at else "",
    )


@router.get("", response_model=list[UserDTO])
async def list_users(
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> list[UserDTO]:
    del admin
    result = await db.execute(select(User).order_by(User.id.asc()))
    return [_to_dto(u) for u in result.scalars().all()]


@router.post("", response_model=UserDTO)
async def create_user(
    payload: UserCreateRequest,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> UserDTO:
    del admin
    user = User(
        username=payload.username,
        password_md5=_digest(payload.password),
        display_name=payload.display_name or payload.real_name or payload.username,
        real_name=payload.real_name or payload.display_name or payload.username,
        department=payload.department or "",
        position=payload.position or "",
        role=payload.role,
        is_newcomer=payload.is_newcomer,
        status=payload.status,
        disabled=payload.disabled,
    )
    db.add(user)
    try:
        await db.flush()
    except IntegrityError as exc:
        raise HTTPException(status_code=409, detail="用户名已存在。") from exc
    # server_default 字段（created_at / updated_at）由 DB 填入，必须 refresh 后才能在 Python 对象里读到
    await db.refresh(user)
    return _to_dto(user)


@router.put("/{user_id}", response_model=UserDTO)
async def update_user(
    user_id: int,
    payload: UserUpdateRequest,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> UserDTO:
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在。")
    if payload.password is not None and payload.password.strip():
        user.password_md5 = _digest(payload.password)
    if payload.display_name is not None:
        user.display_name = payload.display_name.strip()
    if payload.real_name is not None:
        user.real_name = payload.real_name.strip()
    if payload.department is not None:
        user.department = payload.department.strip()
    if payload.position is not None:
        user.position = payload.position.strip()
    if payload.role is not None:
        # 防止把唯一管理员降级
        if user.id == admin.id and payload.role != "admin":
            raise HTTPException(status_code=400, detail="不能降级当前登录的管理员。")
        user.role = payload.role
    if payload.is_newcomer is not None:
        user.is_newcomer = payload.is_newcomer
    if payload.status is not None:
        user.status = payload.status
    if payload.disabled is not None:
        if user.id == admin.id and payload.disabled:
            raise HTTPException(status_code=400, detail="不能禁用当前登录的管理员。")
        user.disabled = payload.disabled
    await db.flush()
    # onupdate=func.now() 触发的新 updated_at 在 Python 端是过期的，refresh 一下
    await db.refresh(user)
    return _to_dto(user)


@router.delete("/{user_id}")
async def delete_user(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict:
    if user_id == admin.id:
        raise HTTPException(status_code=400, detail="不能删除当前登录的管理员。")
    res = await db.execute(sql_delete(User).where(User.id == user_id))
    if res.rowcount == 0:
        raise HTTPException(status_code=404, detail="用户不存在。")
    return {"success": True}
