"""Database configuration and async session management."""

from __future__ import annotations

import os
from collections.abc import AsyncGenerator

from sqlalchemy import Engine, create_engine
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, create_async_engine
from sqlmodel import SQLModel
from sqlmodel.ext.asyncio.session import AsyncSession as SQLModelAsyncSession

_async_engine: AsyncEngine | None = None
_sync_engine: Engine | None = None


def get_database_url() -> str:
    """Get and validate DATABASE_URL from environment."""
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        raise ValueError(
            "DATABASE_URL environment variable is required. "
            + "Set it to your PostgreSQL connection string (e.g., postgresql+asyncpg://user:pass@host/db)"
        )

    # Convert postgresql:// to postgresql+asyncpg:// if needed
    if database_url.startswith("postgresql://"):
        database_url = database_url.replace("postgresql://", "postgresql+asyncpg://", 1)
    elif not database_url.startswith("postgresql+asyncpg://"):
        raise ValueError(
            f"DATABASE_URL must start with 'postgresql://' or 'postgresql+asyncpg://', got: {database_url[:20]}..."
        )

    return database_url


def get_sync_engine() -> Engine:
    """Get or create the synchronous database engine (for migrations)."""
    global _sync_engine
    if _sync_engine is None:
        database_url = os.getenv("DATABASE_URL")
        if not database_url:
            raise ValueError("DATABASE_URL environment variable is required")

        # Use psycopg2 for synchronous connections
        if database_url.startswith("postgresql://"):
            database_url = database_url.replace("postgresql://", "postgresql+psycopg2://", 1)
        elif database_url.startswith("postgresql+asyncpg://"):
            database_url = database_url.replace(
                "postgresql+asyncpg://", "postgresql+psycopg2://", 1
            )

        _sync_engine = create_engine(
            database_url,
            echo=False,
            pool_pre_ping=True,
            pool_size=10,
            max_overflow=20,
        )
    return _sync_engine


def get_engine() -> AsyncEngine:
    """Get or create the async database engine."""
    global _async_engine
    if _async_engine is None:
        database_url = get_database_url()
        _async_engine = create_async_engine(
            database_url,
            echo=False,  # Set to True for SQL query logging
            pool_pre_ping=True,  # Verify connections before using
            pool_size=10,  # Number of connections to maintain
            max_overflow=20,  # Additional connections when pool is exhausted
        )
    return _async_engine


async def init_db() -> None:
    """Initialize database tables. Only call this in development or after migrations."""
    engine = get_engine()
    async with engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.create_all)


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    """Dependency injection for async database sessions.

    Usage in Litestar:
        @get("/endpoint")
        async def handler(session: AsyncSession = Depends(get_session)) -> Response:
            ...
    """
    engine = get_engine()
    async with SQLModelAsyncSession(engine) as session:
        yield session


async def close_db() -> None:
    """Close database engine. Call this on application shutdown."""
    engine = get_engine()
    await engine.dispose()
