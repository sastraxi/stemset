"""Litestar API for Stemset."""

import asyncio
import json
from pathlib import Path
from typing import List, Optional

from litestar import Litestar, MediaType, get, post
from litestar.config.cors import CORSConfig
from litestar.datastructures import State
from litestar.response import File, Response
from litestar.static_files import create_static_files_router

from .config import Profile, get_config
from .queue import Job, JobStatus, get_queue
from .scanner import FileScanner
from .separator import StemSeparator


# API Response Models (using plain dicts for simplicity)


@get("/api/profiles")
async def get_profiles() -> List[dict]:
    """Get all configured profiles."""
    config = get_config()
    return [
        {
            "name": p.name,
            "source_folder": p.source_folder,
            "target_lufs": p.target_lufs,
            "stem_gains": {
                "vocals": p.stem_gains.vocals,
                "drums": p.stem_gains.drums,
                "bass": p.stem_gains.bass,
                "other": p.stem_gains.other,
            },
        }
        for p in config.profiles
    ]


@get("/api/profiles/{profile_name:str}")
async def get_profile(profile_name: str) -> dict:
    """Get a specific profile by name."""
    config = get_config()
    profile = config.get_profile(profile_name)
    if profile is None:
        return Response(
            content={"error": f"Profile '{profile_name}' not found"},
            status_code=404,
        )

    return {
        "name": profile.name,
        "source_folder": profile.source_folder,
        "target_lufs": profile.target_lufs,
        "stem_gains": {
            "vocals": profile.stem_gains.vocals,
            "drums": profile.stem_gains.drums,
            "bass": profile.stem_gains.bass,
            "other": profile.stem_gains.other,
        },
    }


@get("/api/profiles/{profile_name:str}/files")
async def get_profile_files(profile_name: str) -> dict:
    """Get all processed files for a profile."""
    config = get_config()
    profile = config.get_profile(profile_name)
    if profile is None:
        return Response(
            content={"error": f"Profile '{profile_name}' not found"},
            status_code=404,
        )

    media_path = profile.get_media_path()
    if not media_path.exists():
        return {"files": []}

    files = []
    for folder in media_path.iterdir():
        if folder.is_dir() and not folder.name.startswith("."):
            # Check if stems exist (both .wav and .opus)
            stems = {}
            for stem_name in ["vocals", "drums", "bass", "other"]:
                # Check for both formats
                for ext in [".opus", ".wav"]:
                    stem_path = folder / f"{stem_name}{ext}"
                    if stem_path.exists():
                        stems[stem_name] = f"/media/{profile_name}/{folder.name}/{stem_name}{ext}"
                        break

            if stems:
                files.append(
                    {
                        "name": folder.name,
                        "path": str(folder),
                        "stems": stems,
                    }
                )

    return {"files": files}


@get("/api/profiles/{profile_name:str}/files/{file_name:str}/metadata")
async def get_file_metadata(profile_name: str, file_name: str) -> dict:
    """Get metadata for a specific processed file."""
    config = get_config()
    profile = config.get_profile(profile_name)
    if profile is None:
        return Response(
            content={"error": f"Profile '{profile_name}' not found"},
            status_code=404,
        )

    media_path = profile.get_media_path()
    metadata_file = media_path / file_name / "metadata.json"

    if not metadata_file.exists():
        return Response(
            content={"error": f"Metadata not found for '{file_name}'"},
            status_code=404,
        )

    with open(metadata_file, "r") as f:
        metadata = json.load(f)

    return metadata


@post("/api/profiles/{profile_name:str}/scan")
async def scan_profile(profile_name: str, state: State) -> dict:
    """Scan a profile for new files and queue them for processing."""
    config = get_config()
    profile = config.get_profile(profile_name)
    if profile is None:
        return Response(
            content={"error": f"Profile '{profile_name}' not found"},
            status_code=404,
        )

    # Scan for new files
    scanner = FileScanner(profile)
    new_files = scanner.scan_for_new_files()

    # Queue jobs for new files
    queue = get_queue()
    jobs = []
    for input_file, output_name in new_files:
        output_folder = profile.get_media_path() / output_name
        job = queue.add_job(profile_name, input_file, output_folder)
        jobs.append(
            {
                "id": job.id,
                "input_file": str(job.input_file),
                "output_folder": str(job.output_folder),
                "status": job.status.value,
            }
        )

    return {
        "scanned": len(new_files),
        "jobs": jobs,
    }


