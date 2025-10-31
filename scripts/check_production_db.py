#!/usr/bin/env python3
"""Check production database contents for debugging.

Usage:
    python scripts/check_production_db.py
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

# Add src to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from dotenv import load_dotenv
load_dotenv(".env.production")

from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.config import get_engine
from src.db.models import Profile, Recording, Stem


async def check_database():
    """Check database contents."""
    engine = get_engine()

    print("🔍 Checking production database...\n")

    async with AsyncSession(engine) as session:
        # Check profiles
        result = await session.exec(select(Profile))
        profiles = result.all()
        print(f"📋 Profiles: {len(profiles)}")
        for profile in profiles:
            print(f"  - {profile.name} (ID: {profile.id})")
        print()

        # Check recordings
        result = await session.exec(select(Recording))
        recordings = result.all()
        print(f"🎵 Recordings: {len(recordings)}")
        for recording in recordings:
            print(f"  - ID: {recording.id}")
            print(f"    Profile ID: {recording.profile_id}")
            print(f"    Output name: {recording.output_name!r}")
            print(f"    Display name: {recording.display_name!r}")
            print(f"    Created: {recording.created_at}")
            print()

        # Check stems
        result = await session.exec(select(Stem))
        stems = result.all()
        print(f"🎸 Stems: {len(stems)}")
        for stem in stems[:10]:  # Show first 10
            print(f"  - {stem.stem_type} (Recording ID: {stem.recording_id})")
            print(f"    Audio URL: {stem.audio_url!r}")
            print(f"    Waveform URL: {stem.waveform_url!r}")
            print(f"    LUFS: {stem.measured_lufs:.2f}")
            print()

        if len(stems) > 10:
            print(f"  ... and {len(stems) - 10} more stems")


if __name__ == "__main__":
    asyncio.run(check_database())
