"""CLI entrypoint for stemset processing."""

from __future__ import annotations

from pathlib import Path
import sys
from typing import Annotated

import typer
from dotenv import load_dotenv

from .processor import process_profile, process_single_file
from ..config import get_config

app = typer.Typer(
    name="stemset",
    help="AI-powered audio stem separation tool",
    no_args_is_help=True,
)


@app.command(name="process")
def process_cmd(
    profile: Annotated[str, typer.Argument(help="Profile name from config.yaml")],
    file: Annotated[Path | None, typer.Argument(help="Specific audio file to process")] = None,
    local: Annotated[bool | None, typer.Option("--local", help="Process locally instead of using GPU worker (defaults to True if GPU_WORKER_URL is not set)")] = None,
) -> None:
    """Process audio files for stem separation.

    By default, uses remote GPU processing if GPU_WORKER_URL is configured.
    Otherwise, processes locally. Use --local flag to force local processing.

    If FILE is provided, processes that specific file.
    Otherwise, scans the profile's source folder for new files and processes them.
    """
    # Determine processing mode: auto-detect if None, otherwise use explicit flag
    config = get_config()
    should_use_gpu = local is False or (local is None and config.gpu_worker_url is not None)
    profile_obj = config.get_profile(profile)
    if not profile_obj:
        print(f"Error: Profile '{profile}' not found in config.yaml", file=sys.stderr)
        print(f"Available profiles: {', '.join(p.name for p in config.profiles)}", file=sys.stderr)
        raise typer.Exit(1)

    if file:
        # Single file mode
        file_path = file.expanduser().resolve()
        exit_code = process_single_file(profile_obj, file_path, should_use_gpu)
    else:
        # Directory scan mode
        exit_code = process_profile(profile_obj, should_use_gpu)

    raise typer.Exit(code=exit_code)


def main() -> None:
    """Main CLI entrypoint."""
    # Load .env file if it exists (doesn't override existing env vars)
    _ = load_dotenv()
    app()


if __name__ == "__main__":
    main()
