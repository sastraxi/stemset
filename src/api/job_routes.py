"""API endpoints for job management and processing."""

from __future__ import annotations

import tempfile
import uuid
from pathlib import Path
from typing import Annotated
from litestar import post, get
from litestar.params import Body
from litestar.datastructures import State, UploadFile
from litestar.exceptions import NotFoundException, ValidationException
from litestar.enums import RequestEncodingType

from src.api.app import frontend_url

from .models import JobStatusResponse
from ..config import Config
from ..storage import get_storage
from ..gpu_worker.models import ProcessingJob, ProcessingResult
from ..utils import compute_file_hash, derive_output_name


# Simple in-memory job storage
# In production, this should be a database or Redis
_jobs: dict[str, ProcessingResult] = {}
_job_metadata: dict[str, dict[str, str]] = {}  # job_id -> {profile_name, output_name, filename}


@post("/api/jobs/{job_id:str}/complete")
async def job_complete(job_id: str, result: ProcessingResult) -> dict[str, str]:
    """Callback endpoint for GPU worker to report completion.

    Args:
        job_id: Job identifier
        result: Processing result from GPU worker

    Returns:
        Success message
    """
    # Store job result
    _jobs[job_id] = result

    print(f"Job {job_id} completed: {result.status}")
    if result.status == "error":
        print(f"  Error: {result.error}")
    else:
        print(f"  Stems: {result.stems}")

    return {"status": "ok"}


@get("/api/jobs/{job_id:str}/status")
async def job_status(job_id: str, state: State) -> JobStatusResponse:
    """Get status of a processing job with long-polling support.

    Production (with callbacks):
    - Long-polls up to 60s waiting for job completion callback
    - Returns immediately if job completes

    Local dev (no callbacks):
    - Syncs from R2 to local media
    - Checks if output folder exists in file list
    - Returns immediately with status based on file presence

    Args:
        job_id: Job identifier
        state: Litestar application state

    Returns:
        Job status

    Raises:
        NotFoundException: If job not found
    """
    import asyncio
    from ..cli.sync import sync_profile_from_r2, should_sync

    config: Config = state.config

    # Get job metadata from storage
    if job_id not in _jobs:
        # Job hasn't completed via callback yet
        # Try to find it by syncing and checking files (local dev)

        # We need to know which profile this job is for
        # Store job metadata when created
        job_metadata = _job_metadata.get(job_id)
        if job_metadata is None:
            raise NotFoundException(f"Job {job_id} not found")

        profile_name = job_metadata["profile_name"]
        output_name = job_metadata["output_name"]
        filename = job_metadata["filename"]

        # In local dev, sync from R2 and check for file presence
        if should_sync() and config.r2 is not None:
            profile = config.get_profile(profile_name)
            if profile:
                # Sync from R2 (downloads any new files)
                sync_profile_from_r2(config, profile)

                # Check if output folder exists now
                storage = get_storage(config)
                files = storage.list_files(profile_name)

                if output_name in files:
                    # File appeared! Mark as complete
                    return JobStatusResponse(
                        job_id=job_id,
                        profile_name=profile_name,
                        output_name=output_name,
                        filename=filename,
                        status="complete",
                        stems=None,  # We don't know stem names from file presence
                        error=None,
                    )

        # Production: Long-poll for callback (up to 60s)
        max_wait_seconds = 60
        poll_interval = 1.0
        waited = 0.0

        while waited < max_wait_seconds:
            await asyncio.sleep(poll_interval)
            waited += poll_interval

            if job_id in _jobs:
                # Job completed!
                break

        if job_id not in _jobs:
            # Still processing after 60s
            return JobStatusResponse(
                job_id=job_id,
                profile_name=profile_name,
                output_name=output_name,
                filename=filename,
                status="processing",
                stems=None,
                error=None,
            )

    # Job completed via callback
    result = _jobs[job_id]
    job_metadata = _job_metadata[job_id]

    return JobStatusResponse(
        job_id=job_id,
        profile_name=job_metadata["profile_name"],
        output_name=job_metadata["output_name"],
        filename=job_metadata["filename"],
        status=result.status,
        stems=result.stems,
        error=result.error,
    )


@post("/api/upload/{profile_name:str}")
async def upload_file(
    profile_name: str,
    data: Annotated[UploadFile, Body(media_type=RequestEncodingType.MULTI_PART)],
    state: State,
) -> JobStatusResponse:
    """Upload an audio file and trigger GPU processing.

    Args:
        data: Uploaded file
        profile_name: Profile to use for processing
        state: Litestar application state

    Returns:
        Job status with job_id for polling

    Raises:
        ValidationException: If file is invalid (wrong type, too large)
        ValueError: If GPU worker not configured or profile not found
    """
    config: Config = state.config

    # Check GPU worker is configured
    if config.gpu_worker_url is None:
        raise ValueError(
            "File upload requires GPU worker. Set GPU_WORKER_URL environment variable."
        )

    # Get profile
    profile = config.get_profile(profile_name)
    if profile is None:
        raise ValueError(f"Profile '{profile_name}' not found")

    # Validate file size (150MB max)
    MAX_FILE_SIZE = 150 * 1024 * 1024  # 150MB in bytes
    file_size = len(await data.read())
    await data.seek(0)  # Reset for re-reading

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

    # Save to temp file to compute hash
    with tempfile.NamedTemporaryFile(delete=False, suffix=file_ext) as temp_file:
        temp_path = Path(temp_file.name)
        content = await data.read()
        temp_file.write(content)

    try:
        # Compute hash for deduplication
        file_hash = compute_file_hash(temp_path)

        # Derive output name
        base_output_name = derive_output_name(Path(data.filename))
        output_name = f"{base_output_name}_{file_hash[:8]}"

        # Upload to R2
        storage = get_storage(config)
        print(f"Uploading {data.filename} to R2 (inputs/{profile_name}/)")
        storage.upload_input_file(temp_path, profile_name, data.filename)

        # Generate job ID
        job_id = str(uuid.uuid4())

        # Store job metadata for status polling
        _job_metadata[job_id] = {
            "profile_name": profile_name,
            "output_name": output_name,
            "filename": data.filename,
        }

        # Create job payload
        job = ProcessingJob(
            job_id=job_id,
            profile_name=profile_name,
            strategy_name=profile.strategy,
            input_key=f"inputs/{profile_name}/{data.filename}",
            output_name=output_name,
            output_config=profile.output,
            callback_url=f"{frontend_url}/api/jobs/{job_id}/complete",
        )

        # Trigger GPU worker (fire-and-forget)
        import httpx

        gpu_worker_url = config.gpu_worker_url.rstrip("/")

        try:
            async with httpx.AsyncClient(timeout=1.0) as client:
                # Fire and forget - just confirm job was accepted
                _ = await client.post(
                    gpu_worker_url,
                    json=job.model_dump(),
                )
        except httpx.TimeoutException:
            # Timeout is fine - worker may take longer to respond but job is queued
            pass

        print(f"Job {job_id} created for {output_name}")

        # Return immediately for polling
        return JobStatusResponse(
            job_id=job_id,
            profile_name=profile_name,
            output_name=output_name,
            filename=data.filename,
            status="processing",
            stems=None,
            error=None,
        )

    finally:
        # Cleanup temp file
        temp_path.unlink(missing_ok=True)
