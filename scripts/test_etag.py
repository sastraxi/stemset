#!/usr/bin/env python3
"""Test ETag comparison for deduplication."""

from __future__ import annotations

import sys
import hashlib
from pathlib import Path
from dotenv import load_dotenv

# Load .env file
load_dotenv()

# Add src to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from src.config import get_config
from src.storage import R2Storage


def compute_md5(file_path: Path) -> str:
    """Compute MD5 hash of a file."""
    md5_hash = hashlib.md5()
    with open(file_path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            md5_hash.update(chunk)
    return md5_hash.hexdigest()


def main() -> None:
    """Test ETag comparison."""
    if len(sys.argv) < 3:
        print("Usage: python scripts/test_etag.py <profile> <filename>")
        print("Example: python scripts/test_etag.py one 080225-007.wav")
        return

    profile_name = sys.argv[1]
    filename = sys.argv[2]

    config = get_config()

    if config.r2 is None:
        print("Error: R2 not configured")
        return

    r2 = R2Storage(config.r2)

    # Check R2 ETag
    input_key = f"inputs/{profile_name}/{filename}"
    print(f"Checking R2 key: {input_key}")
    print()

    try:
        head_response = r2.s3_client.head_object(
            Bucket=r2.config.bucket_name,
            Key=input_key,
        )

        r2_etag = head_response.get("ETag", "")
        r2_etag_clean = r2_etag.strip('"')

        print(f"R2 ETag (raw): {repr(r2_etag)}")
        print(f"R2 ETag (clean): {r2_etag_clean}")
        print()

        # Check local file
        local_file = Path(f"input/{profile_name}/{filename}")
        if not local_file.exists():
            print(f"Error: Local file not found: {local_file}")
            return

        local_md5 = compute_md5(local_file)
        print(f"Local MD5: {local_md5}")
        print()

        # Compare
        if r2_etag_clean == local_md5:
            print("✓ ETags match - files are identical!")
        else:
            print("✗ ETags differ - files are different")
            print(f"  Difference: '{r2_etag_clean}' != '{local_md5}'")

            # Check if it's a multipart upload ETag
            if "-" in r2_etag_clean:
                print()
                print("⚠ R2 ETag contains '-' which indicates a multipart upload")
                print("  Multipart ETags are not simple MD5 hashes")
                print("  We need a different deduplication strategy for large files")

    except r2.s3_client.exceptions.NoSuchKey:
        print("File does not exist in R2")


if __name__ == "__main__":
    main()
