"""Database operations for recordings and related entities."""

from __future__ import annotations

import logging
from uuid import UUID

from sqlalchemy.orm import selectinload
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from .models import Clip, Profile, Recording, RecordingUserConfig

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

    # Delete clips associated with this recording
    clip_stmt = select(Clip).where(Clip.recording_id == recording.id)
    clip_result = await session.exec(clip_stmt)
    for clip in clip_result.all():
        await session.delete(clip)

    # Delete the recording itself
    await session.delete(recording)
    await session.commit()

    return recording


async def get_clips_for_recording(session: AsyncSession, recording_id: UUID) -> list[Clip]:
    """Get all clips for a recording.

    Args:
        session: Active async database session
        recording_id: UUID of the recording

    Returns:
        List of Clip objects
    """
    stmt = (
        select(Clip)
        .where(Clip.recording_id == recording_id)
        .order_by(Clip.start_time_sec)  # pyright: ignore[reportArgumentType]
    )
    result = await session.exec(stmt)
    return list(result.all())


async def get_clips_for_song(session: AsyncSession, song_id: UUID) -> list[Clip]:
    """Get all clips for a song.

    Args:
        session: Active async database session
        song_id: UUID of the song

    Returns:
        List of Clip objects
    """
    stmt = (
        select(Clip)
        .where(Clip.song_id == song_id)
        .order_by(Clip.start_time_sec)  # pyright: ignore[reportArgumentType]
    )
    result = await session.exec(stmt)
    return list(result.all())


async def get_clip(session: AsyncSession, clip_id: UUID) -> Clip | None:
    """Get a single clip by ID.

    Args:
        session: Active async database session
        clip_id: UUID of the clip

    Returns:
        Clip object or None if not found
    """
    stmt = select(Clip).where(Clip.id == clip_id)
    result = await session.exec(stmt)
    return result.first()


async def create_clip(
    session: AsyncSession,
    recording_id: UUID,
    start_time_sec: float,
    end_time_sec: float,
    song_id: UUID | None = None,
    display_name: str | None = None,
) -> Clip:
    """Create a new clip.

    Args:
        session: Active async database session
        recording_id: UUID of the recording this clip belongs to
        start_time_sec: Start time in seconds
        end_time_sec: End time in seconds
        song_id: Optional UUID of associated song
        display_name: Optional display name for the clip

    Returns:
        The created Clip object

    Raises:
        ValueError: If end_time_sec <= start_time_sec
    """
    if end_time_sec <= start_time_sec:
        raise ValueError("end_time_sec must be greater than start_time_sec")

    clip = Clip(
        recording_id=recording_id,
        song_id=song_id,
        start_time_sec=start_time_sec,
        end_time_sec=end_time_sec,
        display_name=display_name,
    )
    session.add(clip)
    await session.commit()
    await session.refresh(clip)
    return clip


async def update_clip(
    session: AsyncSession,
    clip_id: UUID,
    start_time_sec: float | None = None,
    end_time_sec: float | None = None,
    song_id: UUID | None = None,
    display_name: str | None = None,
) -> Clip:
    """Update a clip's properties.

    Args:
        session: Active async database session
        clip_id: UUID of the clip to update
        start_time_sec: New start time (optional)
        end_time_sec: New end time (optional)
        song_id: New song ID (optional, use explicit None to clear)
        display_name: New display name (optional, use explicit None to clear)

    Returns:
        The updated Clip object

    Raises:
        ValueError: If clip not found or invalid time range
    """
    clip = await get_clip(session, clip_id)
    if clip is None:
        raise ValueError(f"Clip {clip_id} not found")

    if start_time_sec is not None:
        clip.start_time_sec = start_time_sec
    if end_time_sec is not None:
        clip.end_time_sec = end_time_sec

    # Validate time range
    if clip.end_time_sec <= clip.start_time_sec:
        raise ValueError("end_time_sec must be greater than start_time_sec")

    if song_id is not None:
        clip.song_id = song_id
    if display_name is not None:
        clip.display_name = display_name

    await session.commit()
    await session.refresh(clip)
    return clip


async def delete_clip(session: AsyncSession, clip_id: UUID) -> Clip:
    """Delete a clip.

    Args:
        session: Active async database session
        clip_id: UUID of the clip to delete

    Returns:
        The deleted Clip object (before deletion, for metadata)

    Raises:
        ValueError: If clip not found
    """
    clip = await get_clip(session, clip_id)
    if clip is None:
        raise ValueError(f"Clip {clip_id} not found")

    await session.delete(clip)
    await session.commit()
    return clip
