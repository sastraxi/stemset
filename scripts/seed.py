#!/usr/bin/env python3
"""Seed the database with initial data.

Usage:
    python scripts/seed.py                  # Uses .env (default)
    python scripts/seed.py .env.production  # Uses specific env file
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

# Add src to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from dotenv import load_dotenv

# Use provided env file or default to .env
env_file = sys.argv[1] if len(sys.argv) > 1 else ".env"
env_path = Path(env_file)

if not env_path.exists():
    print(f"Error: {env_file} file not found")
    sys.exit(1)

print(f"Loading environment from {env_file}...")
load_dotenv(env_path)

from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.config import get_engine
from src.db.models import Profile


async def seed_database():
    """Seed database with initial profiles."""
    engine = get_engine()

    print("🌱 Seeding database...\n")

    async with AsyncSession(engine) as session:
        # Check if "Parallel Creak" profile already exists
        result = await session.exec(select(Profile).where(Profile.name == "Parallel Creak"))
        existing_profile = result.first()

        if existing_profile:
            print("⚠️  Profile 'Parallel Creak' already exists:")
            print(f"   ID: {existing_profile.id}")
            print(f"   Source folder: {existing_profile.source_folder}")
            print(f"   Strategy: {existing_profile.strategy_name}")
            return

        # Create "Parallel Creak" profile
        profile = Profile(
            name="Parallel Creak",
            source_folder="/Users/cam/Music/Parallel Creak",
            strategy_name="vocal_then_ft",
        )

        session.add(profile)
        await session.commit()
        await session.refresh(profile)

        print("✅ Created profile 'Parallel Creak':")
        print(f"   ID: {profile.id}")
        print(f"   Source folder: {profile.source_folder}")
        print(f"   Strategy: {profile.strategy_name}")
        print(f"   Created at: {profile.created_at}")
        print()
        print("🎉 Database seeding complete!")


if __name__ == "__main__":
    asyncio.run(seed_database())
