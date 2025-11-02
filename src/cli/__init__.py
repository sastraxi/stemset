"""CLI entrypoint for stemset administrative commands."""

from __future__ import annotations

import typer
from dotenv import load_dotenv

app = typer.Typer(
    name="stemset",
    help="AI-powered audio stem separation tool",
    no_args_is_help=True,
)


def main() -> None:
    """Main CLI entrypoint."""
    # Load .env file if it exists (doesn't override existing env vars)
    _ = load_dotenv()
    app()


if __name__ == "__main__":
    main()
