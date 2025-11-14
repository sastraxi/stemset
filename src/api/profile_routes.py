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
from ..db.models import Clip, Recording, Song
from ..db.models import Profile as DBProfile
from ..db.operations import (
    create_clip,
    delete_clip,
    delete_recording,
    get_clip,
    get_clips_for_recording,
    get_clips_for_song,
    update_clip,
)
from .models import (
    ClipResponse,
    ClipWithStemsResponse,
    CreateClipRequest,
    FileWithStems,
    LocationMetadata,
    ProfileResponse,
    SongMetadata,
    StemResponse,
    UpdateClipRequest,
)


@get("/api/profiles")
async def get_profiles() -> list[ProfileResponse]:
    """Get all configured profiles from database."""
    engine = get_engine()

    async with AsyncSession(engine, expire_on_commit=False) as session:
        result = await session.exec(select(DBProfile))
        profiles = result.all()

        return [
            ProfileResponse(id=str(p.id), name=p.name, source_folder=p.source_folder)
            for p in profiles
        ]


@get("/api/profiles/{profile_name:str}")
async def get_profile(profile_name: str) -> ProfileResponse:
    """Get a specific profile by name from database."""
    engine = get_engine()

    async with AsyncSession(engine, expire_on_commit=False) as session:
        result = await session.exec(select(DBProfile).where(DBProfile.name == profile_name))
        profile = result.first()

        if profile is None:
            raise NotFoundException(detail=f"Profile '{profile_name}' not found")

        return ProfileResponse(
            id=str(profile.id), name=profile.name, source_folder=profile.source_folder
        )


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
                        profile_name,
                        recording.output_name,
                        stem.stem_type,
                        Path(stem.audio_url).suffix,
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


# Clip endpoints


@get("/api/recordings/{recording_id:uuid}/clips")
async def get_recording_clips(recording_id: UUID) -> list[ClipResponse]:
    """Get all clips for a recording."""
    engine = get_engine()

    async with AsyncSession(engine, expire_on_commit=False) as session:
        clips = await get_clips_for_recording(session, recording_id)

        return [
            ClipResponse(
                id=str(clip.id),
                recording_id=str(clip.recording_id),
                song_id=str(clip.song_id) if clip.song_id else None,
                start_time_sec=clip.start_time_sec,
                end_time_sec=clip.end_time_sec,
                display_name=clip.display_name,
                created_at=clip.created_at.isoformat(),
                updated_at=clip.updated_at.isoformat(),
            )
            for clip in clips
        ]


@get("/api/songs/{song_id:uuid}/clips")
async def get_song_clips(song_id: UUID) -> list[ClipWithStemsResponse]:
    """Get all clips for a song, with recording stems."""
    engine = get_engine()

    async with AsyncSession(engine, expire_on_commit=False) as session:
        # Get song metadata first
        song_result = await session.exec(select(Song).where(Song.id == song_id))
        song = song_result.first()
        if song is None:
            raise NotFoundException(detail=f"Song {song_id} not found")

        clips = await get_clips_for_song(session, song_id)

        # Get storage backend for generating URLs
        from ..storage import get_storage

        storage = get_storage()

        responses = []
        for clip in clips:
            # Fetch recording with stems and location
            stmt = (
                select(Recording)
                .where(Recording.id == clip.recording_id)
                .options(
                    selectinload(Recording.stems),      # pyright: ignore[reportArgumentType]
                    selectinload(Recording.location),   # pyright: ignore[reportArgumentType]
                )
            )
            result = await session.exec(stmt)
            recording = result.first()

            if recording is None:
                continue  # Skip clips with missing recordings

            # Get profile for URL generation
            profile_result = await session.exec(
                select(DBProfile).where(DBProfile.id == recording.profile_id)
            )
            profile = profile_result.first()
            if profile is None:
                continue

            stems = [
                StemResponse(
                    stem_type=stem.stem_type,
                    measured_lufs=stem.measured_lufs,
                    peak_amplitude=stem.peak_amplitude,
                    stem_gain_adjustment_db=stem.stem_gain_adjustment_db,
                    audio_url=storage.get_file_url(
                        profile.name,
                        recording.output_name,
                        stem.stem_type,
                        Path(stem.audio_url).suffix,
                    ),
                    waveform_url=storage.get_waveform_url(
                        profile.name, recording.output_name, stem.stem_type
                    ),
                    file_size_bytes=stem.file_size_bytes,
                    duration_seconds=stem.duration_seconds,
                )
                for stem in recording.stems
            ]

            responses.append(
                ClipWithStemsResponse(
                    id=str(clip.id),
                    recording_id=str(clip.recording_id),
                    song_id=str(clip.song_id) if clip.song_id else None,
                    song=SongMetadata(id=str(song.id), name=song.name),
                    start_time_sec=clip.start_time_sec,
                    end_time_sec=clip.end_time_sec,
                    display_name=clip.display_name,
                    created_at=clip.created_at.isoformat(),
                    updated_at=clip.updated_at.isoformat(),
                    recording_output_name=recording.output_name,
                    stems=stems,
                    location=(
                        LocationMetadata(id=str(recording.location.id), name=recording.location.name)
                        if recording.location
                        else None
                    ),
                    date_recorded=(
                        recording.date_recorded.isoformat() if recording.date_recorded else None
                    ),
                )
            )

        return responses


