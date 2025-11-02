"""Profile and file management endpoints."""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from uuid import UUID

from litestar import delete, get, patch
from litestar.exceptions import NotFoundException
from pydantic import BaseModel
from sqlalchemy.orm import selectinload
from sqlmodel import desc, select
from sqlmodel.ext.asyncio.session import AsyncSession

from ..db.config import get_engine
from ..db.models import Location, Profile as DBProfile, Recording, Song
from ..db.operations import delete_recording
from .models import FileWithStems, LocationMetadata, ProfileResponse, SongMetadata, StemResponse


@get("/api/profiles")
async def get_profiles() -> list[ProfileResponse]:
    """Get all configured profiles from database."""
    engine = get_engine()

    async with AsyncSession(engine, expire_on_commit=False) as session:
        result = await session.exec(select(DBProfile))
        profiles = result.all()

        return [ProfileResponse(id=str(p.id), name=p.name, source_folder=p.source_folder) for p in profiles]


@get("/api/profiles/{profile_name:str}")
async def get_profile(profile_name: str) -> ProfileResponse:
    """Get a specific profile by name from database."""
    engine = get_engine()

    async with AsyncSession(engine, expire_on_commit=False) as session:
        result = await session.exec(select(DBProfile).where(DBProfile.name == profile_name))
        profile = result.first()

        if profile is None:
            raise NotFoundException(detail=f"Profile '{profile_name}' not found")

        return ProfileResponse(id=str(profile.id), name=profile.name, source_folder=profile.source_folder)


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

        # Query recordings with stems, song, and location (use selectinload to avoid N+1)
        stmt = (
            select(Recording)
            .where(Recording.profile_id == profile.id)
            .options(
                selectinload(Recording.stems),  # pyright: ignore[reportArgumentType]
                selectinload(Recording.song),  # pyright: ignore[reportArgumentType]
                selectinload(Recording.location),  # pyright: ignore[reportArgumentType]
            )
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
                        profile_name, recording.output_name, stem.stem_type, Path(stem.audio_url).suffix
                    ),
                    waveform_url=storage.get_waveform_url(
                        profile_name, recording.output_name, stem.stem_type
                    ),
                    file_size_bytes=stem.file_size_bytes,
                    duration_seconds=stem.duration_seconds,
                )
                for stem in recording.stems
            ]

            # Use status from Recording table (not Job table - that's gone!)
            status = recording.status if recording.status in ("processing", "error") else None

            files.append(
                FileWithStems(
                    id=str(recording.id),
                    name=recording.output_name,
                    display_name=recording.display_name,
                    stems=stems,
                    created_at=recording.created_at.isoformat(),
                    status=status,
                    song=(
                        SongMetadata(id=str(recording.song.id), name=recording.song.name)
                        if recording.song
                        else None
                    ),
                    location=(
                        LocationMetadata(
                            id=str(recording.location.id), name=recording.location.name
                        )
                        if recording.location
                        else None
                    ),
                    date_recorded=(
                        recording.date_recorded.isoformat() if recording.date_recorded else None
                    ),
                    # config omitted - client should fetch via GET /api/recordings/{id}
                )
            )

        return files


class UpdateDisplayNameRequest(BaseModel):
    """Request to update display name."""

    display_name: str


class UpdateDisplayNameResponse(BaseModel):
    """Response for updating display name."""

    display_name: str
    updated_at: str


@patch("/api/profiles/{profile_name:str}/files/{output_name:str}/display-name")
async def update_display_name(
    profile_name: str, output_name: str, data: UpdateDisplayNameRequest
) -> UpdateDisplayNameResponse:
    """Update the display name for a recording."""
    engine = get_engine()

    async with AsyncSession(engine, expire_on_commit=False) as session:
        # Get profile
        result = await session.exec(select(DBProfile).where(DBProfile.name == profile_name))
        profile = result.first()
        if profile is None:
            raise NotFoundException(detail=f"Profile '{profile_name}' not found")

        # Get recording
        stmt = select(Recording).where(
            Recording.profile_id == profile.id, Recording.output_name == output_name
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

        return UpdateDisplayNameResponse(
            display_name=recording.display_name,
            updated_at=recording.updated_at.isoformat(),
        )


@delete("/api/recordings/{recording_id:uuid}")
async def delete_recording_endpoint(recording_id: UUID) -> None:
    """Delete a recording and all its associated files from storage."""
    engine = get_engine()

    async with AsyncSession(engine, expire_on_commit=False) as session:
        try:
            _ = await delete_recording(session, recording_id)
        except ValueError as e:
            raise NotFoundException(detail=str(e))

        return None
