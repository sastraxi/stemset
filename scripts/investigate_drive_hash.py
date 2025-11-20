#!/usr/bin/env python3
"""Investigate why a specific file isn't matching in Drive migration.

This script:
1. Looks up a file by path in Google Drive (e.g., "Songs/Chalice.m4a")
2. Shows its SHA256 hash from Drive API
3. Compares with database hash for uploaded file

Usage:
    python scripts/investigate_drive_hash.py <profile_name> <drive_path>
    python scripts/investigate_drive_hash.py <profile_name> <drive_path> .env.production

Examples:
    python scripts/investigate_drive_hash.py "My Profile" "Songs/2025-08-21 - Chalice.m4a"
    python scripts/investigate_drive_hash.py "My Profile" "Chalice.m4a"  # if in root
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

# Add src to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from dotenv import load_dotenv

# Parse arguments
if len(sys.argv) < 3:
    print("Error: profile_name and drive_path required")
    print(__doc__)
    sys.exit(1)

profile_name = sys.argv[1]
drive_path = sys.argv[2]
env_file = sys.argv[3] if len(sys.argv) > 3 else ".env"

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
from src.db.models import AudioFile, Profile, User
from src.google_drive import GoogleDriveClient


async def find_file_by_path(
    client: GoogleDriveClient, root_folder_id: str, path: str
) -> tuple[str, str | None] | None:
    """Find a file in Drive by path relative to root folder.

    Args:
        client: Authenticated Drive client
        root_folder_id: Root folder to start from
        path: Path like "Songs/file.m4a" or just "file.m4a"

    Returns:
        (file_id, sha256_checksum) or None if not found
    """
    parts = path.split("/")
    current_folder_id = root_folder_id

    # Navigate through folders
    for i, part in enumerate(parts[:-1]):  # All but the last part are folders
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

    # Now search for the file in the final folder
    filename = parts[-1]
    print(f"  Looking for file: {filename}")
    page_token = None

    while True:
        file_list = await client.list_folder_contents(current_folder_id, page_token)

        for drive_file in file_list.files:
            if drive_file.name == filename:
                print(f"    Found file ID: {drive_file.id}")
                return (drive_file.id, drive_file.sha256Checksum)

        if not file_list.nextPageToken:
            break
        page_token = file_list.nextPageToken

    print(f"    File not found: {filename}")
    return None


async def investigate() -> None:
    """Investigate hash mismatch."""
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
        print(f"Looking up path: {drive_path}")
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

        # Look up file by path
        print("=" * 60)
        print("Looking up file in Google Drive")
        print("=" * 60)
        result = await find_file_by_path(
            client, profile.google_drive_folder_id, drive_path
        )

        if not result:
            print("\n✗ File not found in Google Drive at that path")
            print(f"  Path: {drive_path}")
            print("\nMake sure the path is correct (case-sensitive)")
            sys.exit(1)

        file_id, sha256 = result
        print()
        print(f"✓ File found in Drive")
        print(f"  File ID: {file_id}")
        if sha256:
            print(f"  SHA256: {sha256}")
            print(f"  SHA256 (short): {sha256[:16]}...")
        else:
            print(f"  SHA256: (not available from Drive API)")
        print()

        # Extract just the filename for database search
        filename = drive_path.split("/")[-1]

        # Search for file in database
        print("=" * 60)
        print(f"Searching database for: {filename}")
        print("=" * 60)

        audio_stmt = select(AudioFile).where(
            AudioFile.profile_id == profile.id,
            col(AudioFile.filename).like(f"%{filename}%"),
        )
        audio_result = await session.exec(audio_stmt)
        audio_files = audio_result.all()

        if not audio_files:
            print(f"✗ No files found in database matching: {filename}")
        else:
            print(f"Found {len(audio_files)} matching file(s) in database:\n")
            for audio_file in audio_files:
                print(f"  Filename: {audio_file.filename}")
                print(f"  Source type: {audio_file.source_type}")
                print(f"  Source ID: {audio_file.source_id}")
                print(f"  File hash: {audio_file.file_hash}")
                print(f"  File hash (short): {audio_file.file_hash[:16]}...")
                print()

        # Compare hashes
        if sha256 and audio_files:
            print("=" * 60)
            print("Hash Comparison")
            print("=" * 60)
            for audio_file in audio_files:
                if audio_file.file_hash == sha256:
                    print(f"✓ MATCH!")
                    print(f"  Database hash: {audio_file.file_hash}")
                    print(f"  Drive hash:    {sha256}")
                    print()
                    print("These hashes match - the migration should work.")
                    print("If it didn't match during migration, the file might already be marked as google_drive.")
                else:
                    print(f"✗ HASHES DO NOT MATCH")
                    print(f"  Database hash: {audio_file.file_hash}")
                    print(f"  Drive hash:    {sha256}")
                    print()
                    print("The file content is different between upload and Drive.")
                    print("This could happen if:")
                    print("  - File was re-encoded/transcoded")
                    print("  - File was edited after upload")
                    print("  - Different version of the file in Drive vs upload")
                print()
        elif not sha256:
            print("=" * 60)
            print("⚠ Cannot compare hashes - Drive file has no SHA256")
            print("=" * 60)


if __name__ == "__main__":
    asyncio.run(investigate())
