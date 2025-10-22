#!/usr/bin/env python3
"""Upload media files to Cloudflare R2.

Usage:
    python scripts/upload_to_r2.py [profile_name]

If no profile name is given, uploads all profiles.
"""

from __future__ import annotations

import sys
from pathlib import Path

# Add src to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from dotenv import load_dotenv
load_dotenv()

from src.config import get_config
from src.storage import R2Storage

def upload_profile(r2_storage: R2Storage, profile_name: str) -> None:
    """Upload all files for a profile to R2."""
    print(f"\n📤 Uploading profile: {profile_name}")

    media_path = Path("media") / profile_name
    if not media_path.exists():
        print(f"⚠️  Media folder not found: {media_path}")
        return

    file_count = 0
    for folder in media_path.iterdir():
        if not folder.is_dir() or folder.name.startswith("."):
            continue

        file_name = folder.name
        print(f"  📁 {file_name}/")

        # Upload all files in this folder
        for file_path in folder.iterdir():
            if file_path.is_file():
                print(f"    ⬆️  {file_path.name}...", end="", flush=True)
                r2_storage.upload_file(
                    file_path,
                    profile_name,
                    file_name,
                    file_path.name
                )
                print(" ✅")
                file_count += 1

    print(f"✨ Uploaded {file_count} files for {profile_name}")


def main() -> None:
    """Main entry point."""
    config = get_config()

    if config.r2 is None:
        print("❌ R2 configuration not found in config.yaml")
        print("Please uncomment the r2 section and set environment variables.")
        sys.exit(1)

    r2_storage = R2Storage(config.r2)
    print(f"🪣 Connected to R2 bucket: {config.r2.bucket_name}")

    # Get profile name from command line or upload all
    if len(sys.argv) > 1:
        profile_name = sys.argv[1]
        profile = config.get_profile(profile_name)
        if profile is None:
            print(f"❌ Profile '{profile_name}' not found in config.yaml")
            print(f"Available profiles: {', '.join(config.get_profile_names())}")
            sys.exit(1)

        upload_profile(r2_storage, profile_name)
    else:
        print(f"📋 Uploading all profiles: {', '.join(config.get_profile_names())}")
        for profile in config.profiles:
            upload_profile(r2_storage, profile.name)

    print("\n✅ Done!")


if __name__ == "__main__":
    main()
