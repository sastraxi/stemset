"""Alembic environment configuration for async PostgreSQL with SQLModel."""

from __future__ import annotations

import asyncio
import os
from logging.config import fileConfig
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config

from alembic import context
from alembic.script import ScriptDirectory
from sqlmodel import SQLModel

# Load environment variables from .env file
load_dotenv()

# Import all models so Alembic can detect them
from src.db.models import AudioFile, Profile, Recording, Stem, User, UserProfile

# this is the Alembic Config object, which provides
# access to the values within the .ini file in use.
config = context.config

# Interpret the config file for Python logging.
# This line sets up loggers basically.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Set target metadata for autogenerate support
target_metadata = SQLModel.metadata

# Get DATABASE_URL from environment (required)
database_url = os.getenv("DATABASE_URL")
if not database_url:
    raise ValueError(
        "DATABASE_URL environment variable is required. "
        "Set it to your PostgreSQL connection string (e.g., postgresql://user:pass@host/db)"
    )

# Convert postgresql:// to postgresql+asyncpg:// if needed
if database_url.startswith("postgresql://"):
    database_url = database_url.replace("postgresql://", "postgresql+asyncpg://", 1)

config.set_main_option("sqlalchemy.url", database_url)


def get_next_revision_number() -> str:
    """Get the next sequential revision number based on existing migrations."""
    script_dir = ScriptDirectory.from_config(config)
    versions_dir = Path(script_dir.versions)

    # Find all migration files with numeric prefixes
    existing_numbers = []
    for filepath in versions_dir.glob("*.py"):
        if filepath.name == "__init__.py":
            continue
        # Extract number from filenames like "001_initial_schema.py"
        parts = filepath.stem.split("_", 1)
        if parts[0].isdigit():
            existing_numbers.append(int(parts[0]))

    # Return next number, zero-padded to 3 digits
    next_num = max(existing_numbers, default=0) + 1
    return f"{next_num:03d}"


def process_revision_directives(context, revision, directives):
    """Auto-generate sequential revision IDs."""
    if config.cmd_opts and config.cmd_opts.autogenerate:
        # Only modify if autogenerate is being used
        script = directives[0]
        if script.upgrade_ops.is_empty():
            # No changes detected, don't generate migration
            directives[:] = []
        else:
            # Use sequential number as revision ID
            script.rev_id = get_next_revision_number()


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode.

    This configures the context with just a URL
    and not an Engine, though an Engine is acceptable
    here as well.  By skipping the Engine creation
    we don't even need a DBAPI to be available.

    Calls to context.execute() here emit the given string to the
    script output.

    """
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        process_revision_directives=process_revision_directives,
    )

    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    """Run migrations with the given connection."""
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        process_revision_directives=process_revision_directives,
    )

    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    """Run migrations in async mode."""
    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)

    await connectable.dispose()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode using async engine."""
    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
