"""CLI entrypoint for stemset administrative commands."""

from __future__ import annotations

import asyncio
from uuid import UUID

import typer
from dotenv import load_dotenv
from sqlmodel.ext.asyncio.session import AsyncSession

from ..db.config import get_engine
from ..db.operations import delete_recording

app = typer.Typer(
    name="stemset",
    help="AI-powered audio stem separation tool",
    no_args_is_help=True,
)


@app.command("version")
def version() -> None:
    """Print the current version of stemset."""
    typer.echo("stemset version v0")


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


def main() -> None:
    """Main CLI entrypoint."""
    # Load .env file if it exists (doesn't override existing env vars)
    _ = load_dotenv()
    app()


if __name__ == "__main__":
    main()
