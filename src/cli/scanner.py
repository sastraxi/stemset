"""File scanning and hash tracking utilities."""

from __future__ import annotations

import asyncio
from pathlib import Path

from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from ..db.config import get_engine
from ..db.models import AudioFile, Profile
from ..utils import compute_file_hash, derive_output_name

AUDIO_EXTENSIONS = {".wav", ".wave"}


async def scan_for_new_files_async(
    profile_name: str, source_path: Path, media_path: Path
) -> list[tuple[Path, str]]:
    """Scan source folder for new audio files that haven't been processed.

    Queries the database to check if files have already been processed.

    Args:
        profile_name: Name of the profile
        source_path: Source folder to scan
        media_path: Media output folder (unused, kept for compatibility)

    Returns:
        List of tuples (file_path, output_folder_name) for unprocessed files
    """
    if not source_path.exists():
        print(f"Warning: Source folder does not exist: {source_path}")
        return []

    new_files = []
    engine = get_engine()

    async with AsyncSession(engine) as session:
        # Get the profile from database
        result = await session.exec(select(Profile).where(Profile.name == profile_name))
        profile = result.first()
        if not profile:
            print(f"Warning: Profile '{profile_name}' not found in database")
            return []

        # Recursively find all audio files
        for ext in AUDIO_EXTENSIONS:
            for file_path in source_path.rglob(f"*{ext}"):
                # Skip hidden files and system files
                if any(part.startswith(".") for part in file_path.parts):
                    continue

                # Compute hash of file contents
                try:
                    file_hash = compute_file_hash(file_path)
                except Exception as e:
                    print(f"Error hashing file {file_path}: {e}")
                    continue

                # Check if we've already processed this content (query database)
                result = await session.exec(
                    select(AudioFile).where(AudioFile.file_hash == file_hash)
                )
                existing_audio_file = result.first()

                if existing_audio_file:
                    print(
                        f"Skipping already processed file: {file_path.name} " +
                        f"(hash: {file_hash[:8]})"
                    )
                    continue

                # New file - derive output name with hash suffix for uniqueness
                base_output_name = derive_output_name(file_path)
                output_name = f"{base_output_name}_{file_hash[:8]}"

                new_files.append((file_path, output_name))

    return new_files


def scan_for_new_files(source_path: Path, media_path: Path, profile_name: str) -> list[tuple[Path, str]]:
    """Synchronous wrapper for scan_for_new_files_async.

    Args:
        source_path: Source folder to scan
        media_path: Media output folder
        profile_name: Name of the profile

    Returns:
        List of tuples (file_path, output_folder_name) for unprocessed files
    """
    return asyncio.run(scan_for_new_files_async(profile_name, source_path, media_path))
