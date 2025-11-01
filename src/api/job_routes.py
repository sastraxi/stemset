"""API endpoints for job management and processing."""

from __future__ import annotations

import asyncio
import secrets
import soundfile as sf  # pyright: ignore[reportMissingTypeStubs]
import tempfile
import uuid
from pathlib import Path
from typing import Annotated

from litestar import post, get
from litestar.params import Body
from litestar.datastructures import UploadFile
from litestar.exceptions import NotFoundException, ValidationException
from litestar.enums import RequestEncodingType
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from ..db.config import get_engine
from ..db.models import AudioFile, Job, Profile, Recording, Stem
from ..models.metadata import StemsMetadata
from ..storage import get_storage
from ..gpu_worker.models import ProcessingJob, ProcessingResult
from ..utils import compute_file_hash, derive_output_name
from .state import AppState


@post("/api/jobs/{job_id:str}/complete/{verification_token:str}")
async def job_complete(
    job_id: str, verification_token: str, result: ProcessingResult, state: AppState
) -> dict[str, str]:
    """Callback endpoint for GPU worker to report completion.

    Args:
        job_id: Job identifier
        verification_token: Secret token for authentication
        result: Processing result from GPU worker
        state: Litestar application state

    Returns:
        Success message

    Raises:
        NotFoundException: If job not found
        ValidationException: If verification token invalid
    """
    config = state.config
    engine = get_engine()

    async with AsyncSession(engine, expire_on_commit=False) as session:
        # 1. Fetch job and validate token
        stmt = select(Job).where(Job.job_id == job_id)
        db_result = await session.exec(stmt)
        job = db_result.first()

        if job is None:
            raise NotFoundException(f"Job {job_id} not found")

        if job.verification_token != verification_token:
            raise ValidationException("Invalid verification token")

        # 2. Handle errors
        if result.status == "error":
            job.status = "error"
            job.error_message = result.error
            job.completed_at = None  # Don't set completed_at for errors
            await session.commit()
            print(f"Job {job_id} failed: {result.error}")
            return {"status": "ok"}

        # 3. Download and parse metadata.json from R2
        storage = get_storage(config)

        with tempfile.NamedTemporaryFile(mode="w+", suffix=".json", delete=False) as temp_file:
            temp_path = Path(temp_file.name)

        try:
            # Get profile name from job
            stmt = select(Profile).where(Profile.id == job.profile_id)
            profile_result = await session.exec(stmt)
            profile = profile_result.first()
            if profile is None:
                raise ValueError(f"Profile not found for job {job_id}")

            # Download metadata.json
            storage.download_metadata(profile.name, job.output_name, temp_path)
            stems_metadata = StemsMetadata.from_file(temp_path)

            # 4. Create Stem records for each stem
            # Get audio file duration (all stems have same duration as source)
            stmt = select(AudioFile).where(AudioFile.id == job.audio_file_id)
            audio_result = await session.exec(stmt)
            audio_file = audio_result.first()
            if audio_file is None:
                raise ValueError(f"AudioFile not found for job {job_id}")

            duration_seconds = audio_file.duration_seconds

            # For file size, we need to query R2 for each stem
            from ..storage import R2Storage

            for stem_name, stem_meta in stems_metadata.stems.items():
                # Query R2 for file size
                stem_file_path = Path(stem_meta.stem_url)
                r2_key = f"{profile.name}/{job.output_name}/{stem_file_path.name}"

                file_size_bytes = 0
                if isinstance(storage, R2Storage):
                    try:
                        head_response = storage.s3_client.head_object(
                            Bucket=storage.config.bucket_name, Key=r2_key
                        )
                        file_size_bytes = int(head_response.get("ContentLength", 0))
                    except Exception as e:
                        print(f"Warning: Could not get file size for {r2_key}: {e}")
                        file_size_bytes = 0

                stem = Stem(
                    recording_id=job.recording_id,
                    audio_file_id=job.audio_file_id,
                    stem_type=stem_name,
                    measured_lufs=stem_meta.measured_lufs,
                    peak_amplitude=stem_meta.peak_amplitude,
                    stem_gain_adjustment_db=stem_meta.stem_gain_adjustment_db,
                    audio_url=stem_meta.stem_url,
                    waveform_url=stem_meta.waveform_url,
                    file_size_bytes=file_size_bytes,
                    duration_seconds=duration_seconds,
                )
                session.add(stem)

            # 5. Update job status
            job.status = "complete"
            from datetime import datetime, timezone

            job.completed_at = datetime.now(timezone.utc)
            await session.commit()

            print(f"Job {job_id} completed: {len(stems_metadata.stems)} stems created")
            return {"status": "ok"}

        finally:
            # Cleanup temp file
            temp_path.unlink(missing_ok=True)


