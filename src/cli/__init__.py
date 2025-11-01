"""CLI entrypoint for stemset processing."""

from __future__ import annotations

from pathlib import Path
from typing import Annotated

from sqlmodel import Session, select
import typer
from dotenv import load_dotenv

from src.db.config import get_sync_engine
from src.db.models import Profile

from .processor import process_single_file
from .db_migrate import migrate_command
from ..config import get_config

app = typer.Typer(
    name="stemset",
    help="AI-powered audio stem separation tool",
    no_args_is_help=True,
)


@app.command(name="process")
def process_cmd(
    profile: Annotated[str, typer.Argument(help="Profile name from config.yaml")],
    file: Annotated[Path, typer.Argument(help="Specific audio file to process")],
    local: Annotated[
        bool | None,
        typer.Option(
            "--local",
            help="Process locally instead of using GPU worker (defaults to True if GPU_WORKER_URL is not set)",
        ),
    ] = None,
) -> None:
    """Processes an audio file for stem separation.

    By default, uses remote GPU processing if GPU_WORKER_URL is configured.
    Otherwise, processes locally. Use --local flag to force local processing.
    """
    # Get config and profile
    config = get_config()

    # Get profile from database
    with Session(get_sync_engine()) as session:
        stmt = select(Profile).where(Profile.name == profile)
        result = session.exec(stmt)
        db_profile = result.first()

    if db_profile is None:
        raise ValueError(f"Profile '{profile}' not found")

    # Determine processing mode:
    # 1. If --local flag is set explicitly, use local
    # 2. Otherwise, check profile.remote setting
    # 3. If profile.remote is True, require GPU worker URL
    if local is True:
        should_use_gpu = False
    elif local is False:
        should_use_gpu = True
    else:
        # Auto-detect: use remote if GPU_WORKER_URL is set
        should_use_gpu = config.gpu_worker_url is not None

    file_path = file.expanduser().resolve()
    exit_code = process_single_file(db_profile, file_path, should_use_gpu)
    raise typer.Exit(code=exit_code)


@app.command(name="migrate")
def migrate_cmd() -> None:
    """Migrate existing metadata.json files to PostgreSQL database.

    Scans all profiles in config.yaml, reads metadata.json files from media/ directories,
    and populates the database with Profile, AudioFile, Recording, and Stem records.

    Idempotent - safe to run multiple times. Will skip records that already exist.
    """
    migrate_command()


def main() -> None:
    """Main CLI entrypoint."""
    # Load .env file if it exists (doesn't override existing env vars)
    _ = load_dotenv()
    app()


if __name__ == "__main__":
    main()