@get("/api/queue")
async def get_queue_status() -> dict:
    """Get the current queue status."""
    queue = get_queue()

    current_job_info = None
    if queue.current_job:
        current_job_info = {
            "id": queue.current_job.id,
            "profile": queue.current_job.profile_name,
            "input_file": str(queue.current_job.input_file),
            "status": queue.current_job.status.value,
            "started_at": queue.current_job.started_at.isoformat()
            if queue.current_job.started_at
            else None,
        }

    return {
        "queue_size": queue.get_queue_size(),
        "is_processing": queue.is_processing(),
        "current_job": current_job_info,
    }


@get("/api/jobs")
async def get_jobs(profile: Optional[str] = None) -> dict:
    """Get all jobs, optionally filtered by profile."""
    queue = get_queue()

    if profile:
        jobs = queue.get_jobs_by_profile(profile)
    else:
        jobs = queue.get_all_jobs()

    return {
        "jobs": [
            {
                "id": job.id,
                "profile": job.profile_name,
                "input_file": str(job.input_file),
                "output_folder": str(job.output_folder),
                "status": job.status.value,
                "created_at": job.created_at.isoformat(),
                "started_at": job.started_at.isoformat() if job.started_at else None,
                "completed_at": job.completed_at.isoformat() if job.completed_at else None,
                "error": job.error,
                "output_files": job.output_files,
            }
            for job in jobs
        ]
    }


@get("/api/jobs/{job_id:str}")
async def get_job(job_id: str) -> dict:
    """Get a specific job by ID."""
    queue = get_queue()
    job = queue.get_job(job_id)

    if job is None:
        return Response(
            content={"error": f"Job '{job_id}' not found"},
            status_code=404,
        )

    return {
        "id": job.id,
        "profile": job.profile_name,
        "input_file": str(job.input_file),
        "output_folder": str(job.output_folder),
        "status": job.status.value,
        "created_at": job.created_at.isoformat(),
        "started_at": job.started_at.isoformat() if job.started_at else None,
        "completed_at": job.completed_at.isoformat() if job.completed_at else None,
        "error": job.error,
        "output_files": job.output_files,
    }


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

    # Create separator (handles thread limiting internally)
    separator = StemSeparator(profile)

    # Run separation in thread pool (blocking operation)
    loop = asyncio.get_event_loop()
    stem_paths, stem_metadata = await loop.run_in_executor(
        None, separator.separate_and_normalize, job.input_file, job.output_folder
    )

    # Save metadata to JSON file alongside stems
    metadata_file = job.output_folder / "metadata.json"
    with open(metadata_file, "w") as f:
        json.dump(stem_metadata, f, indent=2)

    # Convert paths to strings
    return {name: str(path) for name, path in stem_paths.items()}


async def on_startup() -> None:
    """Start the queue processor on app startup."""
    queue = get_queue()
    await queue.start_processing(process_job)
    print("Queue processor started")


async def on_shutdown() -> None:
    """Stop the queue processor on app shutdown."""
    queue = get_queue()
    await queue.stop_processing()
    print("Queue processor stopped")


# Create static file router for serving media files
static_router = create_static_files_router(
    path="/media",
    directories=["media"],
)

# CORS configuration for frontend
cors_config = CORSConfig(
    allow_origins=["http://localhost:5173", "http://localhost:3000"],  # Vite/React default ports
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

# Create Litestar app
app = Litestar(
    route_handlers=[
        get_profiles,
        get_profile,
        get_profile_files,
        get_file_metadata,
        scan_profile,
        get_queue_status,
        get_jobs,
        get_job,
        static_router,
    ],
    on_startup=[on_startup],
    on_shutdown=[on_shutdown],
    cors_config=cors_config,
)
