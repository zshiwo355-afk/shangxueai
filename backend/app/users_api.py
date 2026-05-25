"""管理员用户 CRUD + 分页搜索 + 批量导入 + 模板下载。"""
from __future__ import annotations

import io
from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse
from openpyxl import Workbook, load_workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import delete as sql_delete, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from .access import is_super_admin
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
        return v if v in ("super_admin", "admin", "user") else "user"

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
        return v if v in ("super_admin", "admin", "user") else "user"

    @field_validator("status")
    @classmethod
    def _status(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = v.strip().lower()
        return v if v in ("active", "inactive") else "active"


class UserPageResponse(BaseModel):
    items: list[UserDTO]
    total: int
    page: int
    page_size: int


class BulkImportSummary(BaseModel):
    total: int
    created: int
    skipped: int
    failed: int
    errors: list[str] = Field(default_factory=list)


class BulkUserIdsPayload(BaseModel):
    ids: list[int] = Field(..., min_length=1)


def _digest(raw: str) -> str:
    raw = (raw or "").strip()
    if len(raw) == 32 and all(c in "0123456789abcdefABCDEF" for c in raw):
        return raw.lower()
    return md5_password(raw)


def _to_dto(user: User) -> UserDTO:
    return UserDTO(
        id=user.id,
        username=user.username,
        display_name=user.display_name or "",
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


def _is_manageable_by(actor: User, target: User) -> bool:
    if is_super_admin(actor):
        return True
    return not is_super_admin(target)


def _assert_manageable(actor: User, target: User) -> None:
    if not _is_manageable_by(actor, target):
        raise HTTPException(status_code=403, detail="无权操作超级管理员账号。")


# ---------- 列表 / 分页搜索 ----------


@router.get("", response_model=list[UserDTO])
async def list_users(
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> list[UserDTO]:
    stmt = select(User).order_by(User.id.asc())
    if not is_super_admin(admin):
        stmt = stmt.where(User.role != "super_admin")
    result = await db.execute(stmt)
    return [_to_dto(u) for u in result.scalars().all()]


@router.get("/search", response_model=UserPageResponse)
async def search_users(
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=200),
    keyword: str | None = Query(None, description="按用户名 / 真实姓名 / 显示名模糊搜索"),
    department: str | None = Query(None, description="按部门精确筛选"),
    role: str | None = Query(None, description="可选：admin / user"),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> UserPageResponse:
    stmt = select(User)
    count_stmt = select(func.count()).select_from(User)
    if not is_super_admin(admin):
        stmt = stmt.where(User.role != "super_admin")
        count_stmt = count_stmt.where(User.role != "super_admin")

    if keyword:
        kw = f"%{keyword.strip()}%"
        cond = or_(User.username.like(kw), User.real_name.like(kw), User.display_name.like(kw))
        stmt = stmt.where(cond)
        count_stmt = count_stmt.where(cond)
    if department:
        stmt = stmt.where(User.department == department.strip())
        count_stmt = count_stmt.where(User.department == department.strip())
    if role and role.lower() in ("admin", "user"):
        stmt = stmt.where(User.role == role.lower())
        count_stmt = count_stmt.where(User.role == role.lower())

    total = (await db.execute(count_stmt)).scalar_one()
    stmt = stmt.order_by(User.id.desc()).limit(page_size).offset((page - 1) * page_size)
    rows = (await db.execute(stmt)).scalars().all()
    return UserPageResponse(
        items=[_to_dto(u) for u in rows],
        total=int(total),
        page=page,
        page_size=page_size,
    )


@router.get("/departments", response_model=list[str])
async def list_departments(
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> list[str]:
    del admin
    rows = (
        await db.execute(
            select(User.department)
            .where(User.department != "")
            .group_by(User.department)
            .order_by(User.department.asc())
        )
    ).scalars().all()
    return [d for d in rows if d]


# ---------- 模板下载 / 批量导入 ----------
# 注意：路径里包含静态字段（template / bulk-import），必须放在 /{user_id} 之前，
# 否则 FastAPI 会按声明顺序优先匹配 /{user_id}，把 "template" 当成 user_id 解析。


_USER_TEMPLATE_HEADERS = [
    "用户名*", "密码*", "真实姓名", "显示名",
    "部门", "岗位", "角色", "是否新人",
]


def _build_user_template() -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = "用户导入模板"

    header_fill = PatternFill(start_color="FFE6F0FA", end_color="FFE6F0FA", fill_type="solid")
    required_fill = PatternFill(start_color="FFFFF1F0", end_color="FFFFF1F0", fill_type="solid")
    bold = Font(bold=True)
    center = Alignment(horizontal="center", vertical="center", wrap_text=True)

    for col_idx, header in enumerate(_USER_TEMPLATE_HEADERS, start=1):
        cell = ws.cell(row=1, column=col_idx, value=header)
        cell.font = bold
        cell.alignment = center
        cell.fill = required_fill if header.endswith("*") else header_fill
        ws.column_dimensions[get_column_letter(col_idx)].width = 16

    samples = [
        ["zhangsan", "123456", "张三", "三哥", "销售一部", "招商主管", "普通用户", "否"],
        ["lisi",     "123456", "李四", "",     "销售一部", "招商专员", "普通用户", "是"],
        ["wangwu",   "abcd1234", "王五", "",   "运营部",   "运营经理", "管理员",   "否"],
    ]
    for r, row in enumerate(samples, start=2):
        for c, value in enumerate(row, start=1):
            ws.cell(row=r, column=c, value=value)

    notes = [
        "",
        "填写说明：",
        "1) 用户名 / 密码必填，用户名重复将自动跳过。",
        "2) 角色：普通用户 / 管理员（也可写英文 user / admin），默认普通用户。",
        "3) 是否新人：是 / 否（默认 否）。",
        "4) 部门 / 岗位 / 显示名 可空；显示名为空时会取真实姓名或用户名。",
        "5) 密码以明文写入，后端会做 md5 后入库。",
    ]
    for i, line in enumerate(notes, start=len(samples) + 3):
        cell = ws.cell(row=i, column=1, value=line)
        ws.merge_cells(start_row=i, end_row=i, start_column=1, end_column=len(_USER_TEMPLATE_HEADERS))
        if line.startswith("填写说明"):
            cell.font = Font(bold=True, color="FF1677FF")

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


@router.get("/template")
async def download_user_template(
    admin: User = Depends(require_admin),
):
    del admin
    data = _build_user_template()

    def _iter():
        yield data

    headers = {"Content-Disposition": 'attachment; filename="users_template.xlsx"'}
    return StreamingResponse(
        _iter(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers=headers,
    )


_ROLE_ALIASES = {
    "管理员": "admin", "admin": "admin", "administrator": "admin",
    "普通用户": "user", "user": "user", "员工": "user", "学员": "user",
}
_BOOL_TRUE = {"是", "y", "yes", "true", "1", "新人"}


def _norm_role(raw: Any) -> str:
    text = str(raw or "").strip().lower()
    return _ROLE_ALIASES.get(text, "user")


def _norm_bool(raw: Any) -> bool:
    text = str(raw or "").strip().lower()
    return text in _BOOL_TRUE


async def _read_upload_with_limit(file: UploadFile, *, limit: int = 20 * 1024 * 1024) -> bytes:
    try:
        file.file.seek(0, 2)
        size = file.file.tell()
        file.file.seek(0)
        if size > limit:
            raise HTTPException(status_code=413, detail="上传文件不能超过 20MB。")
    except HTTPException:
        raise
    except (AttributeError, OSError):
        await file.seek(0)
    content = await file.read(limit + 1)
    if len(content) > limit:
        raise HTTPException(status_code=413, detail="上传文件不能超过 20MB。")
    return content


@router.post("/bulk-import", response_model=BulkImportSummary)
async def bulk_import_users(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> BulkImportSummary:
    """上传 Excel (.xlsx) 一次性导入多个用户。

    - 用户名重复 → skipped（不覆盖）
    - 必填字段缺失 / 数据非法 → failed，错误信息记录在 errors[]
    - 其余有效行 → created
    """
    del admin
    filename = (file.filename or "").lower()
    if not filename.endswith((".xlsx", ".xls")):
        raise HTTPException(status_code=400, detail="仅支持 .xlsx 格式。")
    content = await _read_upload_with_limit(file)

    try:
        wb = load_workbook(io.BytesIO(content), data_only=True)
        ws = wb.active
        rows = list(ws.iter_rows(values_only=True))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"无法解析 Excel：{exc}") from exc

    if not rows or len(rows) < 2:
        raise HTTPException(status_code=400, detail="表格为空或没有数据行。")

    data_rows = rows[1:]
    summary = BulkImportSummary(total=0, created=0, skipped=0, failed=0)

    existing = set(
        (await db.execute(select(User.username))).scalars().all()
    )

    for idx, row in enumerate(data_rows):
        if not row or all(c is None or (isinstance(c, str) and not c.strip()) for c in row):
            continue
        summary.total += 1
        cells = list(row) + [None] * max(0, len(_USER_TEMPLATE_HEADERS) - len(row))
        username, password, real_name, display_name, department, position, role_raw, newcomer_raw = cells[:8]

        username = str(username or "").strip()
        password = str(password or "").strip()
        line_no = idx + 2

        if not username:
            summary.failed += 1
            summary.errors.append(f"第 {line_no} 行：用户名不能为空")
            continue
        if not password:
            summary.failed += 1
            summary.errors.append(f"第 {line_no} 行（{username}）：密码不能为空")
            continue
        if username in existing:
            summary.skipped += 1
            continue

        real_name = str(real_name or "").strip()
        display_name = str(display_name or "").strip() or real_name or username
        department = str(department or "").strip()
        position = str(position or "").strip()
        role = _norm_role(role_raw)
        is_newcomer = _norm_bool(newcomer_raw)

        user = User(
            username=username,
            password_md5=_digest(password),
            display_name=display_name,
            real_name=real_name or display_name,
            department=department,
            position=position,
            role=role,
            is_newcomer=is_newcomer,
            status="active",
            disabled=False,
        )
        db.add(user)
        try:
            await db.flush()
            existing.add(username)
            summary.created += 1
        except IntegrityError:
            await db.rollback()
            summary.failed += 1
            summary.errors.append(f"第 {line_no} 行（{username}）：用户名冲突或数据库异常")
            existing = set(
                (await db.execute(select(User.username))).scalars().all()
            )

    return summary


# ---------- 批量操作 ----------


@router.post("/bulk-delete")
async def bulk_delete_users(
    payload: BulkUserIdsPayload,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    rows = (
        await db.execute(select(User).where(User.id.in_(payload.ids)))
    ).scalars().all()

    deletable_ids: list[int] = []
    skipped = 0

    for user in rows:
        if user.id == admin.id or not _is_manageable_by(admin, user):
            skipped += 1
            continue
        deletable_ids.append(user.id)

    if not deletable_ids:
        return {"success": True, "deleted": 0, "skipped": skipped}

    res = await db.execute(sql_delete(User).where(User.id.in_(deletable_ids)))
    return {
        "success": True,
        "deleted": int(res.rowcount or 0),
        "skipped": skipped,
    }


# ---------- 单条 CRUD ----------


@router.get("/{user_id}", response_model=UserDTO)
async def get_user_detail(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> UserDTO:
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在。")
    _assert_manageable(admin, user)
    return _to_dto(user)


@router.post("", response_model=UserDTO)
async def create_user(
    payload: UserCreateRequest,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
) -> UserDTO:
    if payload.role == "super_admin" and not is_super_admin(admin):
        raise HTTPException(status_code=403, detail="仅超级管理员可创建超级管理员账号。")
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
    _assert_manageable(admin, user)
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
        if payload.role == "super_admin" and not is_super_admin(admin):
            raise HTTPException(status_code=403, detail="仅超级管理员可设置超级管理员角色。")
        if user.id == admin.id:
            expected_self_role = "super_admin" if is_super_admin(admin) else "admin"
            if payload.role != expected_self_role:
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
    target = await db.get(User, user_id)
    if not target:
        raise HTTPException(status_code=404, detail="用户不存在。")
    _assert_manageable(admin, target)
    res = await db.execute(sql_delete(User).where(User.id == user_id))
    if res.rowcount == 0:
        raise HTTPException(status_code=404, detail="用户不存在。")
    return {"success": True}
