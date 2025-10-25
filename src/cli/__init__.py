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
    # Get config and profile
    config = get_config()
    profile_obj = config.get_profile(profile)
    if not profile_obj:
        print(f"Error: Profile '{profile}' not found in config.yaml", file=sys.stderr)
        print(f"Available profiles: {', '.join(p.name for p in config.profiles)}", file=sys.stderr)
        raise typer.Exit(1)

    # Determine processing mode:
    # 1. If --local flag is set explicitly, use local
    # 2. Otherwise, check profile.remote setting
    # 3. If profile.remote is True, require GPU worker URL
    if local is True:
        should_use_gpu = False
    elif local is False:
        should_use_gpu = True
    else:
        # Auto-detect: use profile.remote if set, otherwise check GPU_WORKER_URL
        should_use_gpu = profile_obj.remote or (config.gpu_worker_url is not None)

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
