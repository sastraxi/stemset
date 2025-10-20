"""Litestar API for Stemset."""

import asyncio
import secrets
from datetime import datetime
from pathlib import Path
from urllib.parse import urlencode

import httpx
from litestar import Litestar, Request, get, post
from litestar.config.cors import CORSConfig
from litestar.datastructures import State
from litestar.exceptions import NotFoundException, NotAuthorizedException
from litestar.response import File, Redirect
from litestar.static_files import create_static_files_router
from pydantic import BaseModel

from .auth import UserInfo, auth_middleware, create_jwt_token, is_auth_bypassed
from .config import get_config, Job, JobStatus
from .models.metadata import StemsMetadata
from .queue import get_queue
from .scanner import FileScanner
from .modern_separator import StemSeparator


# API Response Models


class AuthStatusResponse(BaseModel):
    """Auth status response."""

    authenticated: bool
    email: str | None = None


class ProfileResponse(BaseModel):
    """Profile information response."""

    name: str
    source_folder: str


class FileItem(BaseModel):
    """Processed file item."""

    name: str
    path: str
    created_at: str


class FilesResponse(BaseModel):
    """List of processed files."""

    files: list[FileItem]


class ScanResponse(BaseModel):
    """Scan results response."""

    queued: int
    message: str


class JobResponse(BaseModel):
    """Job information response."""

    id: str
    profile_name: str
    input_file: str
    output_folder: str
    status: JobStatus
    created_at: datetime
    started_at: datetime | None
    completed_at: datetime | None
    output_files: dict[str, str] | None
    error: str | None


class QueueStatusResponse(BaseModel):
    """Queue status response."""

    queue_size: int
    processing: bool
    current_job: JobResponse | None


class FileWithStems(BaseModel):
    """File with stem paths."""

    name: str
    path: str
    stems: dict[str, str]


class JobListResponse(BaseModel):
    """List of jobs."""

    jobs: list[JobResponse]


# Helper functions

# In-memory storage for OAuth state (production should use Redis or similar)
_oauth_states: dict[str, str] = {}


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


# API Endpoints

# Auth Endpoints


@get("/auth/status")
async def get_auth_status(request: Request) -> AuthStatusResponse:
    """Get current authentication status."""
    # If auth is bypassed, return authenticated
    if is_auth_bypassed():
        return AuthStatusResponse(authenticated=True, email="dev@localhost")

    # Check for user email in request state (set by auth middleware)
    user_email = getattr(request.state, "user_email", None)
    if user_email:
        return AuthStatusResponse(authenticated=True, email=user_email)

    return AuthStatusResponse(authenticated=False)


@get("/auth/login")
async def auth_login() -> Redirect:
    """Redirect to Google OAuth login page."""
    config = get_config()
    if config.auth is None:
        raise NotAuthorizedException(detail="Authentication not configured")

    # Generate random state for CSRF protection
    state = secrets.token_urlsafe(32)
    _oauth_states[state] = state

    # Build Google OAuth URL
    params = {
        "client_id": config.auth.google_client_id,
        "redirect_uri": config.auth.redirect_uri,
        "response_type": "code",
        "scope": "openid email profile",
        "state": state,
    }
    auth_url = f"https://accounts.google.com/o/oauth2/v2/auth?{urlencode(params)}"

    return Redirect(path=auth_url)


@get("/auth/callback")
async def auth_callback(code: str, state: str) -> Redirect:
    """Handle Google OAuth callback."""
    config = get_config()
    if config.auth is None:
        raise NotAuthorizedException(detail="Authentication not configured")

    # Validate state
    if state not in _oauth_states:
        raise NotAuthorizedException(detail="Invalid state parameter")
    _oauth_states.pop(state)

    # Exchange code for tokens
    async with httpx.AsyncClient() as client:
        token_response = await client.post(
            "https://oauth2.googleapis.com/token",
            data={
                "code": code,
                "client_id": config.auth.google_client_id,
                "client_secret": config.auth.google_client_secret,
                "redirect_uri": config.auth.redirect_uri,
                "grant_type": "authorization_code",
            },
        )
        token_response.raise_for_status()
        tokens = token_response.json()

        # Get user info
        userinfo_response = await client.get(
            "https://www.googleapis.com/oauth2/v2/userinfo",
            headers={"Authorization": f"Bearer {tokens['access_token']}"},
        )
        userinfo_response.raise_for_status()
        userinfo = UserInfo(**userinfo_response.json())

    # Check if email is allowed
    from .auth import is_email_allowed

    if not is_email_allowed(userinfo.email, config):
        raise NotAuthorizedException(detail=f"Email {userinfo.email} is not authorized")

    # Create JWT token
    jwt_token = create_jwt_token(userinfo.email, config.auth.jwt_secret)

    # Redirect to frontend with token in cookie
    response = Redirect(path="/")
    response.set_cookie(
        key="stemset_token",
        value=jwt_token,
        httponly=True,
        secure=True,  # Only send over HTTPS in production
        samesite="lax",
        max_age=30 * 24 * 60 * 60,  # 30 days
    )
    return response


@get("/auth/logout")
async def auth_logout() -> Redirect:
    """Logout user by clearing token cookie."""
    response = Redirect(path="/")
    response.delete_cookie(key="stemset_token")
    return response


# API Endpoints


