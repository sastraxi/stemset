"""Bidirectional sync between local media and R2 storage."""

import logging
import os
from ..config import Config, Profile
from ..storage import R2Storage

logger = logging.getLogger(__name__)


def should_sync() -> bool:
    """Check if sync is enabled via environment variable."""
    return os.getenv("STEMSET_SYNC", "true").lower() == "true"


def sync_profile_from_r2(config: Config, profile: Profile) -> None:
    """Download any files from R2 that don't exist locally or are newer.

    R2 is the source of truth - if a file exists in R2:
    - If it doesn't exist locally, download it
    - If it exists locally but R2 version is newer, overwrite local

    Args:
        config: Global configuration
        profile: Profile to sync
    """
    if not should_sync():
        return

    if config.r2 is None:
        return  # No R2 configured, nothing to sync

    r2 = R2Storage(config.r2)
    local_media_path = profile.get_media_path()

    # Get list of all output folders in R2
    r2_folders = r2.list_files(profile.name)

    if not r2_folders:
        return  # Nothing in R2 to download

    print(f"Syncing from R2 for profile '{profile.name}'...")
    downloaded_count = 0
    updated_count = 0

    for folder_name in r2_folders:
        local_folder = local_media_path / folder_name
        local_folder.mkdir(parents=True, exist_ok=True)

        # List all objects in this R2 folder
        prefix = f"{profile.name}/{folder_name}/"
        response = r2.s3_client.list_objects_v2(
            Bucket=r2.config.bucket_name,
            Prefix=prefix,
        )

        for obj in response.get("Contents", []):
            key = obj.get("Key")
            if not key:
                logger.warning("R2 object with no Key found, skipping", extra=obj)
                continue

            filename = key[len(prefix) :]  # Remove prefix to get filename

            if not filename:  # Skip the folder itself
                continue

            local_file = local_media_path / folder_name / filename

            # Download if file doesn't exist or R2 version is newer
            should_download = False
            if not local_file.exists():
                should_download = True
                downloaded_count += 1
            else:
                # Get object metadata to check original-mtime
                head_response = r2.s3_client.head_object(
                    Bucket=r2.config.bucket_name,
                    Key=key,
                )

                local_mtime = local_file.stat().st_mtime

                # Try to get original mtime from metadata
                metadata = head_response.get("Metadata", {})
                original_mtime_str = metadata.get("original-mtime")

                if original_mtime_str:
                    # Use stored original mtime
                    r2_mtime = float(original_mtime_str)
                else:
                    # Fall back to LastModified (for old uploads without metadata)
                    r2_last_modified = obj.get("LastModified")
                    r2_mtime = r2_last_modified.timestamp() if r2_last_modified else 0

                # Compare with small tolerance for floating point
                if abs(r2_mtime - local_mtime) > 1.0 and r2_mtime > local_mtime:
                    should_download = True
                    updated_count += 1

            if should_download:
                r2.s3_client.download_file(
                    r2.config.bucket_name,
                    key,
                    str(local_file),
                )

    if downloaded_count > 0 or updated_count > 0:
        msg = []
        if downloaded_count > 0:
            msg.append(f"Downloaded {downloaded_count} new file(s)")
        if updated_count > 0:
            msg.append(f"Updated {updated_count} file(s)")
        print(f"  ✓ {', '.join(msg)} from R2")


def sync_profile_to_r2(config: Config, profile: Profile) -> None:
    """Upload any local files that don't exist in R2.

    Also uploads newly processed files to R2.
    R2 is source of truth - if file exists in R2, skip upload.

    Args:
        config: Global configuration
        profile: Profile to sync
    """
    if not should_sync():
        return

    if config.r2 is None:
        return  # No R2 configured, nothing to sync

    r2 = R2Storage(config.r2)
    local_media_path = profile.get_media_path()

    if not local_media_path.exists():
        return  # No local files to upload

    # Get list of what's already in R2
    r2_folders = set(r2.list_files(profile.name))

    print(f"Syncing to R2 for profile '{profile.name}'...")
    uploaded_count = 0

    # Upload any local folders not in R2
    for local_folder in local_media_path.iterdir():
        if not local_folder.is_dir() or local_folder.name.startswith("."):
            continue

        folder_name = local_folder.name

        # Check if this folder exists in R2
        if folder_name not in r2_folders:
            print(f"  Uploading new folder: {folder_name}")

            # Upload all files in this folder
            for local_file in local_folder.iterdir():
                if local_file.is_file():
                    r2.upload_file(
                        local_file,
                        profile.name,
                        folder_name,
                        local_file.name,
                    )

            uploaded_count += 1
        else:
            # Folder exists in R2 - check for new files
            # List what's in R2 for this folder
            prefix = f"{profile.name}/{folder_name}/"
            response = r2.s3_client.list_objects_v2(
                Bucket=r2.config.bucket_name,
                Prefix=prefix,
            )

            r2_files: set[str] = set()
            for obj in response.get("Contents", []):
                key = obj.get("Key")
                if not key:
                    logger.warning("R2 object with no Key found, skipping", extra=obj)
                    continue

                filename = key[len(prefix) :]
                if filename:
                    r2_files.add(filename)

            # Upload any local files not in R2
            for local_file in local_folder.iterdir():
                if local_file.is_file() and local_file.name not in r2_files:
                    print(f"  Uploading new file: {folder_name}/{local_file.name}")
                    r2.upload_file(
                        local_file,
                        profile.name,
                        folder_name,
                        local_file.name,
                    )
                    uploaded_count += 1

    if uploaded_count > 0:
        print(f"  ✓ Uploaded {uploaded_count} new file(s) to R2")
