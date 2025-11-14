#!/usr/bin/env python3
"""List files in R2 to see the actual structure.

Usage:
    python scripts/list_r2_files.py [profile_name]
"""

from __future__ import annotations

import sys
from pathlib import Path

import boto3

from src.config import get_config

# Add src to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from dotenv import load_dotenv

load_dotenv()


def list_r2_files(profile_name: str | None = None):
    """List files in R2 bucket."""
    config = get_config()

    if not config.r2:
        print("❌ R2 not configured")
        return

    print(f"🔍 Connecting to R2 bucket: {config.r2.bucket_name}\n")

    s3_client = boto3.client(  # pyright: ignore[reportUnknownMemberType]
        "s3",
        endpoint_url=f"https://{config.r2.account_id}.r2.cloudflarestorage.com",
        aws_access_key_id=config.r2.access_key_id,
        aws_secret_access_key=config.r2.secret_access_key,
        region_name="auto",
    )

    # List objects
    prefix = f"{profile_name}/" if profile_name else ""
    print(f"📂 Listing files with prefix: {prefix!r}\n")

    paginator = s3_client.get_paginator("list_objects_v2")
    pages = paginator.paginate(Bucket=config.r2.bucket_name, Prefix=prefix)

    file_count = 0
    for page in pages:
        for obj in page.get("Contents", []):
            print(f"  {obj['Key']} ({obj['Size']} bytes)")  # pyright: ignore[reportTypedDictNotRequiredAccess]
            file_count += 1

            if file_count >= 50:
                print("\n... (showing first 50 files)")
                return

    print(f"\n✅ Total files found: {file_count}")


if __name__ == "__main__":
    profile = sys.argv[1] if len(sys.argv) > 1 else None
    list_r2_files(profile)
