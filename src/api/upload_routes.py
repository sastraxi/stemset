"""API endpoints for file upload and processing workflows."""

from __future__ import annotations

import os
import secrets
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated
from uuid import UUID

import httpx
from litestar import Response, get, patch, post
from litestar.background_tasks import BackgroundTask
from litestar.datastructures import UploadFile
from litestar.enums import RequestEncodingType
from litestar.exceptions import NotFoundException, ValidationException
from litestar.params import Body
from pydantic import BaseModel
from sqlalchemy.orm import selectinload
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.config import get_engine

from ..config import Config
from ..db.models import AudioFile, Location, Profile, Recording, Song, Stem, User
from ..db.models import RecordingUserConfig as DBRecordingUserConfig
from ..processor.local import process_locally
from ..processor.models import (
    ProcessingCallbackPayload,
    UploadResponse,
    WorkerJobPayload,
)
from ..processor.trigger import trigger_processing
from ..storage import get_storage
from ..utils import compute_file_hash, derive_output_name
from .models import RecordingConfigData, RecordingStatusResponse
from .state import AppState
from .types import AppRequest


@post("/api/upload/{profile_name:str}")
async def upload_file(
    profile_name: str,
    data: Annotated[UploadFile, Body(media_type=RequestEncodingType.MULTI_PART)],
    state: AppState,
) -> Response[UploadResponse]:
    """Upload an audio file and trigger processing (local or remote).

    Workflow:
    1. Validate file (size, type)
    2. Save to inputs/ directory (R2 or local)
    3. Create database records (AudioFile, Recording)
    4. Trigger worker:
       - If GPU_WORKER_URL set: POST to Modal worker
       - Else: POST to /api/process (self-callback)
    5. Return recording_id for polling

    Args:
        profile_name: Profile to use for processing
        data: Uploaded file
        state: Litestar application state

    Returns:
        Recording ID and status

    Raises:
        ValidationException: If file is invalid
        ValueError: If profile not found
    """
    config = state.config

    # Get profile from database
    async with AsyncSession(get_engine()) as session:
        stmt = select(Profile).where(Profile.name == profile_name)
        result = await session.exec(stmt)
        profile = result.first()

    if profile is None:
        raise ValueError(f"Profile '{profile_name}' not found")

    # Validate file size (150MB max)
    MAX_FILE_SIZE = 150 * 1024 * 1024
    file_size = len(await data.read())
    _ = await data.seek(0)

    if file_size > MAX_FILE_SIZE:
        raise ValidationException(
            f"File too large: {file_size / 1024 / 1024:.1f}MB. Maximum: 150MB"
        )

    # Validate file extension
    ALLOWED_EXTENSIONS = {".wav", ".flac", ".mp3", ".m4a", ".aac", ".opus", ".ogg", ".wave", ".webm"}
    file_ext = Path(data.filename).suffix.lower()
    if file_ext not in ALLOWED_EXTENSIONS:
        raise ValidationException(
            f"Unsupported file type: {file_ext}. Allowed: {', '.join(sorted(ALLOWED_EXTENSIONS))}"
        )

    # Save to temp file for processing
    with tempfile.NamedTemporaryFile(delete=False, suffix=file_ext) as temp_file:
        temp_path = Path(temp_file.name)
        content = await data.read()
        _ = temp_file.write(content)

    try:
        # Compute hash and initialize duration
        file_hash = compute_file_hash(temp_path)

        # Derive output name
        base_output_name = derive_output_name(Path(data.filename))
        output_name = f"{base_output_name}_{file_hash[:8]}"

        # Upload to storage (R2 or local inputs/)
        storage = get_storage(config)
        print(f"Uploading {data.filename} to storage (inputs/{profile_name}/)")
        _ = storage.upload_input_file(temp_path, profile_name, data.filename)

        # Create database records
        engine = get_engine()
        async with AsyncSession(engine, expire_on_commit=False) as session:
            # Get or create AudioFile (deduplicate by profile + source_type + source_id)
            stmt = select(AudioFile).where(
                AudioFile.profile_id == profile.id,
                AudioFile.source_type == "upload",
                AudioFile.source_id == file_hash,
            )
            result = await session.exec(stmt)
            audio_file = result.first()
            if not audio_file:
                # Get file modified time from temp file (Unix timestamp)
                source_modified_time = int(temp_path.stat().st_mtime)

                audio_file = AudioFile(
                    profile_id=profile.id,
                    source_type="upload",
                    source_id=file_hash,  # For uploads, source_id = file_hash
                    source_parent_id=None,  # Uploads have no parent folder
                    source_modified_time=source_modified_time,
                    filename=data.filename,
                    file_hash=file_hash,
                    file_size_bytes=file_size,
                )
                session.add(audio_file)
                await session.commit()
                await session.refresh(audio_file)

            # Check if recording already exists and is complete
            stmt = select(Recording).where(
                Recording.profile_id == profile.id,
                Recording.output_name == output_name,
            )
            result = await session.exec(stmt)
            existing_recording = result.first()

            if existing_recording and existing_recording.status == "complete":
                print(f"File already processed (recording {existing_recording.id}), skipping")
                return Response(
                    UploadResponse(
                        recording_id=str(existing_recording.id),
                        profile_name=profile.name,
                        output_name=output_name,
                        filename=data.filename,
                        status="complete",
                        message="File already processed",
                    )
                )

            # Create new Recording record
            verification_token = secrets.token_urlsafe(32)
            recording = Recording(
                profile_id=profile.id,
                audio_file_id=audio_file.id,
                output_name=output_name,
                display_name=output_name,
                status="processing",
                verification_token=verification_token,
            )
            session.add(recording)
            await session.commit()
            await session.refresh(recording)

        await trigger_processing(
            recording=recording,
            profile=profile,
            input_filename=data.filename,
            config=config,
            backend_url=state.backend_url,
        )

        return Response(
            UploadResponse(
                recording_id=str(recording.id),
                profile_name=profile.name,
                output_name=output_name,
                filename=data.filename,
                status="processing",
            )
        )

    finally:
        temp_path.unlink(missing_ok=True)