from litestar import post


@post("/api/recordings/{recording_id:uuid}/clips")
async def create_clip_endpoint(recording_id: UUID, data: CreateClipRequest) -> ClipResponse:
    """Create a new clip for a recording."""
    engine = get_engine()

    async with AsyncSession(engine, expire_on_commit=False) as session:
        # Validate recording exists
        stmt = select(Recording).where(Recording.id == recording_id)
        result = await session.exec(stmt)
        recording = result.first()
        if recording is None:
            raise NotFoundException(detail=f"Recording {recording_id} not found")

        # Inherit song_id from recording if not provided in request
        clip_song_id = UUID(data.song_id) if data.song_id else None
        if clip_song_id is None and recording.song_id:
            clip_song_id = recording.song_id

        # Create clip
        try:
            clip = await create_clip(
                session,
                recording_id=recording_id,
                start_time_sec=data.start_time_sec,
                end_time_sec=data.end_time_sec,
                song_id=clip_song_id,
                display_name=data.display_name,
            )
        except ValueError as e:
            from litestar.exceptions import ValidationException

            raise ValidationException(detail=str(e))

        return ClipResponse(
            id=str(clip.id),
            recording_id=str(clip.recording_id),
            song_id=str(clip.song_id) if clip.song_id else None,
            start_time_sec=clip.start_time_sec,
            end_time_sec=clip.end_time_sec,
            display_name=clip.display_name,
            created_at=clip.created_at.isoformat(),
            updated_at=clip.updated_at.isoformat(),
        )


@get("/api/clips/{clip_id:uuid}")
async def get_clip_endpoint(clip_id: UUID) -> ClipWithStemsResponse:
    """Get a single clip with its recording stems."""
    engine = get_engine()

    async with AsyncSession(engine, expire_on_commit=False) as session:
        stmt = select(Clip).where(Clip.id == clip_id).options(selectinload(Clip.song))
        result = await session.exec(stmt)
        clip = result.first()

        if clip is None:
            raise NotFoundException(detail=f"Clip {clip_id} not found")

        # Fetch recording with stems and song
        stmt = (
            select(Recording)
            .where(Recording.id == clip.recording_id)
            .options(
                selectinload(Recording.stems),      # pyright: ignore[reportArgumentType]
                selectinload(Recording.song),       # pyright: ignore[reportArgumentType]
                selectinload(Recording.location),   # pyright: ignore[reportArgumentType]
            )
        )
        result = await session.exec(stmt)
        recording = result.first()

        if recording is None:
            raise NotFoundException(detail=f"Recording {clip.recording_id} not found")

        # Get profile for URL generation
        profile_result = await session.exec(
            select(DBProfile).where(DBProfile.id == recording.profile_id)
        )
        profile = profile_result.first()
        if profile is None:
            raise NotFoundException(detail=f"Profile not found for recording {recording.id}")

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
                    profile.name, recording.output_name, stem.stem_type, Path(stem.audio_url).suffix
                ),
                waveform_url=storage.get_waveform_url(
                    profile.name, recording.output_name, stem.stem_type
                ),
                file_size_bytes=stem.file_size_bytes,
                duration_seconds=stem.duration_seconds,
            )
            for stem in recording.stems
        ]

        return ClipWithStemsResponse(
            id=str(clip.id),
            recording_id=str(clip.recording_id),
            song_id=str(clip.song_id) if clip.song_id else None,
            song=(SongMetadata(id=str(clip.song.id), name=clip.song.name) if clip.song else None),
            start_time_sec=clip.start_time_sec,
            end_time_sec=clip.end_time_sec,
            display_name=clip.display_name,
            created_at=clip.created_at.isoformat(),
            updated_at=clip.updated_at.isoformat(),
            recording_output_name=recording.output_name,
            stems=stems,
            location=(
                LocationMetadata(id=str(recording.location.id), name=recording.location.name)
                if recording.location
                else None
            ),
            date_recorded=(
                recording.date_recorded.isoformat() if recording.date_recorded else None
            ),
        )


