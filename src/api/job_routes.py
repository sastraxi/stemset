"""Job queue and processing endpoints."""

from __future__ import annotations

import asyncio

from litestar import get
from litestar.exceptions import NotFoundException

from ..config import Job, get_config
from ..modern_separator import StemSeparator
from ..queue import get_queue
from .models import JobListResponse, JobResponse, QueueStatusResponse


def job_to_response(job: Job) -> JobResponse:
    """Convert Job to JobResponse."""
    return JobResponse(
        id=job.id,
        profile_name=job.profile_name,
        input_file=str(job.input_file),
        output_folder=str(job.output_folder),
        status=job.status,
        created_at=job.created_at,
        started_at=job.started_at,
        completed_at=job.completed_at,
        output_files={k: str(v) for k, v in job.output_files.items()} if job.output_files else None,
        error=job.error,
    )


@get("/api/queue")
async def get_queue_status() -> QueueStatusResponse:
    """Get the current queue status."""
    queue = get_queue()

    current_job_response = None
    if queue.current_job:
        current_job_response = job_to_response(queue.current_job)

    return QueueStatusResponse(
        queue_size=queue.get_queue_size(),
        processing=queue.is_processing(),
        current_job=current_job_response,
    )


@get("/api/jobs")
async def get_jobs(profile: str | None = None) -> JobListResponse:
    """Get all jobs, optionally filtered by profile."""
    queue = get_queue()

    if profile:
        jobs = queue.get_jobs_by_profile(profile)
    else:
        jobs = queue.get_all_jobs()

    return JobListResponse(jobs=[job_to_response(job) for job in jobs])


@get("/api/jobs/{job_id:str}")
async def get_job(job_id: str) -> JobResponse:
    """Get a specific job by ID."""
    queue = get_queue()
    job = queue.get_job(job_id)

    if job is None:
        raise NotFoundException(detail=f"Job '{job_id}' not found")

    return job_to_response(job)


async def process_job(job: Job) -> dict[str, str]:
    """Process a job by separating stems.

    Args:
        job: The job to process

    Returns:
        Dict mapping stem names to output file paths
    """
    config = get_config()
    profile = config.get_profile(job.profile_name)

    if profile is None:
        raise ValueError(f"Profile '{job.profile_name}' not found")

    separator = StemSeparator(profile)

    loop = asyncio.get_event_loop()
    stem_paths, _stem_metadata = await loop.run_in_executor(
        None, separator.separate_and_normalize, job.input_file, job.output_folder
    )

    return {name: str(path) for name, path in stem_paths.items()}
