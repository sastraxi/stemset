#!/usr/bin/env python3
"""Upload media files to Cloudflare R2.

Uploads stem files and waveforms from local media/ directory to R2 storage.
Requires R2 configuration in config.yaml and .env file.
"""

from __future__ import annotations

import hashlib
import os
import sys
from pathlib import Path
from typing import Annotated

import typer
from botocore.exceptions import ClientError

# Add src to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from dotenv import load_dotenv
from src.config import get_config
from src.storage import get_storage, R2Storage

# Load environment and force R2 storage for this script
_ = load_dotenv()
os.environ["STEMSET_LOCAL_STORAGE"] = "false"


def compute_etag(file_path: Path) -> str:
    """Compute MD5 hash (ETag) for a file.

    S3/R2 uses MD5 hash as the ETag for single-part uploads.
    """
    md5 = hashlib.md5()
    with open(file_path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            md5.update(chunk)
    return md5.hexdigest()


def upload_profile(r2_storage: R2Storage, profile_name: str) -> None:
    """Upload all files for a profile to R2."""
    print(f"\n📤 Uploading profile: {profile_name}")

    media_path = Path("media") / profile_name
    if not media_path.exists():
        print(f"⚠️  Media folder not found: {media_path}")
        return

    uploaded_count = 0
    skipped_count = 0

    for folder in media_path.iterdir():
        if not folder.is_dir() or folder.name.startswith("."):
            continue

        file_name = folder.name
        print(f"  📁 {file_name}/")

        # Upload all files in this folder
        for file_path in folder.iterdir():
            if file_path.is_file():
                # Compute local file hash
                local_etag = compute_etag(file_path)

                # Get R2 object key
                object_key = f"{profile_name}/{file_name}/{file_path.name}"

                # Check if file exists in R2 with same hash
                try:
                    response = r2_storage.s3_client.head_object(
                        Bucket=r2_storage.config.bucket_name, Key=object_key
                    )
                    remote_etag = response["ETag"].strip('"')

                    if local_etag == remote_etag:
                        print(f"    ⏭️  {file_path.name} (unchanged)")
                        skipped_count += 1
                        continue
                except ClientError as e:
                    if e.response["Error"]["Code"] == "404":
                        pass  # File doesn't exist, upload it
                    else:
                        print(f"    ⚠️  Error checking {file_path.name}: {e}")
                        continue

                print(f"    ⬆️  {file_path.name}...", end="", flush=True)
                r2_storage.upload_file(file_path, profile_name, file_name, file_path.name)
                print(" ✅")
                uploaded_count += 1

    print(
        f"✨ Uploaded {uploaded_count} files, skipped {skipped_count} unchanged for {profile_name}"
    )


def main(
    profile: Annotated[
        str | None,
        typer.Argument(help="Profile name to upload. If not provided, uploads all profiles."),
    ] = None,
) -> None:
    """Upload media files from local storage to Cloudflare R2.

    Uploads stem files, waveforms, and metadata from the media/ directory
    to R2 storage. Skips files that already exist with matching ETags.
    """
    config = get_config()
    storage = get_storage(config)

    # Verify we got R2 storage (not local)
    if not isinstance(storage, R2Storage):
        print("❌ R2 storage is not configured")
        print("\nTo upload to R2, you need:")
        print("1. Uncomment the r2 section in config.yaml")
        print("2. Set R2_* environment variables in .env")
        raise typer.Exit(1)

    print(f"🪣 Connected to R2 bucket: {storage.config.bucket_name}")

    # Upload specific profile or all profiles
    if profile:
        profile_obj = config.get_profile(profile)
        if profile_obj is None:
            print(f"❌ Profile '{profile}' not found in config.yaml")
            print(f"Available profiles: {', '.join(config.get_profile_names())}")
            raise typer.Exit(1)

        upload_profile(storage, profile)
    else:
        print(f"📋 Uploading all profiles: {', '.join(config.get_profile_names())}")
        for profile_obj in config.profiles:
            upload_profile(storage, profile_obj.name)

    print("\n✅ Done!")


if __name__ == "__main__":
    typer.run(main)
