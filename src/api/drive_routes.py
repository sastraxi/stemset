"""API endpoints for Google Drive integration."""

from __future__ import annotations

import secrets
import tempfile
from datetime import datetime
from pathlib import Path

from litestar import get, post
from litestar.exceptions import NotFoundException, ValidationException
from pydantic import BaseModel
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.config import get_engine

from ..db.models import AudioFile, Profile, Recording, User
from ..google_drive import GoogleDriveClient
from ..processor.trigger import trigger_processing
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
    recording_name: str | None = None  # Output name of imported recording (for navigation)
    parent_id: str | None


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
    output_name: str
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
            raise NotFoundException(
                f"Profile '{profile_name}' has no Google Drive folder configured"
            )

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

        # Check which files are already imported and get their recording names
        file_ids = [f.id for f in drive_files.files]
        imported_stmt = (
            select(AudioFile, Recording.output_name)
            .join(Recording, AudioFile.id == Recording.audio_file_id)  # pyright: ignore[reportArgumentType]
            .where(
                AudioFile.profile_id == profile.id,
                AudioFile.source_type == "google_drive",
                AudioFile.source_id.in_(file_ids),  # pyright: ignore[reportAttributeAccessIssue, reportUnknownArgumentType, reportUnknownMemberType]
                Recording.status == "complete",
            )
        )
        imported_result = await session.exec(imported_stmt)
        imported_files_map = {
            af.source_id: output_name for af, output_name in imported_result.all()
        }

        # Build response
        files_info = []
        for drive_file in drive_files.files:
            is_folder = drive_file.mimeType == "application/vnd.google-apps.folder"
            recording_name = imported_files_map.get(drive_file.id)
            is_imported = recording_name is not None

            files_info.append(
                DriveFileInfo(
                    id=drive_file.id,
                    name=drive_file.name,
                    mimeType=drive_file.mimeType,
                    modifiedTime=drive_file.modifiedTime,
                    size=drive_file.size,
                    is_folder=is_folder,
                    is_imported=is_imported,
                    recording_name=recording_name,
                    parent_id=drive_file.parents[0] if drive_file.parents else None,
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
                    output_name=existing_recording.output_name,
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

        await trigger_processing(
            recording=recording,
            profile=profile,
            input_filename=data.file_name,
            config=state.config,
            backend_url=state.backend_url,
        )

        return DriveImportResponse(
            recording_id=str(recording.id),
            output_name=recording.output_name,
            status="processing",
            message="File imported and processing started",
        )

    finally:
        if temp_path and temp_path.exists():
            temp_path.unlink(missing_ok=True)


@post("/api/webhooks/drive")
async def receive_drive_webhook(
    request: AppRequest,
    state: AppState,
) -> dict[str, str]:
    """Receive Google Drive push notifications for file changes.

    This endpoint receives notifications when files are added/modified/deleted in
    watched Drive folders. We filter for new file additions and auto-import them.

    Google Drive sends these headers:
    - X-Goog-Channel-ID: Our channel UUID
    - X-Goog-Resource-State: sync|add|update|trash|change
    - X-Goog-Resource-ID: Opaque resource ID
    - X-Goog-Changed: properties|content|parents (optional, for changes)

    Args:
        request: HTTP request with Drive webhook headers
        state: Application state

    Returns:
        Success acknowledgment

    Note:
        This endpoint is excluded from JWT authentication.
        Google Drive expects a 200 OK response within a few seconds.
        We acknowledge immediately and process asynchronously.
    """
    headers = request.headers

    # Extract webhook headers
    channel_id = headers.get("x-goog-channel-id")
    resource_state = headers.get("x-goog-resource-state")
    resource_id = headers.get("x-goog-resource-id")

    if not channel_id or not resource_state:
        print("Warning: Received Drive webhook without required headers")
        return {"status": "ignored"}

    # Ignore sync notifications (initial handshake)
    if resource_state == "sync":
        print(f"Drive webhook sync received for channel {channel_id}")
        return {"status": "ok"}

    print(f"Drive webhook received: channel={channel_id}, state={resource_state}, resource={resource_id}")

    # We only care about new file additions
    # For "change" events, Google doesn't tell us what changed, so we'd need to poll
    # the folder to detect new files. For now, stick to "add" events only.
    if resource_state != "add":
        print(f"Ignoring non-add event: {resource_state}")
        return {"status": "ignored"}

    # Look up subscription to find profile
    engine = get_engine()

    async with AsyncSession(engine, expire_on_commit=False) as session:
        from ..db.models import DriveWebhookSubscription

        subscription_stmt = (
            select(DriveWebhookSubscription, Profile)
            .join(Profile, DriveWebhookSubscription.profile_id == Profile.id)  # pyright: ignore[reportArgumentType]
            .where(DriveWebhookSubscription.channel_id == channel_id)
            .where(DriveWebhookSubscription.is_active == True)  # noqa: E712
        )
        subscription_result = await session.exec(subscription_stmt)
        subscription_data = subscription_result.first()

        if not subscription_data:
            print(f"Warning: No active subscription found for channel {channel_id}")
            return {"status": "ignored"}

        subscription, profile = subscription_data

        # Get user refresh token from profile owner
        # Assumes first user associated with profile has Drive access
        user_profile_stmt = (
            select(User)
            .join(
                User.profiles,  # pyright: ignore[reportArgumentType]
            )
            .where(Profile.id == profile.id)  # pyright: ignore[reportAttributeAccessIssue]
        )
        user_result = await session.exec(user_profile_stmt)
        user = user_result.first()

        if not user or not user.google_refresh_token:
            print(f"Warning: No user with refresh token for profile {profile.name}")
            return {"status": "error", "message": "No user refresh token"}

        # Fetch folder contents to find new files
        drive_client = GoogleDriveClient(state.config, user.google_refresh_token)
        drive_files = await drive_client.list_folder_contents(subscription.drive_folder_id)

        # Filter to audio files only (folders already filtered by list_folder_contents)
        audio_files = [f for f in drive_files.files if not f.mimeType.startswith("application/")]

        # Check which ones are not imported
        file_ids = [f.id for f in audio_files]
        imported_stmt = select(AudioFile.source_id).where(  # pyright: ignore[reportAttributeAccessIssue]
            AudioFile.profile_id == profile.id,
            AudioFile.source_type == "google_drive",
            AudioFile.source_id.in_(file_ids),  # pyright: ignore[reportAttributeAccessIssue, reportUnknownArgumentType, reportUnknownMemberType]
        )
        imported_result = await session.exec(imported_stmt)
        imported_ids = {source_id for source_id in imported_result.all()}

        # Find new files
        new_files = [f for f in audio_files if f.id not in imported_ids]

        if not new_files:
            print(f"No new audio files found in folder {subscription.drive_folder_id}")
            return {"status": "ok", "message": "No new files"}

        print(f"Found {len(new_files)} new audio files to auto-import")

        # Import each new file
        imported_count = 0
        for drive_file in new_files:
            try:
                # Use existing import logic
                import_request = DriveImportRequest(
                    file_id=drive_file.id,
                    file_name=drive_file.name,
                    file_size=drive_file.size or 0,
                    modified_time=drive_file.modifiedTime,
                    parent_id=drive_file.parents[0] if drive_file.parents else None,
                )

                # Create a mock request with user context for import
                import_response = await import_drive_file(
                    profile_name=profile.name,
                    data=import_request,
                    state=state,
                    request=request._replace(user=user),  # pyright: ignore[reportAttributeAccessIssue]
                )

                print(
                    f"Auto-imported {drive_file.name} → {import_response.output_name} "
                    f"(recording_id={import_response.recording_id})"
                )
                imported_count += 1

            except Exception as e:
                print(f"Error auto-importing {drive_file.name}: {e}")
                # Continue with other files
                continue

        return {
            "status": "ok",
            "message": f"Auto-imported {imported_count} files",
        }

