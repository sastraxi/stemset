#!/usr/bin/env python3
"""Test production API endpoint to see what it returns.

Usage:
    python scripts/test_production_api.py
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

# Add src to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from dotenv import load_dotenv
load_dotenv(".env.production")

from sqlalchemy.orm import selectinload
from sqlmodel import desc, select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.config import get_engine
from src.db.models import Profile as DBProfile, Recording
from src.storage import get_storage


async def test_api_endpoint():
    """Simulate the /api/profiles/{profile_name}/files endpoint."""
    engine = get_engine()
    profile_name = "vocal_then_ft"

    print(f"🧪 Testing API endpoint for profile: {profile_name}\n")

    async with AsyncSession(engine) as session:
        # Get profile
        result = await session.exec(select(DBProfile).where(DBProfile.name == profile_name))
        profile = result.first()
        if not profile:
            print(f"❌ Profile '{profile_name}' not found")
            return

        print(f"✅ Found profile: {profile.name} (ID: {profile.id})\n")

        # Query recordings with stems (same as API)
        stmt = (
            select(Recording)
            .where(Recording.profile_id == profile.id)
            .options(selectinload(Recording.stems))  # pyright: ignore[reportArgumentType]
            .order_by(desc(Recording.created_at))
        )
        result = await session.exec(stmt)
        recordings = result.all()

        print(f"📋 Found {len(recordings)} recording(s)\n")

        # Get storage backend
        storage = get_storage()
        print(f"💾 Storage backend: {type(storage).__name__}\n")

        for recording in recordings:
            print(f"🎵 Recording:")
            print(f"  output_name: {recording.output_name!r}")
            print(f"  display_name: {recording.display_name!r}")
            print(f"  created_at: {recording.created_at}")
            print(f"  stems count: {len(recording.stems)}")

            if recording.stems:
                print(f"  Stems:")
                for stem in recording.stems:
                    audio_url = storage.get_file_url(
                        profile_name, recording.output_name, stem.stem_type, ".opus"
                    )
                    waveform_url = storage.get_waveform_url(
                        profile_name, recording.output_name, stem.stem_type
                    )
                    print(f"    - {stem.stem_type}:")
                    print(f"        DB audio_url: {stem.audio_url!r}")
                    print(f"        Generated audio_url: {audio_url!r}")
                    print(f"        DB waveform_url: {stem.waveform_url!r}")
                    print(f"        Generated waveform_url: {waveform_url!r}")
            print()


if __name__ == "__main__":
    asyncio.run(test_api_endpoint())
