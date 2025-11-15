#!/usr/bin/env python3
"""Delete all files for a profile both locally and from Cloudflare R2.

Usage:
    python delete_profile.py <profile_name>
"""

import os
import sys
import shutil
from pathlib import Path

# Add src to path
sys.path.insert(0, str(Path(__file__).parent))

from dotenv import load_dotenv

_ = load_dotenv()

# Force R2 storage for this script
os.environ["STEMSET_LOCAL_STORAGE"] = "false"

from src.config import get_config
from src.storage import get_storage, R2Storage


def delete_profile_locally(profile_name: str) -> None:
    """Delete all local files for a profile."""
    media_path = Path("media") / profile_name

    if not media_path.exists():
        print(f"  ℹ️  No local files found for profile '{profile_name}'")
        return

    print(f"  📁 Deleting local directory: {media_path}")
    shutil.rmtree(media_path)
    print(f"  ✅ Deleted local files for '{profile_name}'")


def delete_profile_from_r2(r2_storage: R2Storage, profile_name: str) -> None:
    """Delete all files for a profile from R2."""
    print(f"\n🗑️  Deleting profile from R2: {profile_name}")

    # List all objects with the profile prefix
    prefix = f"{profile_name}/"

    try:
        # Get all objects with this prefix
        paginator = r2_storage.s3_client.get_paginator("list_objects_v2")
        pages = paginator.paginate(Bucket=r2_storage.config.bucket_name, Prefix=prefix)

        objects_to_delete = []
        for page in pages:
            if "Contents" in page:
                for obj in page["Contents"]:
                    objects_to_delete.append({"Key": obj["Key"]})

        if not objects_to_delete:
            print(f"  ℹ️  No files found for profile '{profile_name}'")
            return

        print(f"  📋 Found {len(objects_to_delete)} files to delete")

        # Delete objects in batches (max 1000 per batch)
        batch_size = 1000
        deleted_count = 0

        for i in range(0, len(objects_to_delete), batch_size):
            batch = objects_to_delete[i : i + batch_size]

            response = r2_storage.s3_client.delete_objects(
                Bucket=r2_storage.config.bucket_name, Delete={"Objects": batch}
            )

            batch_deleted = len(response.get("Deleted", []))
            deleted_count += batch_deleted

            # Log some of the deleted files
            for deleted in response.get("Deleted", [])[:5]:  # Show first 5
                print(f"    🗑️  {deleted['Key']}")

            if batch_deleted > 5:
                print(f"    ... and {batch_deleted - 5} more files")

            # Report any errors
            for error in response.get("Errors", []):
                print(f"    ❌ Error deleting {error['Key']}: {error['Message']}")

        print(f"  ✅ Deleted {deleted_count} files from R2")

    except Exception as e:
        print(f"  ❌ Error deleting from R2: {e}")


def main() -> None:
    """Main entry point."""
    # Check for profile name argument
    if len(sys.argv) != 2:
        print("Usage: python delete_profile.py <profile_name>")
        print("\nExample: python delete_profile.py vocal_then_ft")
        sys.exit(1)

    profile_name = sys.argv[1]

    config = get_config()

    # Verify profile exists in config
    profile = config.get_profile(profile_name)
    if profile is None:
        print(f"❌ Profile '{profile_name}' not found in config.yaml")
        print(f"Available profiles: {', '.join(config.get_profile_names())}")
        sys.exit(1)

    print(f"🗑️  Deleting profile: {profile_name}")

    # Delete local files first
    print("\n📁 Deleting local files...")
    delete_profile_locally(profile_name)

    # Delete from R2 if configured
    storage = get_storage(config)
    if isinstance(storage, R2Storage):
        print(f"\n🪣 Connected to R2 bucket: {storage.config.bucket_name}")
        delete_profile_from_r2(storage, profile_name)
    else:
        print("\n⚠️  R2 storage not configured - skipping R2 deletion")
        print("To delete from R2, you need:")
        print("1. Uncomment the r2 section in config.yaml")
        print("2. Set R2_* environment variables in .env")

    print("\n✅ Done!")


if __name__ == "__main__":
    main()