@patch("/api/clips/{clip_id:uuid}")
async def update_clip_endpoint(clip_id: UUID, data: UpdateClipRequest) -> ClipResponse:
    """Update a clip's properties."""
    engine = get_engine()

    async with AsyncSession(engine, expire_on_commit=False) as session:
        try:
            clip = await update_clip(
                session,
                clip_id=clip_id,
                start_time_sec=data.start_time_sec,
                end_time_sec=data.end_time_sec,
                song_id=UUID(data.song_id) if data.song_id else None,
                display_name=data.display_name,
            )
        except ValueError as e:
            if "not found" in str(e):
                raise NotFoundException(detail=str(e))
            from litestar.exceptions import ValidationException

            raise ValidationException(detail=str(e))

        return ClipResponse(
            id=str(clip.id),
            recording_id=str(clip.recording_id),
            song_id=str(clip.song_id) if clip.song_id else None,
            start_time_sec=clip.start_time_sec,
            end_time_sec=clip.end_time_sec,
            display_name=clip.display_name,
            created_at=clip.created_at.isoformat(),
            updated_at=clip.updated_at.isoformat(),
        )


@delete("/api/clips/{clip_id:uuid}")
async def delete_clip_endpoint(clip_id: UUID) -> None:
    """Delete a clip."""
    engine = get_engine()

    async with AsyncSession(engine, expire_on_commit=False) as session:
        try:
            _ = await delete_clip(session, clip_id)
        except ValueError as e:
            raise NotFoundException(detail=str(e))

        return None


@get("/api/profiles/{profile_name:str}/clips")
async def get_profile_clips(profile_name: str) -> list[ClipWithStemsResponse]:
    """Get all clips across all recordings in a profile."""
    engine = get_engine()

    async with AsyncSession(engine, expire_on_commit=False) as session:
        # Get profile
        stmt = select(DBProfile).where(DBProfile.name == profile_name)
        result = await session.exec(stmt)
        profile = result.first()

        if profile is None:
            raise NotFoundException(f"Profile '{profile_name}' not found")

        # Get all clips for this profile's recordings
        stmt = (
            select(Clip)
            .join(Recording, Clip.recording_id == Recording.id)
            .where(Recording.profile_id == profile.id)
            .order_by(desc(Clip.created_at))
            .options(
                selectinload(Clip.recording).selectinload(Recording.stems),  # pyright: ignore
                selectinload(Clip.song),  # pyright: ignore
            )
        )
        result = await session.exec(stmt)
        clips = result.all()

        # Build responses with stem URLs
        from ..storage import get_storage

        storage = get_storage()

        responses = []
        for clip in clips:
            recording = clip.recording
            if not recording:
                continue

            # Build stems list
            stems = []
            for stem in recording.stems:
                file_ext = Path(stem.audio_url).suffix
                audio_url = storage.get_file_url(
                    profile_name,
                    recording.output_name,
                    stem.stem_type,
                    file_ext,
                )
                waveform_url = storage.get_waveform_url(
                    profile_name,
                    recording.output_name,
                    stem.stem_type,
                )

                stems.append(
                    StemResponse(
                        stem_type=stem.stem_type,
                        measured_lufs=stem.measured_lufs,
                        peak_amplitude=stem.peak_amplitude,
                        stem_gain_adjustment_db=stem.stem_gain_adjustment_db,
                        audio_url=audio_url,
                        waveform_url=waveform_url,
                        file_size_bytes=stem.file_size_bytes,
                        duration_seconds=stem.duration_seconds,
                    )
                )

            responses.append(
                ClipWithStemsResponse(
                    id=str(clip.id),
                    recording_id=str(clip.recording_id),
                    song_id=str(clip.song_id) if clip.song_id else None,
                    song=(
                        SongMetadata(id=str(clip.song.id), name=clip.song.name)
                        if clip.song
                        else None
                    ),
                    start_time_sec=clip.start_time_sec,
                    end_time_sec=clip.end_time_sec,
                    display_name=clip.display_name,
                    created_at=clip.created_at.isoformat(),
                    updated_at=clip.updated_at.isoformat(),
                    recording_output_name=recording.output_name,
                    stems=stems,
                )
            )

        return responses