@post("/api/recordings/{recording_id:uuid}/complete/{verification_token:str}")
async def recording_complete(
    recording_id: UUID,
    verification_token: str,
    data: ProcessingCallbackPayload,
) -> dict[str, str]:
    """Callback endpoint for worker to report completion.

    Args:
        recording_id: Recording identifier
        verification_token: Secret token for authentication
        data: Processing result with status and stems data

    Returns:
        Success message

    Raises:
        NotFoundException: If recording not found
        ValidationException: If verification token invalid
    """
    engine = get_engine()

    async with AsyncSession(engine, expire_on_commit=False) as session:
        # Fetch recording and validate token
        stmt = select(Recording).where(Recording.id == recording_id)
        db_result = await session.exec(stmt)
        recording = db_result.first()

        if recording is None:
            raise NotFoundException(f"Recording {recording_id} not found")

        if recording.verification_token != verification_token:
            raise ValidationException("Invalid verification token")

        # Handle errors
        if data.status == "error":
            recording.status = "error"
            recording.error_message = data.error or "Unknown error"
            await session.commit()
            print(f"Recording {recording_id} failed: {recording.error_message}")
            return {"status": "ok"}

        # Get profile for constructing URLs
        stmt = select(Profile).where(Profile.id == recording.profile_id)
        profile_result = await session.exec(stmt)
        profile = profile_result.first()
        if profile is None:
            raise ValueError(f"Profile not found for recording {recording_id}")

        # Get AudioFile for linking stems
        stmt = select(AudioFile).where(AudioFile.id == recording.audio_file_id)
        audio_result = await session.exec(stmt)
        audio_file = audio_result.first()
        if audio_file is None:
            raise ValueError(f"AudioFile not found for recording {recording_id}")

        # Create Stem records from data (idempotent - skip if already exist)
        stems_data = data.stems or []
        existing_stems_stmt = select(Stem).where(Stem.recording_id == recording.id)
        existing_stems_result = await session.exec(existing_stems_stmt)
        existing_stems = existing_stems_result.all()

        if existing_stems:
            print(f"Stems already exist for recording {recording.id}, skipping stem creation")
        else:
            print(f"Creating {len(stems_data)} stem(s)")
            for stem_model in stems_data:
                stem = Stem(
                    recording_id=recording.id,
                    audio_file_id=audio_file.id,
                    stem_type=stem_model.stem_type,
                    measured_lufs=stem_model.measured_lufs,
                    peak_amplitude=stem_model.peak_amplitude,
                    stem_gain_adjustment_db=stem_model.stem_gain_adjustment_db,
                    audio_url=stem_model.audio_url,
                    waveform_url=stem_model.waveform_url,
                    file_size_bytes=stem_model.file_size_bytes,
                    duration_seconds=stem_model.duration_seconds,
                )
                session.add(stem)

        # Update recording status
        recording.status = "complete"
        recording.error_message = None

        # Create clips from clip_boundaries provided by worker
        from src.db.models import Clip

        clip_boundaries = data.clip_boundaries or {}

        # Check if clips already exist for this recording (idempotency)
        existing_clips_stmt = select(Clip).where(Clip.recording_id == recording.id)
        existing_clips_result = await session.exec(existing_clips_stmt)
        existing_clips = existing_clips_result.all()

        if existing_clips:
            print(f"Clips already exist for recording {recording.id}, skipping clip creation")
        else:
            print(f"Creating {len(clip_boundaries)} clip(s) from worker boundaries")

            # If multiple clips detected, name them "Section 1", "Section 2", etc.
            # If single clip detected, leave display_name as None (full recording)
            for i, (_clip_id, boundary) in enumerate(clip_boundaries.items(), start=1):
                display_name = f"Section {i}" if len(clip_boundaries) > 1 else None

                clip = Clip(
                    recording_id=recording.id,
                    song_id=None,  # Clips created without a song, user can set later
                    start_time_sec=boundary.start_time_sec,
                    end_time_sec=boundary.end_time_sec,
                    display_name=display_name,
                )
                session.add(clip)

        await session.commit()

        print(f"Recording {recording_id} completed: {len(stems_data)} stems created")
        return {"status": "ok"}


