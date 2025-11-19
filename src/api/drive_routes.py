"""API endpoints for Google Drive integration."""

from __future__ import annotations

import secrets
import tempfile
from datetime import datetime
from pathlib import Path
from uuid import UUID

from litestar import get, post
from litestar.exceptions import NotFoundException, ValidationException
from pydantic import BaseModel
from sqlalchemy.orm import selectinload
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.config import get_engine

from ..db.models import AudioFile, Profile, Recording, User
from ..google_drive import GoogleDriveClient
from ..storage import get_storage
from ..utils import compute_file_hash, derive_output_name
from .state import AppState
from .types import AppRequest


class DriveFileInfo(BaseModel):
    """Drive file metadata for frontend."""

    id: str
    name: str
    mimeType: str
    modifiedTime: str
    size: int | None
    is_folder: bool
    is_imported: bool  # Whether this file has an AudioFile record


class DriveFolderContentsResponse(BaseModel):
    """Response for folder contents listing."""

    files: list[DriveFileInfo]
    nextPageToken: str | None = None


class DriveImportRequest(BaseModel):
    """Request to import a Drive file."""

    file_id: str
    file_name: str
    file_size: int
    modified_time: str  # ISO 8601
    parent_id: str | None


class DriveImportResponse(BaseModel):
    """Response after importing a Drive file."""

    recording_id: str
    status: str
    message: str | None = None


@get("/api/profiles/{profile_name:str}/drive/contents")
async def get_drive_folder_contents(
    profile_name: str,
    folder_id: str | None,
    state: AppState,
    request: AppRequest,
) -> DriveFolderContentsResponse:
    """List contents of a Google Drive folder.

    Args:
        profile_name: Profile name
        folder_id: Drive folder ID (None = use profile's google_drive_folder_id)
        state: Application state
        request: Request with user context

    Returns:
        List of files/folders with import status

    Raises:
        NotFoundException: If profile not found or no Drive folder configured
        ValidationException: If user not authenticated or no refresh token
    """
    if not request.user:
        raise ValidationException("Authentication required")

    engine = get_engine()

    async with AsyncSession(engine, expire_on_commit=False) as session:
        # Get profile
        stmt = select(Profile).where(Profile.name == profile_name)
        result = await session.exec(stmt)
        profile = result.first()

        if not profile:
            raise NotFoundException(f"Profile '{profile_name}' not found")

        # Determine folder ID to list
        target_folder_id = folder_id or profile.google_drive_folder_id

        if not target_folder_id:
            raise NotFoundException(f"Profile '{profile_name}' has no Google Drive folder configured")

        # Get user's refresh token
        user_stmt = select(User).where(User.email == request.user.email)
        user_result = await session.exec(user_stmt)
        user = user_result.first()

        if not user or not user.google_refresh_token:
            raise ValidationException(
                "No Google Drive access token found. Please log out and log in again."
            )

        # Fetch Drive files
        drive_client = GoogleDriveClient(state.config, user.google_refresh_token)
        drive_files = await drive_client.list_folder_contents(target_folder_id)

        # Check which files are already imported
        file_ids = [f.id for f in drive_files.files]
        imported_stmt = select(AudioFile).where(
            AudioFile.profile_id == profile.id,
            AudioFile.source_type == "google_drive",
            AudioFile.source_id.in_(file_ids),  # pyright: ignore[reportAttributeAccessIssue]
        )
        imported_result = await session.exec(imported_stmt)
        imported_files = {af.source_id for af in imported_result.all()}

        # Build response
        files_info = []
        for drive_file in drive_files.files:
            is_folder = drive_file.mimeType == "application/vnd.google-apps.folder"
            is_imported = drive_file.id in imported_files

            files_info.append(
                DriveFileInfo(
                    id=drive_file.id,
                    name=drive_file.name,
                    mimeType=drive_file.mimeType,
                    modifiedTime=drive_file.modifiedTime,
                    size=drive_file.size,
                    is_folder=is_folder,
                    is_imported=is_imported,
                )
            )

        return DriveFolderContentsResponse(
            files=files_info, nextPageToken=drive_files.nextPageToken
        )


