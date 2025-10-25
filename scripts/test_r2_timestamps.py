#!/usr/bin/env python3
"""Test script to verify R2 timestamp behavior."""

from __future__ import annotations

import sys
from pathlib import Path
from datetime import datetime
from dotenv import load_dotenv

# Load .env file
load_dotenv()

# Add src to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from src.config import get_config
from src.storage import R2Storage


def main() -> None:
    """Test R2 timestamp retrieval and comparison."""
    config = get_config()

    if config.r2 is None:
        print("Error: R2 not configured")
        return

    r2 = R2Storage(config.r2)

    # List objects in the first profile
    if not config.profiles:
        print("Error: No profiles configured")
        return

    profile = config.profiles[0]
    print(f"Testing R2 timestamps for profile: {profile.name}")
    print()

    # List all folders
    folders = r2.list_files(profile.name)

    if not folders:
        print("No folders found in R2")
        return

    print(f"Found {len(folders)} folder(s)")
    print()

    # Statistics
    total_files = 0
    r2_newer = 0
    local_newer = 0
    same_timestamp = 0
    local_missing = 0

    # Examine all folders
    for folder_name in folders:
        print(f"Examining folder: {folder_name}")

        prefix = f"{profile.name}/{folder_name}/"
        response = r2.s3_client.list_objects_v2(
            Bucket=r2.config.bucket_name,
            Prefix=prefix,
        )

        for obj in response.get("Contents", []):
            key = obj["Key"]
            filename = key[len(prefix):]

            if not filename:
                continue

            total_files += 1
            last_modified = obj["LastModified"]

            # Check if local file exists
            local_file = Path("media") / profile.name / folder_name / filename
            if local_file.exists():
                local_mtime = local_file.stat().st_mtime
                r2_timestamp = last_modified.timestamp()

                # Compare with small tolerance for floating point
                diff = abs(r2_timestamp - local_mtime)

                if diff < 1.0:  # Within 1 second = same
                    same_timestamp += 1
                    print(f"  = {filename} (same timestamp)")
                elif r2_timestamp > local_mtime:
                    r2_newer += 1
                    print(f"  ↓ {filename} (R2 newer by {r2_timestamp - local_mtime:.1f}s)")
                else:
                    local_newer += 1
                    print(f"  ↑ {filename} (local newer by {local_mtime - r2_timestamp:.1f}s)")
            else:
                local_missing += 1
                print(f"  ? {filename} (not in local)")

        print()

    # Summary
    print("=" * 60)
    print(f"Summary for profile '{profile.name}':")
    print(f"  Total files in R2: {total_files}")
    print(f"  R2 is newer: {r2_newer}")
    print(f"  Local is newer: {local_newer}")
    print(f"  Same timestamp: {same_timestamp}")
    print(f"  Missing locally: {local_missing}")
    print()

    if same_timestamp > 0:
        print("✓ Some files have matching timestamps - upload preserves mtime!")
    else:
        print("⚠ No matching timestamps - upload may change mtime")


if __name__ == "__main__":
    main()
