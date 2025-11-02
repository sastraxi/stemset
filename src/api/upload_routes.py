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

from ..config import Config
from ..db.config import get_engine
from ..db.models import AudioFile, Location, Profile, Recording, Song, Stem, User
from ..db.models import RecordingUserConfig as DBRecordingUserConfig
from ..processor.core import process_audio_file
from ..processor.models import ProcessingCallbackPayload, StemDataModel
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
) -> dict[str, str]:
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
    ALLOWED_EXTENSIONS = {".wav", ".flac", ".mp3", ".m4a", ".aac", ".opus", ".ogg", ".wave"}
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
            # Get or create AudioFile (deduplicate by hash)
            stmt = select(AudioFile).where(AudioFile.file_hash == file_hash)
            result = await session.exec(stmt)
            audio_file = result.first()
            if not audio_file:
                audio_file = AudioFile(
                    profile_id=profile.id,
                    filename=data.filename,
                    file_hash=file_hash,
                    storage_url=f"inputs/{profile_name}/{data.filename}",
                    file_size_bytes=file_size,
                    duration_seconds=0,  # Will be updated by worker callback
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
                return {
                    "recording_id": str(existing_recording.id),
                    "profile_name": profile.name,
                    "output_name": output_name,
                    "filename": data.filename,
                    "status": "complete",
                    "message": "File already processed",
                }

            # Create new Recording record
            verification_token = secrets.token_urlsafe(32)
            recording = Recording(
                profile_id=profile.id,
                output_name=output_name,
                display_name=output_name,
                status="processing",
                verification_token=verification_token,
            )
            session.add(recording)
            await session.commit()
            await session.refresh(recording)

        # Determine worker URL (Modal or self-callback)
        gpu_worker_url = config.gpu_worker_url or os.getenv("GPU_WORKER_URL")
        if gpu_worker_url:
            worker_url = gpu_worker_url.rstrip("/")
        else:
            # Self-callback for local processing
            worker_url = f"{state.backend_url}/api/process"

        # Create callback URL
        print("State backend URL is ", state.backend_url)
        callback_url = (
            f"{state.backend_url}/api/recordings/{recording.id}/complete/{verification_token}"
        )

        # Create worker payload
        worker_payload = {
            "recording_id": str(recording.id),
            "verification_token": verification_token,
            "profile_name": profile_name,
            "strategy_name": profile.strategy_name,
            "input_filename": data.filename,
            "output_name": output_name,
            "callback_url": callback_url,
        }

        # Trigger worker (fire-and-forget)
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.post(worker_url, json=worker_payload)
                _ = response.raise_for_status()
        except (httpx.TimeoutException, httpx.HTTPError) as e:
            print(f"Warning: Failed to trigger worker: {e}")
            # Recording is in database with status="processing" and can be retried

        print(f"Recording {recording.id} created for {output_name}")

        return {
            "recording_id": str(recording.id),
            "profile_name": profile.name,
            "output_name": output_name,
            "filename": data.filename,
            "status": "processing",
        }

    finally:
        temp_path.unlink(missing_ok=True)


async def _process_and_callback(
    recording_id: str,
    profile_name: str,
    strategy_name: str,
    input_filename: str,
    output_name: str,
    callback_url: str,
    config: Config,
) -> None:
    """Background task to process audio and call back with results.

    Args:
        recording_id: Recording identifier
        profile_name: Profile name
        strategy_name: Strategy name
        input_filename: Input filename
        output_name: Output name
        callback_url: URL to call back with results
        config: Application config
    """
    try:
        # Get input file path
        storage = get_storage(config)
        input_path = Path(storage.get_input_url(profile_name, input_filename))

        # Create output directory
        output_dir = Path("media") / profile_name / output_name

        # Run separation using shared core logic
        stem_data_list = process_audio_file(
            input_path=input_path,
            output_dir=output_dir,
            profile_name=profile_name,
            strategy_name=strategy_name,
        )

        # Call callback endpoint
        callback_payload = ProcessingCallbackPayload(
            status="complete",
            stems=[StemDataModel(**stem) for stem in stem_data_list],
        )
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                callback_url,
                json=callback_payload.model_dump(),
            )
            _ = response.raise_for_status()

        print(f"[Local Worker] Recording {recording_id} complete")

    except Exception as e:
        print(f"[Local Worker] Recording {recording_id} failed: {e}")
        # Call callback with error
        try:
            callback_payload = ProcessingCallbackPayload(
                status="error",
                error=str(e),
            )
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(
                    callback_url,
                    json=callback_payload.model_dump(),
                )
                _ = response.raise_for_status()
        except Exception as callback_error:
            print(f"[Local Worker] Failed to report error: {callback_error}")


