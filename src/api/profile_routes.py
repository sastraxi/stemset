"""Profile and file management endpoints."""

from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from litestar import delete, get, patch
from litestar.connection import Request
from litestar.exceptions import NotFoundException
from pydantic import BaseModel
from sqlalchemy.orm import selectinload
from sqlmodel import desc, select
from sqlmodel.ext.asyncio.session import AsyncSession

from ..db.config import get_engine
from ..db.models import Job, Recording, RecordingUserConfig, User
from ..db.models import Profile as DBProfile
from ..storage import get_storage
from .models import FileWithStems, ProfileResponse, RecordingConfigData, StemResponse
from .types import AuthenticatedUser


@get("/api/profiles")
async def get_profiles() -> list[ProfileResponse]:
    """Get all configured profiles from database."""
    engine = get_engine()

    async with AsyncSession(engine, expire_on_commit=False) as session:
        result = await session.exec(select(DBProfile))
        profiles = result.all()

        return [ProfileResponse(name=p.name, source_folder=p.source_folder) for p in profiles]


@get("/api/profiles/{profile_name:str}")
async def get_profile(profile_name: str) -> ProfileResponse:
    """Get a specific profile by name from database."""
    engine = get_engine()

    async with AsyncSession(engine, expire_on_commit=False) as session:
        result = await session.exec(select(DBProfile).where(DBProfile.name == profile_name))
        profile = result.first()

        if profile is None:
            raise NotFoundException(detail=f"Profile '{profile_name}' not found")

        return ProfileResponse(name=profile.name, source_folder=profile.source_folder)


def _build_config_data(configs: Sequence[RecordingUserConfig]) -> RecordingConfigData:
    """Build RecordingConfigData from database records.

    Uses setattr to avoid repetitive if-statements - easily extensible for new config keys.
    """
    config_data = RecordingConfigData()
    for config in configs:
        # Dynamically set attributes based on config_key
        if hasattr(config_data, config.config_key):
            setattr(config_data, config.config_key, config.config_value)
    return config_data


@get("/api/profiles/{profile_name:str}/files")
async def get_profile_files(profile_name: str) -> list[FileWithStems]:
    """Get all processed files for a profile (metadata only, no config).

    For full recording data with config, use GET /api/recordings/{recording_id}
    """
    engine = get_engine()

    async with AsyncSession(engine, expire_on_commit=False) as session:
        # Get profile
        result = await session.exec(select(DBProfile).where(DBProfile.name == profile_name))
        profile = result.first()
        if profile is None:
            raise NotFoundException(detail=f"Profile '{profile_name}' not found")

        # Query recordings with stems (use selectinload to avoid N+1)
        stmt = (
            select(Recording)
            .where(Recording.profile_id == profile.id)
            .options(selectinload(Recording.stems))  # pyright: ignore[reportArgumentType]
            .order_by(desc(Recording.created_at))
        )
        result = await session.exec(stmt)
        recordings = result.all()

        files = []

        # Get storage backend for generating URLs
        from ..storage import get_storage

        storage = get_storage()

        for recording in recordings:
            stems = [
                StemResponse(
                    stem_type=stem.stem_type,
                    measured_lufs=stem.measured_lufs,
                    peak_amplitude=stem.peak_amplitude,
                    stem_gain_adjustment_db=stem.stem_gain_adjustment_db,
                    audio_url=storage.get_file_url(
                        profile_name, recording.output_name, stem.stem_type, ".opus"
                    ),
                    waveform_url=storage.get_waveform_url(
                        profile_name, recording.output_name, stem.stem_type
                    ),
                    file_size_bytes=stem.file_size_bytes,
                    duration_seconds=stem.duration_seconds,
                )
                for stem in recording.stems
            ]

            files.append(
                FileWithStems(
                    id=str(recording.id),
                    name=recording.output_name,
                    display_name=recording.display_name,
                    stems=stems,
                    created_at=recording.created_at.isoformat(),
                    # config omitted - client should fetch via GET /api/recordings/{id}
                )
            )

        return files


@get("/api/recordings/{recording_id:uuid}")
async def get_recording(
    recording_id: UUID, request: Request[AuthenticatedUser, Any, Any]
) -> FileWithStems:
    """Get a single recording with stems and user-specific config.

    This is the primary endpoint for loading a recording's full data when the user navigates to it.
    """
    engine = get_engine()

    async with AsyncSession(engine, expire_on_commit=False) as session:
        # Get recording with stems
        stmt = (
            select(Recording)
            .where(Recording.id == recording_id)
            .options(selectinload(Recording.stems))  # pyright: ignore[reportArgumentType]
        )
        result = await session.exec(stmt)
        recording = result.first()

        if recording is None:
            raise NotFoundException(detail=f"Recording not found: {recording_id}")

        # Get profile for storage URL generation
        profile_result = await session.exec(
            select(DBProfile).where(DBProfile.id == recording.profile_id)
        )
        profile = profile_result.first()
        if not profile:
            raise NotFoundException(detail="Profile not found for recording")

        # Get user from request (populated by auth middleware)
        user = request.user

        # Fetch user config for this recording
        config_data = RecordingConfigData()
        user_result = await session.exec(select(User).where(User.email == user.email))
        db_user = user_result.first()

        if db_user:
            config_stmt = select(RecordingUserConfig).where(
                RecordingUserConfig.user_id == db_user.id,
                RecordingUserConfig.recording_id == recording.id,
            )
            config_result = await session.exec(config_stmt)
            configs = config_result.all()
            config_data = _build_config_data(configs)

        # Get storage backend for generating URLs
        from ..storage import get_storage

        storage = get_storage()

        stems = [
            StemResponse(
                stem_type=stem.stem_type,
                measured_lufs=stem.measured_lufs,
                peak_amplitude=stem.peak_amplitude,
                stem_gain_adjustment_db=stem.stem_gain_adjustment_db,
                audio_url=storage.get_file_url(
                    profile.name, recording.output_name, stem.stem_type, ".opus"
                ),
                waveform_url=storage.get_waveform_url(
                    profile.name, recording.output_name, stem.stem_type
                ),
                file_size_bytes=stem.file_size_bytes,
                duration_seconds=stem.duration_seconds,
            )
            for stem in recording.stems
        ]

        return FileWithStems(
            id=str(recording.id),
            name=recording.output_name,
            display_name=recording.display_name,
            stems=stems,
            created_at=recording.created_at.isoformat(),
            config=config_data,
        )