@post("/api/profiles/{profile_name:str}/drive/import")
async def import_drive_file(
    profile_name: str,
    data: DriveImportRequest,
    state: AppState,
    request: AppRequest,
) -> DriveImportResponse:
    """Import a Google Drive file and trigger processing.

    Workflow:
    1. Check if already imported (idempotent)
    2. Download file from Drive to temp location
    3. Compute file hash
    4. Upload to storage (R2/local)
    5. Create AudioFile record (source_type="google_drive")
    6. Create Recording and trigger processing

    Args:
        profile_name: Profile name
        data: Drive file metadata
        state: Application state
        request: Request with user context

    Returns:
        Recording ID and status

    Raises:
        NotFoundException: If profile not found
        ValidationException: If user not authenticated or download fails
    """
    if not request.user:
        raise ValidationException("Authentication required")

    engine = get_engine()

    async with AsyncSession(engine, expire_on_commit=False) as session:
        # Get profile
        stmt = select(Profile).where(Profile.name == profile_name)
        result = await session.exec(stmt)
        profile = result.first()

        if not profile:
            raise NotFoundException(f"Profile '{profile_name}' not found")

        # Get user's refresh token
        user_stmt = select(User).where(User.email == request.user.email)
        user_result = await session.exec(user_stmt)
        user = user_result.first()

        if not user or not user.google_refresh_token:
            raise ValidationException(
                "No Google Drive access token found. Please log out and log in again."
            )

        # Check if already imported
        existing_stmt = select(AudioFile).where(
            AudioFile.profile_id == profile.id,
            AudioFile.source_type == "google_drive",
            AudioFile.source_id == data.file_id,
        )
        existing_result = await session.exec(existing_stmt)
        existing_audio_file = existing_result.first()

        if existing_audio_file:
            # Check if recording exists and is complete
            recording_stmt = (
                select(Recording)
                .where(Recording.audio_file_id == existing_audio_file.id)
                .order_by(Recording.created_at.desc())  # pyright: ignore[reportAttributeAccessIssue]
            )
            recording_result = await session.exec(recording_stmt)
            existing_recording = recording_result.first()

            if existing_recording and existing_recording.status == "complete":
                return DriveImportResponse(
                    recording_id=str(existing_recording.id),
                    status="complete",
                    message="File already imported and processed",
                )

    # Download file from Drive to temp location
    file_ext = Path(data.file_name).suffix.lower()
    temp_path = None

    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=file_ext) as temp_file:
            temp_path = Path(temp_file.name)

        drive_client = GoogleDriveClient(state.config, user.google_refresh_token)
        await drive_client.download_file(data.file_id, str(temp_path))

        # Compute file hash
        file_hash = compute_file_hash(temp_path)

        # Upload to storage
        storage = get_storage(state.config)
        print(f"Uploading {data.file_name} from Drive to storage (inputs/{profile_name}/)")
        _ = storage.upload_input_file(temp_path, profile_name, data.file_name)

        # Parse modified time to Unix timestamp
        modified_dt = datetime.fromisoformat(data.modified_time.replace("Z", "+00:00"))
        source_modified_time = int(modified_dt.timestamp())

        # Create database records
        async with AsyncSession(engine, expire_on_commit=False) as session:
            # Create AudioFile (or get existing if we just checked and missed it)
            stmt = select(AudioFile).where(
                AudioFile.profile_id == profile.id,
                AudioFile.source_type == "google_drive",
                AudioFile.source_id == data.file_id,
            )
            result = await session.exec(stmt)
            audio_file = result.first()

            if not audio_file:
                audio_file = AudioFile(
                    profile_id=profile.id,
                    source_type="google_drive",
                    source_id=data.file_id,
                    source_parent_id=data.parent_id,
                    source_modified_time=source_modified_time,
                    filename=data.file_name,
                    file_hash=file_hash,
                    file_size_bytes=data.file_size,
                )
                session.add(audio_file)
                await session.commit()
                await session.refresh(audio_file)

            # Create Recording
            base_output_name = derive_output_name(Path(data.file_name))
            output_name = f"{base_output_name}_{file_hash[:8]}"

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

        # Trigger processing (same as upload flow)
        from litestar.background_tasks import BackgroundTask

        from ..processor.local import process_locally

        # For now, use local processing (can extend to Modal later)
        print(f"[Drive Import] Queueing recording {recording.id} for background processing")

        # Start background task
        task = BackgroundTask(
            _process_drive_file,
            str(recording.id),
            state.config,
        )

        # Execute task in background (Litestar will handle this)
        await task()

        return DriveImportResponse(
            recording_id=str(recording.id),
            status="processing",
            message="File imported and processing started",
        )

    finally:
        if temp_path and temp_path.exists():
            temp_path.unlink(missing_ok=True)


async def _process_drive_file(recording_id: str, config) -> None:
    """Background task to process Drive file.

    Args:
        recording_id: Recording identifier
        config: Application config
    """
    from ..processor.local import process_locally

    await process_locally(UUID(recording_id), config)
