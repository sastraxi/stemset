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

from .models import JobStatusResponse, TriggerProcessingRequest
from ..config import Config
from ..storage import get_storage
from ..gpu_worker.models import ProcessingJob, ProcessingResult
from ..utils import compute_file_hash
from ..cli.scanner import derive_output_name


# Simple in-memory job storage
# In production, this should be a database or Redis
_jobs: dict[str, ProcessingResult] = {}


@post("/api/jobs/{job_id}/complete")
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


@get("/api/jobs/{job_id}/status")
async def job_status(job_id: str) -> JobStatusResponse:
    """Get status of a processing job.

    Args:
        job_id: Job identifier

    Returns:
        Job status

    Raises:
        NotFoundException: If job not found
    """
    if job_id not in _jobs:
        raise NotFoundException(f"Job {job_id} not found")

    result = _jobs[job_id]

    return JobStatusResponse(
        job_id=job_id,
        status=result.status,
        stems=result.stems,
        error=result.error,
    )


@post("/api/process")
async def trigger_processing(
    data: TriggerProcessingRequest,
    state: State,
) -> JobStatusResponse:
    """Trigger remote GPU processing for an uploaded file.

    This endpoint is used by the web frontend to start processing
    after uploading a file.

    Args:
        data: Processing request with profile and file info
        state: Litestar application state

    Returns:
        Job status with job_id for polling

    Raises:
        ValueError: If GPU worker not configured or profile not found
    """
    config: Config = state.config

    if config.gpu_worker_url is None:
        raise ValueError(
            "Remote processing requires gpu_worker_url in config.yaml"
        )

    # Get profile
    profile = config.get_profile(data.profile_name)
    if profile is None:
        raise ValueError(f"Profile '{data.profile_name}' not found")

    # Generate job ID
    job_id = str(uuid.uuid4())

    # Assume file is already uploaded to R2 at inputs/{profile}/{filename}
    input_key = f"inputs/{data.profile_name}/{data.filename}"

    # Create job payload
    job = ProcessingJob(
        job_id=job_id,
        profile_name=data.profile_name,
        strategy_name=profile.strategy,
        input_key=input_key,
        output_name=data.output_name,
        output_config=profile.output,
        callback_url=f"{state.base_url}/api/jobs/{job_id}/complete",
    )

    # Trigger GPU worker (non-blocking)
    import httpx

    gpu_worker_url = config.gpu_worker_url.rstrip("/")

    async with httpx.AsyncClient(timeout=30.0) as client:
        # Fire and forget - GPU worker will call back
        await client.post(
            f"{gpu_worker_url}/process",
            json=job.model_dump(),
        )

    # Return job ID for polling
    return JobStatusResponse(
        job_id=job_id,
        status="processing",
        stems=None,
        error=None,
    )


@post("/api/upload")
async def upload_file(
    data: Annotated[UploadFile, Body(media_type=RequestEncodingType.MULTI_PART)],
    profile_name: str,
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
            f"Unsupported file type: {file_ext}. "
            f"Allowed: {', '.join(sorted(ALLOWED_EXTENSIONS))}"
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

        # Create job payload
        job = ProcessingJob(
            job_id=job_id,
            profile_name=profile_name,
            strategy_name=profile.strategy,
            input_key=f"inputs/{profile_name}/{data.filename}",
            output_name=output_name,
            output_config=profile.output,
            callback_url=f"{state.base_url}/api/jobs/{job_id}/complete",
        )

        # Trigger GPU worker (non-blocking)
        import httpx

        gpu_worker_url = config.gpu_worker_url.rstrip("/")

        async with httpx.AsyncClient(timeout=30.0) as client:
            # Fire and forget - GPU worker will call back
            await client.post(
                f"{gpu_worker_url}/process",
                json=job.model_dump(),
            )

        print(f"Job {job_id} created for {output_name}")

        # Return job ID for polling
        return JobStatusResponse(
            job_id=job_id,
            status="processing",
            stems=None,
            error=None,
        )

    finally:
        # Cleanup temp file
        temp_path.unlink(missing_ok=True)