@get("/api/profiles")
async def get_profiles() -> list[ProfileResponse]:
    """Get all configured profiles."""
    config = get_config()
    return [
        ProfileResponse(name=p.name, source_folder=p.source_folder)
        for p in config.profiles
    ]


@get("/api/profiles/{profile_name:str}")
async def get_profile(profile_name: str) -> ProfileResponse:
    """Get a specific profile by name."""
    config = get_config()
    profile = config.get_profile(profile_name)
    if profile is None:
        raise NotFoundException(detail=f"Profile '{profile_name}' not found")

    return ProfileResponse(name=profile.name, source_folder=profile.source_folder)


@get("/api/profiles/{profile_name:str}/files")
async def get_profile_files(profile_name: str) -> list[FileWithStems]:
    """Get all processed files for a profile."""
    config = get_config()
    profile = config.get_profile(profile_name)
    if profile is None:
        raise NotFoundException(detail=f"Profile '{profile_name}' not found")

    media_path = profile.get_media_path()
    if not media_path.exists():
        return []

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
                    FileWithStems(
                        name=folder.name,
                        path=str(folder),
                        stems=stems,
                    )
                )

    return files


@get("/api/profiles/{profile_name:str}/files/{file_name:str}/metadata")
async def get_file_metadata(profile_name: str, file_name: str) -> StemsMetadata:
    """Get metadata for a specific processed file."""
    from .models.metadata import StemsMetadata

    config = get_config()
    profile = config.get_profile(profile_name)
    if profile is None:
        raise NotFoundException(detail=f"Profile '{profile_name}' not found")

    media_path = profile.get_media_path()
    metadata_file = media_path / file_name / "metadata.json"

    if not metadata_file.exists():
        raise NotFoundException(detail=f"Metadata not found for '{file_name}'")

    # Load using Pydantic for type safety
    stems_metadata = StemsMetadata.from_file(metadata_file)

    # Return Pydantic model directly - Litestar will serialize it
    return stems_metadata


@get("/api/profiles/{profile_name:str}/songs/{song_name:str}/stems/{stem_name:str}/waveform")
async def get_stem_waveform(profile_name: str, song_name: str, stem_name: str) -> File:
    """Serve waveform PNG for a specific stem.

    The waveform is rendered as white on transparent background.
    Frontend should apply color via CSS filters or canvas operations.
    """
    print(f"Fetching waveform for profile='{profile_name}', song='{song_name}', stem='{stem_name}'")
    config = get_config()
    profile = config.get_profile(profile_name)
    if profile is None:
        raise NotFoundException(detail=f"Profile '{profile_name}' not found")

    waveform_path = Path("media") / profile_name / song_name / f"{stem_name}_waveform.png"

    if not waveform_path.exists():
        raise NotFoundException(detail=f"Waveform not found for stem '{stem_name}'")

    return File(
        path=waveform_path,
        filename=f"{stem_name}_waveform.png",
        media_type="image/png",
    )


@post("/api/profiles/{profile_name:str}/scan")
async def scan_profile(profile_name: str) -> ScanResponse:
    """Scan a profile for new files and queue them for processing."""
    config = get_config()
    profile = config.get_profile(profile_name)
    if profile is None:
        raise NotFoundException(detail=f"Profile '{profile_name}' not found")

    # Scan for new files
    scanner = FileScanner(profile)
    new_files = scanner.scan_for_new_files()

    # Queue jobs for new files
    queue = get_queue()
    for input_file, output_name in new_files:
        output_folder = profile.get_media_path() / output_name
        _ = queue.add_job(profile_name, input_file, output_folder)

    return ScanResponse(
        queued=len(new_files),
        message=f"Queued {len(new_files)} file(s) for processing",
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

    # Create separator (handles thread limiting internally)
    separator = StemSeparator(profile)

    # Run separation in thread pool (blocking operation)
    # Metadata and waveforms are saved automatically by separate_and_normalize
    loop = asyncio.get_event_loop()
    stem_paths, _stem_metadata = await loop.run_in_executor(
        None, separator.separate_and_normalize, job.input_file, job.output_folder
    )

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
media_router = create_static_files_router(
    path="/media",
    directories=["media"],
)

# Create static file router for serving frontend (production)
# In development, Vite dev server handles this
frontend_dist = Path("frontend/dist")
if frontend_dist.exists():
    frontend_router = create_static_files_router(
        path="/",
        directories=[str(frontend_dist)],
        html_mode=True,  # Serve index.html for client-side routing
    )
    static_handlers = [media_router, frontend_router]
else:
    static_handlers = [media_router]

# CORS configuration for frontend (dev mode)
cors_config = CORSConfig(
    allow_origins=["http://localhost:5173", "http://localhost:3000"],  # Vite/React default ports
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
    allow_credentials=True,  # Allow cookies for JWT
)

# Create Litestar app
app = Litestar(
    route_handlers=[
        # Auth endpoints
        get_auth_status,
        auth_login,
        auth_callback,
        auth_logout,
        # API endpoints
        get_profiles,
        get_profile,
        get_profile_files,
        get_file_metadata,
        get_stem_waveform,
        scan_profile,
        get_queue_status,
        get_jobs,
        get_job,
        # Static files
        *static_handlers,
    ],
    middleware=[auth_middleware],
    on_startup=[on_startup],
    on_shutdown=[on_shutdown],
    cors_config=cors_config,
)
