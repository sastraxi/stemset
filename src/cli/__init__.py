"""CLI entrypoint for stemset administrative commands."""

from __future__ import annotations

import asyncio
import os
from pathlib import Path
from uuid import UUID

import typer
from dotenv import load_dotenv
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from ..config import load_config
from ..db.config import get_engine
from ..db.models import Profile, Recording
from ..db.operations import delete_recording
from ..processor.local import process_locally

app = typer.Typer(
    name="stemset",
    help="AI-powered audio stem separation tool",
    no_args_is_help=True,
)


@app.command("version")
def version() -> None:
    """Print the current version of stemset."""
    typer.echo("stemset version v0")


@app.command("reprocess")
def reprocess(recording_id: UUID) -> None:
    """Reprocess a recording from scratch.

    Args:
        recording_id: UUID of the recording to reprocess
    """

    async def _reprocess() -> None:
        config = load_config()
        config.backend_url = os.getenv("BACKEND_URL") or "http://localhost:8000"
        typer.echo(f"Reprocessing recording {recording_id}...")
        await process_locally(recording_id, config)
        typer.echo(f"Reprocessing for {recording_id} complete.")

    asyncio.run(_reprocess())


@app.command("delete")
def delete(recording_id: str) -> None:
    """Delete a recording and all associated stems, files, and user configs.

    Args:
        recording_id: UUID or name of the recording to delete
    """

    async def _delete() -> None:
        engine = get_engine()

        args = {}
        try:
            args["recording_id"] = UUID(recording_id)
        except ValueError:
            args["display_name"] = recording_id

        async with AsyncSession(engine, expire_on_commit=False) as session:
            try:
                recording = await delete_recording(session, **args)  # pyright: ignore[reportUnknownArgumentType]
                msg = (
                    f"✓ Deleted recording '{recording.display_name}' ({recording.output_name}) "
                    f"with {len(recording.stems)} stem(s)"
                )
                typer.echo(msg)
            except ValueError as e:
                typer.echo(f"Error: {e}", err=True)
                raise typer.Exit(code=1)

    asyncio.run(_delete())


@app.command("cleanup")
def cleanup() -> None:
    """Delete WAV files for all successfully completed recordings.

    This frees up disk space while preserving final output files.
    WAV files are kept for incomplete/failed recordings to enable reprocessing.
    """

    async def _cleanup() -> None:
        engine = get_engine()

        async with AsyncSession(engine, expire_on_commit=False) as session:
            # Fetch all successfully completed recordings
            stmt = (
                select(Recording, Profile).join(Profile).where(Recording.converted_at.isnot(None))
            )  # pyright: ignore[reportAttributeAccessIssue]
            result = await session.exec(stmt)
            recordings_with_profiles = result.all()

            if not recordings_with_profiles:
                typer.echo("No completed recordings found.")
                return

            total_deleted = 0
            total_freed_bytes = 0

            for recording, profile in recordings_with_profiles:
                output_dir = Path("media") / profile.name / recording.output_name

                if not output_dir.exists():
                    continue

                # Find all WAV files in the output directory
                wav_files = list(output_dir.glob("*.wav"))

                for wav_file in wav_files:
                    try:
                        file_size = wav_file.stat().st_size
                        wav_file.unlink()
                        total_deleted += 1
                        total_freed_bytes += file_size
                    except OSError as e:
                        typer.echo(f"Warning: Failed to delete {wav_file}: {e}", err=True)

            if total_deleted > 0:
                freed_mb = total_freed_bytes / (1024 * 1024)
                typer.echo(
                    f"✓ Deleted {total_deleted} WAV file(s), freed {freed_mb:.2f} MB of disk space"
                )
            else:
                typer.echo("No WAV files found to clean up.")

    asyncio.run(_cleanup())


def main() -> None:
    """Main CLI entrypoint."""
    # Load .env file if it exists (doesn't override existing env vars)
    _ = load_dotenv()
    app()


if __name__ == "__main__":
    main()