@post("/api/process")
async def process_local(
    data: dict[str, str], state: AppState
) -> Response[dict[str, str]]:
    """Local processing endpoint (acts as GPU worker for development).

    This endpoint receives the same payload as the Modal GPU worker,
    but processes the audio locally in a background task.

    Args:
        data: Worker payload with recording_id, profile_name, etc.
        state: Litestar application state

    Returns:
        Accepted status (processing happens in background)
    """
    recording_id = data["recording_id"]
    profile_name = data["profile_name"]
    strategy_name = data["strategy_name"]
    input_filename = data["input_filename"]
    output_name = data["output_name"]
    callback_url = data["callback_url"]

    print(f"[Local Worker] Processing recording {recording_id}")

    # Create background task
    task = BackgroundTask(
        _process_and_callback,
        recording_id,
        profile_name,
        strategy_name,
        input_filename,
        output_name,
        callback_url,
        state.config,
    )

    return Response(
        {"status": "accepted", "recording_id": recording_id},
        background=task,
    )


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
        stmt = select(AudioFile).where(AudioFile.profile_id == recording.profile_id)
        audio_result = await session.exec(stmt)
        audio_file = audio_result.first()
        if audio_file is None:
            raise ValueError(f"AudioFile not found for recording {recording_id}")

        # Create Stem records from data
        stems_data = data.stems or []
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

        # Update audio file duration from the first stem
        if stems_data:
            audio_file.duration_seconds = stems_data[0].duration_seconds
            print(
                f"Updated audio file {audio_file.id} duration to {audio_file.duration_seconds:.2f}s"
            )
        else:
            audio_file.duration_seconds = -1.0  # Sentinel value

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
            .options(selectinload(Recording.stems))  # pyright: ignore[reportArgumentType]
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

        return RecordingStatusResponse(
            recording_id=str(recording.id),
            status=recording.status,
            error_message=recording.error_message,
            output_name=recording.output_name,
            display_name=recording.display_name,
            stems=stems_list,
            config=config_data,
        )


class UpdateRecordingMetadataRequest(BaseModel):
    """Request to update recording metadata."""

    song_id: UUID | None = None
    location_id: UUID | None = None
    date_recorded: str | None = None  # ISO format date string (YYYY-MM-DD)


@patch("/api/recordings/{recording_id:uuid}/metadata")
async def update_recording_metadata(
    recording_id: UUID, data: UpdateRecordingMetadataRequest
) -> RecordingStatusResponse:
    """Update metadata (song, location, date_recorded) for a recording.

    Args:
        recording_id: Recording identifier
        data: Metadata updates

    Returns:
        Updated recording status

    Raises:
        NotFoundException: If recording, song, or location not found
    """
    engine = get_engine()

    async with AsyncSession(engine, expire_on_commit=False) as session:
        # Fetch recording
        stmt = (
            select(Recording)
            .where(Recording.id == recording_id)
            .options(
                selectinload(Recording.stems),  # pyright: ignore[reportArgumentType]
                selectinload(Recording.song),  # pyright: ignore[reportArgumentType]
                selectinload(Recording.location),  # pyright: ignore[reportArgumentType]
            )
        )
        result = await session.exec(stmt)
        recording = result.first()

        if recording is None:
            raise NotFoundException(f"Recording {recording_id} not found")

        # Validate and update song_id if provided
        if data.song_id is not None:
            song_result = await session.exec(select(Song).where(Song.id == data.song_id))
            song = song_result.first()
            if song is None:
                raise NotFoundException(f"Song {data.song_id} not found")
            recording.song_id = data.song_id

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

        return RecordingStatusResponse(
            recording_id=str(recording.id),
            status=recording.status,
            error_message=recording.error_message,
            output_name=recording.output_name,
            display_name=recording.display_name,
            stems=stems_list,
            config=RecordingConfigData(),  # Empty config for metadata update
        )
