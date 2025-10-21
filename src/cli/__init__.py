"""CLI entrypoint for stemset processing."""

from __future__ import annotations

from pathlib import Path
from typing import Annotated

import typer
from dotenv import load_dotenv

from .processor import process_profile, process_single_file

app = typer.Typer(
    name="stemset",
    help="AI-powered audio stem separation tool",
    no_args_is_help=True,
)


@app.command(name="process")
def process_cmd(
    profile: Annotated[str, typer.Argument(help="Profile name from config.yaml")],
    file: Annotated[Path | None, typer.Argument(help="Specific WAV file to process")] = None,
) -> None:
    """Process audio files for stem separation.

    If FILE is provided, processes that specific file.
    Otherwise, scans the profile's source folder for new files and processes them.
    """
    if file:
        # Single file mode
        file_path = file.expanduser().resolve()
        exit_code = process_single_file(profile, file_path)
    else:
        # Directory scan mode
        exit_code = process_profile(profile)

    raise typer.Exit(code=exit_code)


def main() -> None:
    """Main CLI entrypoint."""
    # Load .env file if it exists (doesn't override existing env vars)
    _ = load_dotenv()
    app()


if __name__ == "__main__":
    main()
