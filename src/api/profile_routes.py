"""Profile and file management endpoints."""

from __future__ import annotations

from datetime import datetime, timezone

from litestar import get, patch
from litestar.exceptions import NotFoundException
from pydantic import BaseModel
from sqlalchemy.orm import selectinload
from sqlmodel import desc, select
from sqlmodel.ext.asyncio.session import AsyncSession

from ..db.config import get_engine
from ..db.models import Profile as DBProfile, Recording
from .models import FileWithStems, ProfileResponse, StemResponse


@get("/api/profiles")
async def get_profiles() -> list[ProfileResponse]:
    """Get all configured profiles from database."""
    engine = get_engine()

    async with AsyncSession(engine) as session:
        result = await session.exec(select(DBProfile))
        profiles = result.all()

        return [ProfileResponse(name=p.name, source_folder=p.source_folder) for p in profiles]


@get("/api/profiles/{profile_name:str}")
async def get_profile(profile_name: str) -> ProfileResponse:
    """Get a specific profile by name from database."""
    engine = get_engine()

    async with AsyncSession(engine) as session:
        result = await session.exec(select(DBProfile).where(DBProfile.name == profile_name))
        profile = result.first()

        if profile is None:
            raise NotFoundException(detail=f"Profile '{profile_name}' not found")

        return ProfileResponse(name=profile.name, source_folder=profile.source_folder)


@get("/api/profiles/{profile_name:str}/files")
async def get_profile_files(profile_name: str) -> list[FileWithStems]:
    """Get all processed files for a profile from database."""
    engine = get_engine()

    async with AsyncSession(engine) as session:
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
                    name=recording.output_name,
                    display_name=recording.display_name,
                    stems=stems,
                    created_at=recording.created_at.isoformat(),
                )
            )

        return files


class UpdateDisplayNameRequest(BaseModel):
    """Request to update display name."""

    display_name: str


@patch("/api/profiles/{profile_name:str}/files/{output_name:str}/display-name")
async def update_display_name(
    profile_name: str, output_name: str, data: UpdateDisplayNameRequest
) -> FileWithStems:
    """Update the display name for a recording in database."""
    engine = get_engine()

    async with AsyncSession(engine) as session:
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

        # Return updated recording
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
            name=recording.output_name,
            display_name=recording.display_name,
            stems=stems,
            created_at=recording.created_at.isoformat(),
        )
