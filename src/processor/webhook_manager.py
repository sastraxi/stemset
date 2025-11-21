"""Modal scheduled function for managing Google Drive webhook subscriptions.

This function runs periodically to:
1. Create subscriptions for profiles with Drive folders but no active subscription
2. Renew subscriptions that are expiring soon (within 12 hours)

Keeps webhook infrastructure managed as code - no manual subscription management needed.
"""

from __future__ import annotations

import os
from datetime import datetime, timezone

import modal

# Modal app configuration
app = modal.App("stemset-webhook-manager")

# Python environment with required dependencies
python_image = (
    modal.Image.debian_slim(python_version="3.13")
    .pip_install(
        "sqlmodel",
        "asyncpg",  # PostgreSQL async driver
        "aiogoogle",  # Google Drive API client
        "pydantic",
        "pyyaml",
    )
)


@app.function(
    image=python_image,
    schedule=modal.Cron("0 */12 * * *"),  # Run every 12 hours
    secrets=[
        modal.Secret.from_name("stemset-secrets"),  # DATABASE_URL, WEBHOOK_BASE_URL
    ],
    timeout=600,  # 10 minute timeout
)
async def renew_drive_webhooks():
    """Scheduled function to create and renew Google Drive webhook subscriptions.

    Runs every 12 hours to ensure subscriptions don't expire (24h max TTL).

    Environment variables required (from Modal secrets):
    - DATABASE_URL: PostgreSQL connection string
    - BACKEND_URL: Public backend URL (e.g., https://your-api.koyeb.app)

    Note: This function accesses the database directly rather than going through
    the API to avoid chicken-and-egg deployment issues and reduce API surface.
    """
    from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine
    from sqlmodel import select
    from sqlmodel.ext.asyncio.session import AsyncSession

    # Import after Modal context is established
    import sys
    from pathlib import Path

    # Add src to path for imports
    src_path = Path(__file__).parent.parent
    sys.path.insert(0, str(src_path))

    from db.models import DriveWebhookSubscription, Profile, User
    from google_drive_webhooks import (
        create_webhook_subscription,
        list_expiring_subscriptions,
        list_profiles_needing_subscriptions,
    )

    # Get environment variables
    database_url = os.getenv("DATABASE_URL")
    backend_url = os.getenv("BACKEND_URL")

    if not database_url:
        raise ValueError("DATABASE_URL environment variable not set")

    if not backend_url:
        raise ValueError("BACKEND_URL environment variable not set")

    # Create webhook URL
    webhook_url = f"{backend_url}/api/webhooks/drive"

    print(f"Starting webhook subscription renewal at {datetime.now(timezone.utc)}")
    print(f"Webhook URL: {webhook_url}")

    # Create async database engine
    engine: AsyncEngine = create_async_engine(
        database_url,
        echo=False,
        future=True,
    )

    try:
        async with AsyncSession(engine, expire_on_commit=False) as session:
            # Part 1: Renew expiring subscriptions
            print("Checking for expiring subscriptions...")
            expiring_subs = list_expiring_subscriptions(session, hours_threshold=12)

            print(f"Found {len(expiring_subs)} subscriptions expiring within 12 hours")

            for sub in expiring_subs:
                try:
                    # Get profile for this subscription
                    profile_stmt = select(Profile).where(Profile.id == sub.profile_id)
                    profile_result = await session.exec(profile_stmt)
                    profile = profile_result.first()

                    if not profile:
                        print(f"Warning: Profile not found for subscription {sub.id}")
                        continue

                    # Get user with refresh token for this profile
                    user_stmt = (
                        select(User)
                        .join(User.profiles)  # pyright: ignore[reportArgumentType]
                        .where(Profile.id == profile.id)  # pyright: ignore[reportAttributeAccessIssue]
                    )
                    user_result = await session.exec(user_stmt)
                    user = user_result.first()

                    if not user or not user.google_refresh_token:
                        print(f"Warning: No user with refresh token for profile {profile.name}")
                        continue

                    # Create minimal config object for Drive client
                    from pydantic import BaseModel

                    class MinimalAuthConfig(BaseModel):
                        google_client_id: str
                        google_client_secret: str

                    class MinimalConfig(BaseModel):
                        auth: MinimalAuthConfig | None

                    google_client_id = os.getenv("GOOGLE_CLIENT_ID")
                    google_client_secret = os.getenv("GOOGLE_CLIENT_SECRET")

                    if not google_client_id or not google_client_secret:
                        print("Warning: Google OAuth credentials not set")
                        continue

                    config = MinimalConfig(
                        auth=MinimalAuthConfig(
                            google_client_id=google_client_id,
                            google_client_secret=google_client_secret,
                        )
                    )

                    # Renew subscription by creating a new one
                    print(f"Renewing subscription for profile {profile.name}...")
                    new_sub = await create_webhook_subscription(
                        profile=profile,
                        user_refresh_token=user.google_refresh_token,
                        webhook_url=webhook_url,
                        config=config,  # type: ignore
                        session=session,
                    )
                    print(
                        f"✓ Renewed subscription for {profile.name} "
                        f"(expires {new_sub.expiration_time})"
                    )

                except Exception as e:
                    print(f"Error renewing subscription for {sub.id}: {e}")
                    continue

            # Part 2: Create subscriptions for profiles that don't have them
            print("\nChecking for profiles needing initial subscriptions...")
            profiles_needing_setup = list_profiles_needing_subscriptions(session)

            print(f"Found {len(profiles_needing_setup)} profiles needing subscriptions")

            for profile in profiles_needing_setup:
                try:
                    # Get user with refresh token
                    user_stmt = (
                        select(User)
                        .join(User.profiles)  # pyright: ignore[reportArgumentType]
                        .where(Profile.id == profile.id)  # pyright: ignore[reportAttributeAccessIssue]
                    )
                    user_result = await session.exec(user_stmt)
                    user = user_result.first()

                    if not user or not user.google_refresh_token:
                        print(f"Warning: No user with refresh token for profile {profile.name}")
                        continue

                    # Use same minimal config
                    google_client_id = os.getenv("GOOGLE_CLIENT_ID")
                    google_client_secret = os.getenv("GOOGLE_CLIENT_SECRET")

                    if not google_client_id or not google_client_secret:
                        print("Warning: Google OAuth credentials not set")
                        continue

                    config = MinimalConfig(
                        auth=MinimalAuthConfig(
                            google_client_id=google_client_id,
                            google_client_secret=google_client_secret,
                        )
                    )

                    # Create initial subscription
                    print(f"Creating subscription for profile {profile.name}...")
                    new_sub = await create_webhook_subscription(
                        profile=profile,
                        user_refresh_token=user.google_refresh_token,
                        webhook_url=webhook_url,
                        config=config,  # type: ignore
                        session=session,
                    )
                    print(
                        f"✓ Created subscription for {profile.name} "
                        f"(expires {new_sub.expiration_time})"
                    )

                except Exception as e:
                    print(f"Error creating subscription for {profile.name}: {e}")
                    continue

            print(f"\nWebhook renewal complete at {datetime.now(timezone.utc)}")

    finally:
        await engine.dispose()
