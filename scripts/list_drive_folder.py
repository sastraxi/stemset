#!/usr/bin/env python3
"""List all files in a Google Drive folder.

Usage:
    python scripts/list_drive_folder.py <profile_name> [folder_path]
    python scripts/list_drive_folder.py <profile_name> [folder_path] .env.production

Examples:
    python scripts/list_drive_folder.py "My Profile"           # List root
    python scripts/list_drive_folder.py "My Profile" "Songs"   # List Songs folder
    python scripts/list_drive_folder.py "My Profile" "Songs/Chalice"  # List subfolder
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
folder_path = sys.argv[2] if len(sys.argv) > 2 and not sys.argv[2].startswith(".env") else ""
env_file = None

# Find env file in remaining args
for arg in sys.argv[2:]:
    if arg.startswith(".env"):
        env_file = arg
        break

if not env_file:
    env_file = ".env"

env_path = Path(env_file)

if not env_path.exists():
    print(f"Error: Environment file '{env_file}' not found")
    sys.exit(1)

print(f"Loading environment from: {env_file}")
load_dotenv(env_path)

from sqlmodel import col, select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.config import load_config
from src.db.config import get_engine
from src.db.models import Profile, User
from src.google_drive import GoogleDriveClient


async def navigate_to_folder(
    client: GoogleDriveClient, root_folder_id: str, path: str
) -> str | None:
    """Navigate to a folder by path.

    Args:
        client: Authenticated Drive client
        root_folder_id: Root folder to start from
        path: Path like "Songs/Subfolder" or empty string for root

    Returns:
        folder_id or None if not found
    """
    if not path:
        return root_folder_id

    parts = path.split("/")
    current_folder_id = root_folder_id

    for part in parts:
        print(f"  Looking for folder: {part}")
        page_token: str | None = None
        found = False

        while True:
            file_list = await client.list_folder_contents(current_folder_id, page_token)

            for drive_file in file_list.files:
                if (
                    drive_file.name == part
                    and drive_file.mimeType == "application/vnd.google-apps.folder"
                ):
                    current_folder_id = drive_file.id
                    print(f"    Found folder ID: {drive_file.id}")
                    found = True
                    break

            if found or not file_list.nextPageToken:
                break
            page_token = file_list.nextPageToken

        if not found:
            print(f"    Folder not found: {part}")
            return None

    return current_folder_id


async def list_folder() -> None:
    """List contents of a Drive folder."""
    config = load_config()
    engine = get_engine()

    async with AsyncSession(engine, expire_on_commit=False) as session:
        # Get profile
        stmt = select(Profile).where(Profile.name == profile_name)
        result = await session.exec(stmt)
        profile = result.first()

        if not profile:
            print(f"Error: Profile '{profile_name}' not found", file=sys.stderr)
            sys.exit(1)

        if not profile.google_drive_folder_id:
            print(
                f"Error: Profile '{profile_name}' has no google_drive_folder_id configured",
                file=sys.stderr,
            )
            sys.exit(1)

        print(f"Profile: {profile.name}")
        print(f"Drive folder ID: {profile.google_drive_folder_id}")
        print(f"Listing path: {folder_path or '(root)'}")
        print()

        # Get user with Drive access
        user_stmt = select(User).where(col(User.google_refresh_token).isnot(None))
        user_result = await session.exec(user_stmt)
        user = user_result.first()

        if not user or not user.google_refresh_token:
            print("Error: No user with Google Drive access found", file=sys.stderr)
            sys.exit(1)

        print(f"Using Drive credentials from: {user.email}")
        print()

        # Initialize Drive client
        client = GoogleDriveClient(config, user.google_refresh_token)

        # Navigate to folder
        print("=" * 60)
        print("Navigating to folder")
        print("=" * 60)
        target_folder_id = await navigate_to_folder(
            client, profile.google_drive_folder_id, folder_path
        )

        if not target_folder_id:
            print("\n✗ Folder not found")
            sys.exit(1)

        print()
        print("=" * 60)
        print("Folder Contents")
        print("=" * 60)

        # List all contents
        page_token: str | None = None
        file_count = 0
        folder_count = 0

        while True:
            file_list = await client.list_folder_contents(target_folder_id, page_token)

            for drive_file in file_list.files:
                if drive_file.mimeType == "application/vnd.google-apps.folder":
                    folder_count += 1
                    print(f"📁 {drive_file.name}/")
                    print(f"   ID: {drive_file.id}")
                else:
                    file_count += 1
                    print(f"📄 {drive_file.name}")
                    print(f"   ID: {drive_file.id}")
                    if drive_file.sha256Checksum:
                        print(f"   SHA256: {drive_file.sha256Checksum[:16]}...")
                    else:
                        print(f"   SHA256: (not available)")
                    if drive_file.size:
                        print(f"   Size: {drive_file.size:,} bytes")
                print()

            if not file_list.nextPageToken:
                break
            page_token = file_list.nextPageToken

        print("=" * 60)
        print(f"Total: {folder_count} folder(s), {file_count} file(s)")
        print("=" * 60)


if __name__ == "__main__":
    asyncio.run(list_folder())
