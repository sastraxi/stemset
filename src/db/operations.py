"""Database operations for recordings and related entities."""

from __future__ import annotations

import logging
from uuid import UUID

from sqlalchemy.orm import selectinload
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from .models import Profile, Recording, RecordingUserConfig

logger = logging.getLogger(__name__)


async def delete_recording(
    session: AsyncSession,
    recording_id: UUID | None = None,
    display_name: str | None = None,
) -> Recording:
    """Delete a recording and all associated data.

    This function handles:
    1. Deleting all stem database records
    2. Deleting all stem files from storage (audio + waveforms)
    3. Deleting all user-specific configs
    4. Deleting the recording database record

    Args:
        session: Active async database session
        recording_id: UUID of the recording to delete
        display_name: Display name of the recording to delete

    Returns:
        The deleted Recording object (before deletion, for metadata)

    Raises:
        ValueError: If neither recording_id nor display_name is provided
        ValueError: If recording or associated profile not found
    """
    if recording_id is None and display_name is None:
        raise ValueError("Either recording_id or display_name must be provided")

    # Get recording with stems
    recording_query = (
        select(Recording).where(Recording.id == recording_id)
        if recording_id
        else select(Recording).where(Recording.display_name == display_name)
    )

    stmt = recording_query.options(selectinload(Recording.stems))  # pyright: ignore[reportArgumentType]
    result = await session.exec(stmt)
    recording = result.first()

    print(recording)

    if recording is None:
        raise ValueError(f"Recording not found: {recording_id or display_name}")

    # Get profile for storage operations
    profile_result = await session.exec(select(Profile).where(Profile.id == recording.profile_id))
    profile = profile_result.first()
    if not profile:
        raise ValueError("Profile not found for recording")

    # Import here to avoid circular dependency
    from ..storage import get_storage

    storage = get_storage()

    # Delete all stem files from storage
    deleted_files = 0
    warnings: list[str] = []

    if hasattr(storage, "delete_file"):
        for stem in recording.stems:
            # Delete audio file
            try:
                storage.delete_file(profile.name, recording.output_name, stem.stem_type, ".opus")
                deleted_files += 1
            except Exception as e:
                msg = f"Could not delete audio file for stem {stem.stem_type}: {e}"
                logger.warning(msg)
                warnings.append(msg)

            # Delete waveform file
            try:
                storage.delete_file(
                    profile.name, recording.output_name, stem.stem_type, "_waveform.png"
                )
                deleted_files += 1
            except Exception as e:
                msg = f"Could not delete waveform file for stem {stem.stem_type}: {e}"
                logger.warning(msg)
                warnings.append(msg)

    # Log deletion summary
    if warnings:
        logger.info(f"Deleted {deleted_files} files with {len(warnings)} warnings")

    # Delete from database (cascade to stems and configs)
    for stem in recording.stems:
        await session.delete(stem)

    # Delete user configs
    config_stmt = select(RecordingUserConfig).where(
        RecordingUserConfig.recording_id == recording.id
    )
    config_result = await session.exec(config_stmt)
    for config in config_result.all():
        await session.delete(config)

    # Delete the recording itself
    await session.delete(recording)
    await session.commit()

    return recording
