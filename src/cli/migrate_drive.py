"""Drive file migration - match existing uploaded files to Google Drive sources."""

from __future__ import annotations

from datetime import datetime

import typer
from sqlmodel import col, select
from sqlmodel.ext.asyncio.session import AsyncSession

from ..config import Config
from ..db.config import get_engine
from ..db.models import AudioFile, Profile, User
from ..google_drive import DriveFile, GoogleDriveClient


class MigrationStats:
    """Statistics for migration run."""

    def __init__(self) -> None:
        self.total_drive_files: int = 0
        self.files_without_hash: int = 0
        self.matched_files: int = 0
        self.unmatched_uploads: int = 0
        self.skipped_already_drive: int = 0
        self.collision_count: int = 0

    def print_summary(self) -> None:
        """Print migration summary."""
        typer.echo("\n" + "=" * 60)
        typer.echo("Migration Summary")
        typer.echo("=" * 60)
        typer.echo(f"Total Drive files scanned:        {self.total_drive_files}")
        typer.echo(f"Files without SHA256 hash:        {self.files_without_hash}")
        typer.echo(f"Matched & updated:                {self.matched_files}")
        typer.echo(f"Collisions (same hash):           {self.collision_count}")
        typer.echo(f"Unmatched uploads (no Drive src): {self.unmatched_uploads}")
        typer.echo(f"Already Drive sources (skipped):  {self.skipped_already_drive}")
        typer.echo("=" * 60)


async def collect_drive_files(
    client: GoogleDriveClient, folder_id: str, stats: MigrationStats
) -> dict[str, DriveFile]:
    """Recursively collect all Drive files with their SHA256 hashes.

    Args:
        client: Authenticated Google Drive client
        folder_id: Root folder ID to scan
        stats: Migration statistics to update

    Returns:
        Mapping of sha256Checksum -> DriveFile (most recently modified if collision)
    """
    hash_to_file: dict[str, DriveFile] = {}
    folders_to_scan = [folder_id]

    while folders_to_scan:
        current_folder = folders_to_scan.pop()
        page_token: str | None = None

        while True:
            file_list = await client.list_folder_contents(current_folder, page_token)

            for drive_file in file_list.files:
                stats.total_drive_files += 1

                # Queue subfolders for scanning
                if drive_file.mimeType == "application/vnd.google-apps.folder":
                    folders_to_scan.append(drive_file.id)
                    continue

                # Skip files without SHA256 hash
                if not drive_file.sha256Checksum:
                    stats.files_without_hash += 1
                    typer.echo(f"  ⚠ Skipping {drive_file.name} (no SHA256 hash)", err=True)
                    continue

                # Handle hash collisions: keep most recently modified
                existing = hash_to_file.get(drive_file.sha256Checksum)
                if existing:
                    if existing.name == drive_file.name:
                        # Same file, skip
                        continue

                    stats.collision_count += 1
                    existing_time = datetime.fromisoformat(
                        existing.modifiedTime.replace("Z", "+00:00")
                    )
                    current_time = datetime.fromisoformat(
                        drive_file.modifiedTime.replace("Z", "+00:00")
                    )
                    if current_time > existing_time:
                        typer.echo(
                            f"  ℹ Collision: {drive_file.name} is newer than {existing.name}, using newer"
                        )
                        hash_to_file[drive_file.sha256Checksum] = drive_file
                    else:
                        typer.echo(
                            f"  ℹ Collision: {existing.name} is newer than {drive_file.name}, keeping existing"
                        )
                else:
                    hash_to_file[drive_file.sha256Checksum] = drive_file

            # Check for next page
            if not file_list.nextPageToken:
                break
            page_token = file_list.nextPageToken

    return hash_to_file


async def migrate_profile_drive_files(
    profile_name: str, config: Config, dry_run: bool = False
) -> None:
    """Migrate uploaded files to Drive sources for a profile.

    Args:
        profile_name: Name of the profile to migrate
        config: Application configuration
        dry_run: If True, report matches without updating database

    Raises:
        ValueError: If profile not found or missing Drive folder configuration
    """
    engine = get_engine()
    stats = MigrationStats()

    async with AsyncSession(engine, expire_on_commit=False) as session:
        # Get profile
        stmt = select(Profile).where(Profile.name == profile_name)
        result = await session.exec(stmt)
        profile = result.first()

        if not profile:
            raise ValueError(f"Profile '{profile_name}' not found")

        if not profile.google_drive_folder_id:
            raise ValueError(f"Profile '{profile_name}' has no google_drive_folder_id configured")

        typer.echo(f"Migrating Drive files for profile: {profile.name}")
        typer.echo(f"Drive folder ID: {profile.google_drive_folder_id}")
        typer.echo()

        # Get any user with Drive access (we just need valid credentials)
        # In practice, users with access to this profile should have Drive configured
        user_stmt = select(User).where(col(User.google_refresh_token).isnot(None))
        user_result = await session.exec(user_stmt)
        user = user_result.first()

        if not user or not user.google_refresh_token:
            raise ValueError(
                "No user with Google Drive access found. Ensure at least one user has authenticated with Drive."
            )

        typer.echo(f"Using Drive credentials from: {user.email}")
        typer.echo()

        # Initialize Drive client
        client = GoogleDriveClient(config, user.google_refresh_token)

        # Collect all Drive files recursively
        typer.echo("Scanning Drive folder for audio files...")
        hash_to_drive_file = await collect_drive_files(
            client, profile.google_drive_folder_id, stats
        )
        typer.echo(f"✓ Found {len(hash_to_drive_file)} unique Drive files with SHA256 hashes\n")

        # Get all AudioFiles for this profile that are uploads or local scans
        audio_stmt = select(AudioFile).where(
            AudioFile.profile_id == profile.id,
            col(AudioFile.source_type).in_(["upload", "local_scan"]),
        )
        audio_result = await session.exec(audio_stmt)
        audio_files = audio_result.all()

        typer.echo(f"Found {len(audio_files)} uploaded/scanned files in database\n")

        # Match and update
        typer.echo("Matching files by SHA256 hash...")
        for audio_file in audio_files:
            drive_file = hash_to_drive_file.get(audio_file.file_hash)

            if not drive_file:
                stats.unmatched_uploads += 1
                continue

            # Match found!
            stats.matched_files += 1
            modified_timestamp = int(
                datetime.fromisoformat(drive_file.modifiedTime.replace("Z", "+00:00")).timestamp()
            )

            if dry_run:
                typer.echo(f"  [DRY RUN] Would update: {audio_file.filename} -> {drive_file.name}")
                typer.echo(f"    Drive ID: {drive_file.id}")
                typer.echo(f"    Hash: {audio_file.file_hash[:16]}...")
            else:
                audio_file.source_type = "google_drive"
                audio_file.source_id = drive_file.id
                audio_file.source_parent_id = drive_file.parents[0] if drive_file.parents else None
                audio_file.source_modified_time = modified_timestamp
                session.add(audio_file)
                typer.echo(f"  ✓ Updated: {audio_file.filename} -> Drive:{drive_file.name}")

        # Count files already marked as google_drive
        already_drive_stmt = select(AudioFile).where(
            AudioFile.profile_id == profile.id, AudioFile.source_type == "google_drive"
        )
        already_drive_result = await session.exec(already_drive_stmt)
        stats.skipped_already_drive = len(already_drive_result.all())

        # Commit changes
        if not dry_run:
            await session.commit()
            typer.echo("\n✓ Database updated successfully")
        else:
            typer.echo("\n[DRY RUN] No changes committed")

    # Print summary
    stats.print_summary()
