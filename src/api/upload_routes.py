"""API endpoints for file upload and processing workflows."""

from __future__ import annotations

import asyncio
import os
import secrets
import soundfile as sf  # pyright: ignore[reportMissingTypeStubs]
import tempfile
from pathlib import Path
from typing import Annotated
from uuid import UUID

import httpx
from litestar import post, get
from litestar.params import Body
from litestar.datastructures import UploadFile
from litestar.exceptions import NotFoundException, ValidationException
from litestar.enums import RequestEncodingType
from sqlalchemy.orm import selectinload
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from ..db.config import get_engine
from ..db.models import AudioFile, Profile, Recording, Stem
from ..models.metadata import StemMetadata, StemsMetadata
from ..modern_separator import StemSeparator
from ..storage import get_storage
from ..utils import compute_file_hash, derive_output_name
from .models import StemData, RecordingStatusResponse
from .state import AppState


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
        # Compute hash and extract metadata
        file_hash = compute_file_hash(temp_path)
        info = sf.info(str(temp_path))  # pyright: ignore[reportUnknownMemberType]
        duration_seconds = float(info.duration)  # pyright: ignore[reportAny]

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
                    duration_seconds=duration_seconds,
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
        callback_url = f"{state.backend_url}/api/recordings/{recording.id}/complete/{verification_token}"

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


@post("/api/process")
async def process_local(payload: dict[str, str], state: AppState) -> dict[str, str]:
    """Local processing endpoint (acts as GPU worker for development).

    This endpoint receives the same payload as the Modal GPU worker,
    but processes the audio locally in a background task.

    Args:
        payload: Worker payload with recording_id, profile_name, etc.
        state: Litestar application state

    Returns:
        Accepted status (processing happens in background)
    """
    recording_id = payload["recording_id"]
    profile_name = payload["profile_name"]
    strategy_name = payload["strategy_name"]
    input_filename = payload["input_filename"]
    output_name = payload["output_name"]
    callback_url = payload["callback_url"]

    print(f"[Local Worker] Processing recording {recording_id}")

    # Trigger background task
    async def process_and_callback() -> None:
        try:
            # Get input file path
            storage = get_storage(state.config)
            input_path = Path(storage.get_input_url(profile_name, input_filename))

            # Create output directory
            output_dir = Path("media") / profile_name / output_name
            output_dir.mkdir(parents=True, exist_ok=True)

            # Run separation
            separator = StemSeparator(profile_name, strategy_name)
            stems_metadata = separator.separate_and_normalize(input_path, output_dir)

            # Convert to callback format
            stem_data_list = [
                {
                    "stem_type": stem_name,
                    "measured_lufs": stem_meta.measured_lufs,
                    "peak_amplitude": stem_meta.peak_amplitude,
                    "stem_gain_adjustment_db": stem_meta.stem_gain_adjustment_db,
                    "audio_url": stem_meta.stem_url,
                    "waveform_url": stem_meta.waveform_url,
                    "file_size_bytes": (output_dir / stem_meta.stem_url).stat().st_size,
                    "duration_seconds": sf.info(str(output_dir / stem_meta.stem_url)).duration,  # pyright: ignore
                }
                for stem_name, stem_meta in stems_metadata.stems.items()
            ]

            # Call callback endpoint
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(
                    callback_url,
                    json={"status": "complete", "stems": stem_data_list},
                )
                _ = response.raise_for_status()

            print(f"[Local Worker] Recording {recording_id} complete")

        except Exception as e:
            print(f"[Local Worker] Recording {recording_id} failed: {e}")
            # Call callback with error
            try:
                async with httpx.AsyncClient(timeout=30.0) as client:
                    response = await client.post(
                        callback_url,
                        json={"status": "error", "error": str(e)},
                    )
                    _ = response.raise_for_status()
            except Exception as callback_error:
                print(f"[Local Worker] Failed to report error: {callback_error}")

    # Fire task in background
    asyncio.create_task(process_and_callback())

    return {"status": "accepted", "recording_id": recording_id}


@post("/api/recordings/{recording_id:uuid}/complete/{verification_token:str}")
async def recording_complete(
    recording_id: UUID,
    verification_token: str,
    result: dict[str, str | list[dict[str, str | float]]],
    state: AppState,
) -> dict[str, str]:
    """Callback endpoint for worker to report completion.

    Args:
        recording_id: Recording identifier
        verification_token: Secret token for authentication
        result: Processing result with status and stems data
        state: Litestar application state

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
        if result["status"] == "error":
            recording.status = "error"
            recording.error_message = str(result.get("error", "Unknown error"))
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
        stmt = select(AudioFile).where(
            AudioFile.profile_id == recording.profile_id,
            AudioFile.file_hash.in_(
                select(AudioFile.file_hash).where(AudioFile.profile_id == recording.profile_id)
            ),
        )
        audio_result = await session.exec(stmt)
        audio_file = audio_result.first()
        if audio_file is None:
            raise ValueError(f"AudioFile not found for recording {recording_id}")

        # Create Stem records from result data
        stems_data = result.get("stems", [])
        for stem_dict in stems_data:
            stem = Stem(
                recording_id=recording.id,
                audio_file_id=audio_file.id,
                stem_type=str(stem_dict["stem_type"]),
                measured_lufs=float(stem_dict["measured_lufs"]),
                peak_amplitude=float(stem_dict["peak_amplitude"]),
                stem_gain_adjustment_db=float(stem_dict["stem_gain_adjustment_db"]),
                audio_url=str(stem_dict["audio_url"]),
                waveform_url=str(stem_dict["waveform_url"]),
                file_size_bytes=int(stem_dict["file_size_bytes"]),
                duration_seconds=float(stem_dict["duration_seconds"]),
            )
            session.add(stem)

        # Update recording status
        recording.status = "complete"
        recording.error_message = None
        await session.commit()

        print(f"Recording {recording_id} completed: {len(stems_data)} stems created")
        return {"status": "ok"}


@get("/api/recordings/{recording_id:uuid}")
async def get_recording_status(
    recording_id: UUID, state: AppState
) -> RecordingStatusResponse:
    """Get status of a recording (simple polling, no long-poll).

    Args:
        recording_id: Recording identifier
        state: Litestar application state

    Returns:
        Recording status with stems if complete

    Raises:
        NotFoundException: If recording not found
    """
    engine = get_engine()

    async with AsyncSession(engine, expire_on_commit=False) as session:
        # Fetch recording with stems
        stmt = select(Recording).where(Recording.id == recording_id).options(selectinload(Recording.stems))  # pyright: ignore
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

                    stems_list.append({
                        "stem_type": stem.stem_type,
                        "measured_lufs": stem.measured_lufs,
                        "peak_amplitude": stem.peak_amplitude,
                        "stem_gain_adjustment_db": stem.stem_gain_adjustment_db,
                        "audio_url": audio_url,
                        "waveform_url": waveform_url,
                        "file_size_bytes": stem.file_size_bytes,
                        "duration_seconds": stem.duration_seconds,
                    })

        return RecordingStatusResponse(
            recording_id=str(recording.id),
            status=recording.status,
            error_message=recording.error_message,
            output_name=recording.output_name,
            display_name=recording.display_name,
            stems=stems_list,
        )