class UpdateDisplayNameRequest(BaseModel):
    """Request to update display name."""

    display_name: str


@patch("/api/profiles/{profile_name:str}/files/{output_name:str}/display-name")
async def update_display_name(
    profile_name: str, output_name: str, data: UpdateDisplayNameRequest
) -> FileWithStems:
    """Update the display name for a recording (returns metadata only, no config)."""
    engine = get_engine()

    async with AsyncSession(engine, expire_on_commit=False) as session:
        # Get profile
        result = await session.exec(select(DBProfile).where(DBProfile.name == profile_name))
        profile = result.first()
        if profile is None:
            raise NotFoundException(detail=f"Profile '{profile_name}' not found")

        # Get recording
        stmt = (
            select(Recording)
            .where(Recording.profile_id == profile.id, Recording.output_name == output_name)
            .options(selectinload(Recording.stems))  # pyright: ignore[reportArgumentType]
        )
        result = await session.exec(stmt)
        recording = result.first()

        if recording is None:
            raise NotFoundException(detail=f"Recording '{output_name}' not found")

        # Update display name and updated_at timestamp
        recording.display_name = data.display_name
        recording.updated_at = datetime.now(timezone.utc)

        await session.commit()
        await session.refresh(recording)

        # Return updated recording (metadata only)
        from ..storage import get_storage

        storage = get_storage()

        stems = [
            StemResponse(
                stem_type=stem.stem_type,
                measured_lufs=stem.measured_lufs,
                peak_amplitude=stem.peak_amplitude,
                stem_gain_adjustment_db=stem.stem_gain_adjustment_db,
                audio_url=storage.get_file_url(
                    profile_name, recording.output_name, stem.stem_type, ".opus"
                ),
                waveform_url=storage.get_waveform_url(
                    profile_name, recording.output_name, stem.stem_type
                ),
                file_size_bytes=stem.file_size_bytes,
                duration_seconds=stem.duration_seconds,
            )
            for stem in recording.stems
        ]

        return FileWithStems(
            id=str(recording.id),
            name=recording.output_name,
            display_name=recording.display_name,
            stems=stems,
            created_at=recording.created_at.isoformat(),
            # config omitted - client should refetch if needed
        )


@delete("/api/recordings/{recording_id:uuid}")
async def delete_recording(recording_id: UUID) -> None:
    """Delete a recording and all its associated files from storage."""
    engine = get_engine()

    async with AsyncSession(engine, expire_on_commit=False) as session:
        # Get recording with profile and stems
        stmt = (
            select(Recording)
            .where(Recording.id == recording_id)
            .options(selectinload(Recording.stems))  # pyright: ignore[reportArgumentType]
        )
        result = await session.exec(stmt)
        recording = result.first()

        if recording is None:
            raise NotFoundException(detail=f"Recording not found: {recording_id}")

        # Get profile for storage operations
        profile_result = await session.exec(
            select(DBProfile).where(DBProfile.id == recording.profile_id)
        )
        profile = profile_result.first()
        if not profile:
            raise NotFoundException(detail="Profile not found for recording")

        storage = get_storage()

        # Delete all stem files from storage
        if hasattr(storage, "delete_file"):
            for stem in recording.stems:
                # Delete audio file
                try:
                    storage.delete_file(
                        profile.name, recording.output_name, stem.stem_type, ".opus"
                    )
                except Exception as e:
                    print(f"Warning: Could not delete audio file for stem {stem.stem_type}: {e}")

                # Delete waveform file
                try:
                    storage.delete_file(
                        profile.name, recording.output_name, stem.stem_type, "_waveform.png"
                    )
                except Exception as e:
                    print(f"Warning: Could not delete waveform file for stem {stem.stem_type}: {e}")

            # Delete metadata file
            try:
                storage.delete_file(profile.name, recording.output_name, "", "metadata.json")
            except Exception as e:
                print(f"Warning: Could not delete metadata file: {e}")

        # Delete from database
        # First delete all stems
        for stem in recording.stems:
            await session.delete(stem)

        # Delete any user configs for this recording
        config_stmt = select(RecordingUserConfig).where(
            RecordingUserConfig.recording_id == recording.id
        )
        config_result = await session.exec(config_stmt)
        for config in config_result.all():
            await session.delete(config)

        # Delete the associated job
        job = select(Job).where(Job.recording_id == recording.id)
        job_result = await session.exec(job)
        job_record = job_result.first()
        if job_record:
            await session.delete(job_record)

        # Delete the recording itself
        await session.delete(recording)

        await session.commit()

        return None
