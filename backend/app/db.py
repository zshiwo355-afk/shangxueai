"""SQLAlchemy 异步引擎 + Session 工厂。

DSN 通过 backend/.env 的 DB_DSN 注入。建表由 sql/full_install.sql（或与正文等价的 sql/init.sql）一次性完成（不在代码里 create_all），
保持"代码不碰 schema、改 schema 走 SQL 文件"的边界清晰。
"""
from __future__ import annotations

from contextlib import asynccontextmanager
from typing import AsyncIterator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from .config import get_settings


class Base(DeclarativeBase):
    pass


_settings = get_settings()

engine = create_async_engine(
    _settings.db_dsn,
    echo=_settings.db_echo,
    pool_pre_ping=True,
    pool_recycle=_settings.db_pool_recycle_seconds,
    pool_size=_settings.db_pool_size,
    max_overflow=_settings.db_pool_size,
)

SessionLocal: async_sessionmaker[AsyncSession] = async_sessionmaker(
    engine,
    expire_on_commit=False,
    class_=AsyncSession,
)


async def get_db() -> AsyncIterator[AsyncSession]:
    """FastAPI 依赖：每请求一个 session，自动 commit / rollback。"""
    async with SessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


@asynccontextmanager
async def session_scope() -> AsyncIterator[AsyncSession]:
    """后台任务里手动取 session 用。"""
    async with SessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