@get("/api/recordings/{recording_id:uuid}")
async def get_recording_status(
    recording_id: UUID, state: AppState, request: AppRequest
) -> RecordingStatusResponse:
    """Get status of a recording (simple polling, no long-poll).

    Args:
        recording_id: Recording identifier
        state: Litestar application state
        request: Request object with user context

    Returns:
        Recording status with stems and user-specific config if complete

    Raises:
        NotFoundException: If recording not found
    """
    engine = get_engine()

    async with AsyncSession(engine, expire_on_commit=False) as session:
        # Fetch recording with stems
        stmt = (
            select(Recording)
            .where(Recording.id == recording_id)
            .options(
                selectinload(Recording.stems),  # pyright: ignore[reportArgumentType]
                selectinload(Recording.location),  # pyright: ignore[reportArgumentType]
            )
        )
        result = await session.exec(stmt)
        recording = result.first()

        if recording is None:
            raise NotFoundException(f"Recording {recording_id} not found")

        # Build response
        stems_list = []
        if recording.status == "complete" and recording.stems:
            storage = get_storage(state.config)
            stmt = select(Profile).where(Profile.id == recording.profile_id)
            profile_result = await session.exec(stmt)
            profile = profile_result.first()

            if profile:
                for stem in recording.stems:
                    # Generate full URLs using storage backend
                    file_ext = Path(stem.audio_url).suffix
                    audio_url = storage.get_file_url(
                        profile.name, recording.output_name, stem.stem_type, file_ext
                    )
                    waveform_url = storage.get_waveform_url(
                        profile.name, recording.output_name, stem.stem_type
                    )

                    stems_list.append(
                        {
                            "stem_type": stem.stem_type,
                            "measured_lufs": stem.measured_lufs,
                            "peak_amplitude": stem.peak_amplitude,
                            "stem_gain_adjustment_db": stem.stem_gain_adjustment_db,
                            "audio_url": audio_url,
                            "waveform_url": waveform_url,
                            "file_size_bytes": stem.file_size_bytes,
                            "duration_seconds": stem.duration_seconds,
                        }
                    )

        # Load user-specific config if user is authenticated
        config_data = RecordingConfigData()  # Default to empty config
        user = request.user
        if user:
            # Get user_id from email
            user_result = await session.exec(select(User).where(User.email == user.email))
            db_user = user_result.first()

            if db_user:
                # Load all config keys for this user+recording
                config_stmt = select(DBRecordingUserConfig).where(
                    DBRecordingUserConfig.user_id == db_user.id,
                    DBRecordingUserConfig.recording_id == recording_id,
                )
                config_result = await session.exec(config_stmt)
                config_records = config_result.all()

                # Build config dict from individual keys, filtering out legacy keys
                config_dict = {}
                for record in config_records:
                    if record.config_key != "effects":
                        config_dict[record.config_key] = record.config_value

                config_data = RecordingConfigData(**config_dict)

        # Build location metadata if present
        location_metadata = None
        if recording.location:
            from .models import LocationMetadata

            location_metadata = LocationMetadata(
                id=str(recording.location.id), name=recording.location.name
            )

        # Format date_recorded if present
        date_recorded_str = None
        if recording.date_recorded:
            date_recorded_str = recording.date_recorded.isoformat()

        return RecordingStatusResponse(
            recording_id=str(recording.id),
            status=recording.status,
            error_message=recording.error_message,
            output_name=recording.output_name,
            display_name=recording.display_name,
            stems=stems_list,
            config=config_data,
            location=location_metadata,
            date_recorded=date_recorded_str,
        )