@get("/api/jobs/{job_id:str}")
async def job_status(job_id: str) -> dict[str, str | None]:
    """Get status of a processing job with long-polling support.

    Long-polls up to 60s waiting for job completion.
    Returns immediately if job completes or on timeout.

    Args:
        job_id: Job identifier

    Returns:
        Job status dict

    Raises:
        NotFoundException: If job not found
    """
    engine = get_engine()

    async with AsyncSession(engine, expire_on_commit=False) as session:
        # Fetch job
        stmt = select(Job).where(Job.job_id == job_id)
        result = await session.exec(stmt)
        job = result.first()

        if job is None:
            raise NotFoundException(f"Job {job_id} not found")

        # If already complete or error, return immediately
        if job.status in ("complete", "error"):
            return {
                "job_id": job.job_id,
                "status": job.status,
                "error": job.error_message,
            }

        # Long-poll for completion (up to 60s)
        max_wait_seconds = 60
        poll_interval = 1.0
        waited = 0.0

        while waited < max_wait_seconds:
            await asyncio.sleep(poll_interval)
            waited += poll_interval

            # Re-query job status
            await session.refresh(job)

            if job.status in ("complete", "error"):
                return {
                    "job_id": job.job_id,
                    "status": job.status,
                    "error": job.error_message,
                }

        # Timeout - still processing
        return {
            "job_id": job.job_id,
            "status": "processing",
            "error": None,
        }


