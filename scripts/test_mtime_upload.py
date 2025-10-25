#!/usr/bin/env python3
"""Test that uploading to R2 preserves local mtime in metadata."""

from __future__ import annotations

import sys
from pathlib import Path
from dotenv import load_dotenv

# Load .env file
load_dotenv()

# Add src to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from src.config import get_config
from src.storage import R2Storage


def main() -> None:
    """Test uploading a file and checking if mtime is preserved."""
    config = get_config()

    if config.r2 is None:
        print("Error: R2 not configured")
        return

    r2 = R2Storage(config.r2)

    # Find a small existing file (metadata.json is small)
    media_path = Path("media")
    test_file = None

    for profile_dir in media_path.iterdir():
        if profile_dir.is_dir():
            for song_dir in profile_dir.iterdir():
                if song_dir.is_dir():
                    metadata_file = song_dir / "metadata.json"
                    if metadata_file.exists():
                        test_file = metadata_file
                        profile_name = profile_dir.name
                        song_name = song_dir.name
                        break
            if test_file:
                break

    if not test_file:
        print("Error: No metadata.json file found in media/")
        return

    print(f"Testing with file: {test_file}")
    print(f"Profile: {profile_name}")
    print(f"Song: {song_name}")
    print()

    # Get original local mtime
    local_mtime = test_file.stat().st_mtime
    print(f"Original local mtime: {local_mtime}")
    print()

    # Upload to R2 with test prefix
    test_key = f"_test/{profile_name}/{song_name}/metadata.json"
    print(f"Uploading to R2 key: {test_key}")

    # Use the new upload_file method which should preserve mtime
    r2.upload_file(test_file, f"_test/{profile_name}", song_name, "metadata.json")
    print("✓ Upload complete")
    print()

    # Now fetch the object metadata
    print("Fetching object metadata from R2...")
    head_response = r2.s3_client.head_object(
        Bucket=r2.config.bucket_name,
        Key=test_key,
    )

    # Check metadata
    metadata = head_response.get("Metadata", {})
    print(f"R2 Metadata: {metadata}")
    print()

    original_mtime_str = metadata.get("original-mtime")
    if original_mtime_str:
        r2_stored_mtime = float(original_mtime_str)
        print(f"✓ Found original-mtime in metadata: {r2_stored_mtime}")
        print(f"  Local mtime:  {local_mtime}")
        print(f"  Stored mtime: {r2_stored_mtime}")
        print(f"  Difference: {abs(local_mtime - r2_stored_mtime):.6f} seconds")

        if abs(local_mtime - r2_stored_mtime) < 0.001:
            print()
            print("✓✓✓ SUCCESS! Mtime preserved perfectly!")
        else:
            print()
            print("⚠ Mtime values differ slightly (but this might be expected)")
    else:
        print("✗ ERROR: No original-mtime in metadata!")

    # Also check LastModified for comparison
    last_modified = head_response.get("LastModified")
    if last_modified:
        upload_time = last_modified.timestamp()
        print()
        print(f"R2 LastModified (upload time): {upload_time}")
        print(f"  Difference from local: {abs(local_mtime - upload_time):.1f} seconds")

    # Clean up test file
    print()
    print("Cleaning up test file from R2...")
    r2.s3_client.delete_object(
        Bucket=r2.config.bucket_name,
        Key=test_key,
    )
    print("✓ Cleanup complete")


if __name__ == "__main__":
    main()