class UpdateRecordingMetadataRequest(BaseModel):
    """Request to update recording metadata."""

    location_id: UUID | None = None
    date_recorded: str | None = None  # ISO format date string (YYYY-MM-DD)


@patch("/api/recordings/{recording_id:uuid}/metadata")
async def update_recording_metadata(
    recording_id: UUID, data: UpdateRecordingMetadataRequest
) -> RecordingStatusResponse:
    """Update metadata (location, date_recorded) for a recording.

    Args:
        recording_id: Recording identifier
        data: Metadata updates

    Returns:
        Updated recording status

    Raises:
        NotFoundException: If recording or location not found
    """
    engine = get_engine()

    async with AsyncSession(engine, expire_on_commit=False) as session:
        # Fetch recording
        stmt = (
            select(Recording)
            .where(Recording.id == recording_id)
            .options(
                selectinload(Recording.stems),  # pyright: ignore[reportArgumentType]
                selectinload(Recording.location),  # pyright: ignore[reportArgumentType]
            )
        )
        result = await session.exec(stmt)
        recording = result.first()

        if recording is None:
            raise NotFoundException(f"Recording {recording_id} not found")

        # Validate and update location_id if provided
        if data.location_id is not None:
            location_result = await session.exec(
                select(Location).where(Location.id == data.location_id)
            )
            location = location_result.first()
            if location is None:
                raise NotFoundException(f"Location {data.location_id} not found")
            recording.location_id = data.location_id

        # Update date_recorded if provided
        if data.date_recorded is not None:
            # Parse ISO date string to datetime object (date only, no timezone)
            recording.date_recorded = datetime.fromisoformat(data.date_recorded)

        # Update timestamp
        recording.updated_at = datetime.now(timezone.utc)

        await session.commit()
        await session.refresh(recording)

        # Build response (reuse logic from get_recording_status)
        stems_list = []
        if recording.status == "complete" and recording.stems:
            stmt = select(Profile).where(Profile.id == recording.profile_id)
            profile_result = await session.exec(stmt)
            profile = profile_result.first()

            if profile:
                from ..storage import get_storage

                storage = get_storage()

                for stem in recording.stems:
                    file_ext = Path(stem.audio_url).suffix
                    audio_url = storage.get_file_url(
                        profile.name, recording.output_name, stem.stem_type, file_ext
                    )
                    waveform_url = storage.get_waveform_url(
                        profile.name, recording.output_name, stem.stem_type
                    )

                    stems_list.append(
                        {
                            "stem_type": stem.stem_type,
                            "measured_lufs": stem.measured_lufs,
                            "peak_amplitude": stem.peak_amplitude,
                            "stem_gain_adjustment_db": stem.stem_gain_adjustment_db,
                            "audio_url": audio_url,
                            "waveform_url": waveform_url,
                            "file_size_bytes": stem.file_size_bytes,
                            "duration_seconds": stem.duration_seconds,
                        }
                    )

        # Build location metadata if present
        location_metadata = None
        if recording.location:
            from ..api.models import LocationMetadata

            location_metadata = LocationMetadata(
                id=str(recording.location.id), name=recording.location.name
            )

        # Format date_recorded if present
        date_recorded_str = None
        if recording.date_recorded:
            date_recorded_str = recording.date_recorded.isoformat()

        return RecordingStatusResponse(
            recording_id=str(recording.id),
            status=recording.status,
            error_message=recording.error_message,
            output_name=recording.output_name,
            display_name=recording.display_name,
            stems=stems_list,
            config=RecordingConfigData(),  # Empty config for metadata update
            location=location_metadata,
            date_recorded=date_recorded_str,
        )