@post("/api/upload/{profile_name:str}")
async def upload_file(
    profile_name: str,
    data: Annotated[UploadFile, Body(media_type=RequestEncodingType.MULTI_PART)],
    state: AppState,
) -> dict[str, str]:
    """Upload an audio file and trigger GPU processing.

    Args:
        profile_name: Profile to use for processing
        data: Uploaded file
        state: Litestar application state

    Returns:
        Job ID for status polling

    Raises:
        ValidationException: If file is invalid (wrong type, too large)
        ValueError: If GPU worker not configured or profile not found
    """
    config = state.config

    # Check GPU worker is configured
    if config.gpu_worker_url is None:
        raise ValueError(
            "File upload requires GPU worker. Set GPU_WORKER_URL environment variable."
        )

    # Get profile from database
    async with AsyncSession(get_engine()) as session:
        stmt = select(Profile).where(Profile.name == profile_name)
        result = await session.exec(stmt)
        profile = result.first()

    if profile is None:
        raise ValueError(f"Profile '{profile_name}' not found")

    # Validate file size (150MB max)
    MAX_FILE_SIZE = 150 * 1024 * 1024  # 150MB in bytes
    file_size = len(await data.read())
    _ = await data.seek(0)  # Reset for re-reading

    if file_size > MAX_FILE_SIZE:
        raise ValidationException(
            f"File too large: {file_size / 1024 / 1024:.1f}MB. Maximum: 150MB"
        )

    # Validate file extension (any audio format)
    ALLOWED_EXTENSIONS = {".wav", ".flac", ".mp3", ".m4a", ".aac", ".opus", ".ogg", ".wave"}
    file_ext = Path(data.filename).suffix.lower()
    if file_ext not in ALLOWED_EXTENSIONS:
        raise ValidationException(
            f"Unsupported file type: {file_ext}. Allowed: {', '.join(sorted(ALLOWED_EXTENSIONS))}"
        )

    # Save to temp file for hash computation and metadata extraction
    with tempfile.NamedTemporaryFile(delete=False, suffix=file_ext) as temp_file:
        temp_path = Path(temp_file.name)
        content = await data.read()
        _ = temp_file.write(content)

    try:
        # Compute hash for deduplication
        file_hash = compute_file_hash(temp_path)

        # Extract audio metadata
        info = sf.info(str(temp_path))  # pyright: ignore[reportUnknownMemberType]
        duration_seconds = float(info.duration)  # pyright: ignore[reportAny]

        # Derive output name
        base_output_name = derive_output_name(Path(data.filename))
        output_name = f"{base_output_name}_{file_hash[:8]}"

        # Upload to R2
        storage = get_storage(config)
        print(f"Uploading {data.filename} to R2 (inputs/{profile_name}/)")
        _ = storage.upload_input_file(temp_path, profile_name, data.filename)

        # Create database records (idempotent - handles retries)
        engine = get_engine()
        async with AsyncSession(engine, expire_on_commit=False) as session:
            # 1. Get or create AudioFile record (deduplicate by hash)
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

            # 2. Get or create Recording record for this output_name
            stmt = select(Recording).where(
                Recording.profile_id == profile.id,
                Recording.output_name == output_name,
            )
            result = await session.exec(stmt)
            recording = result.first()
            if not recording:
                display_name = output_name  # Use output folder name as default
                recording = Recording(
                    profile_id=profile.id,
                    output_name=output_name,
                    display_name=display_name,
                )
                session.add(recording)
                await session.commit()
                await session.refresh(recording)

            # 3. Check if there's already a completed job for this recording
            stmt = select(Job).where(
                Job.recording_id == recording.id,
                Job.status == "completed",
            )
            result = await session.exec(stmt)
            existing_completed_job = result.first()

            if existing_completed_job:
                # Job already completed - return existing job_id
                print(f"File already processed (job {existing_completed_job.job_id}), skipping")
                return {
                    "job_id": existing_completed_job.job_id,
                    "status": "completed",
                    "message": "File already processed",
                }

            # 4. Create new Job record (or resume failed job)
            job_id = str(uuid.uuid4())
            verification_token = secrets.token_urlsafe(32)

            job = Job(
                job_id=job_id,
                verification_token=verification_token,
                profile_id=profile.id,
                recording_id=recording.id,
                audio_file_id=audio_file.id,
                filename=data.filename,
                file_hash=file_hash,
                output_name=output_name,
                status="processing",
            )
            session.add(job)
            await session.commit()

        # 5. Create job payload with verification token in callback URL
        backend_url = state.backend_url
        callback_url = f"{backend_url}/api/jobs/{job_id}/complete/{verification_token}"

        job_payload = ProcessingJob(
            job_id=job_id,
            verification_token=verification_token,
            profile_name=profile_name,
            strategy_name=profile.strategy_name,
            input_key=f"inputs/{profile_name}/{data.filename}",
            output_name=output_name,
            output_config=profile.output,
            callback_url=callback_url,
        )

        # 6. Trigger GPU worker (fire-and-forget)
        import httpx

        gpu_worker_url = config.gpu_worker_url.rstrip("/")

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.post(
                    gpu_worker_url,
                    json=job_payload.model_dump(),
                )
                _ = response.raise_for_status()
        except httpx.TimeoutException:
            # Timeout is acceptable - worker may take longer but job is queued
            pass
        except httpx.HTTPError as e:
            print(f"Warning: Failed to trigger GPU worker: {e}")
            # Don't fail the upload - job is in database and can be retried

        print(f"Job {job_id} created for {output_name}")

        return {
            "job_id": job_id,
            "status": "processing",
        }

    finally:
        # Cleanup temp file
        temp_path.unlink(missing_ok=True)
