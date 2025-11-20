#!/usr/bin/env python3
"""Migrate existing uploaded files to Google Drive sources.

Usage:
    python scripts/migrate_drive.py <profile_name>                  # Uses .env (default)
    python scripts/migrate_drive.py <profile_name> .env.production  # Uses specific env file
    python scripts/migrate_drive.py <profile_name> --dry-run        # Dry run with .env
    python scripts/migrate_drive.py <profile_name> .env.production --dry-run  # Dry run with specific env
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

# Add src to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from dotenv import load_dotenv

# Parse arguments
if len(sys.argv) < 2:
    print("Error: profile_name required")
    print(__doc__)
    sys.exit(1)

profile_name = sys.argv[1]
env_file = ".env"
dry_run = False

# Parse remaining arguments
for arg in sys.argv[2:]:
    if arg == "--dry-run":
        dry_run = True
    elif arg.startswith(".env"):
        env_file = arg

env_path = Path(env_file)

if not env_path.exists():
    print(f"Error: Environment file '{env_file}' not found")
    sys.exit(1)

print(f"Loading environment from: {env_file}")
load_dotenv(env_path)

from src.cli.migrate_drive import migrate_profile_drive_files
from src.config import load_config


async def main() -> None:
    """Run the migration."""
    config = load_config()
    try:
        await migrate_profile_drive_files(profile_name, config, dry_run)
    except ValueError as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
