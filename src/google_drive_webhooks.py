"""Google Drive webhook subscription manager for auto-import monitoring.

This module handles creating, renewing, and managing Google Drive push notification
channels for profile folders. Google Drive webhooks have a max TTL of 24 hours and
require periodic renewal.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import uuid4

from aiogoogle.auth.creds import ClientCreds, UserCreds
from aiogoogle.client import Aiogoogle
from pydantic import BaseModel
from sqlmodel import Session, select

from .config import Config
from .db.models import DriveWebhookSubscription, Profile, User


class WebhookSubscriptionResponse(BaseModel):
    """Response from Drive API watch request."""

    kind: str  # "api#channel"
    id: str  # Our channel_id
    resourceId: str  # Opaque resource ID from Google
    resourceUri: str  # Push notification endpoint
    expiration: str  # Unix timestamp in milliseconds


async def create_webhook_subscription(
    profile: Profile,
    user_refresh_token: str,
    webhook_url: str,
    config: Config,
    session: Session,
) -> DriveWebhookSubscription:
    """Create a Google Drive push notification channel for a profile folder.

    Args:
        profile: Profile with google_drive_folder_id set
        user_refresh_token: User's Google OAuth refresh token
        webhook_url: Public URL to receive webhook notifications
        config: Application config with OAuth credentials
        session: Database session

    Returns:
        Created subscription record

    Raises:
        ValueError: If profile has no drive_folder_id or auth config missing
        Exception: If Drive API request fails
    """
    if not profile.google_drive_folder_id:
        raise ValueError(f"Profile {profile.name} has no google_drive_folder_id")

    if config.auth is None:
        raise ValueError("Auth configuration required for Drive webhooks")

    # Check for existing active subscription
    existing = session.exec(
        select(DriveWebhookSubscription)
        .where(DriveWebhookSubscription.profile_id == profile.id)
        .where(DriveWebhookSubscription.is_active == True)  # noqa: E712
    ).first()

    if existing and existing.expiration_time > datetime.now(timezone.utc):
        # Already have active subscription
        return existing

    # Initialize aiogoogle client
    client_creds = ClientCreds(
        client_id=config.auth.google_client_id,
        client_secret=config.auth.google_client_secret,
    )
    user_creds = UserCreds(refresh_token=user_refresh_token)
    aiogoogle = Aiogoogle(client_creds=client_creds)

    # Generate unique channel ID
    channel_id = str(uuid4())

    # Create push notification channel via Drive API
    drive_v3 = await aiogoogle.discover("drive", "v3")

    # Request channel with 23-hour TTL (max is 24 hours, use 23 for safety margin)
    expiration_ms = int((datetime.now(timezone.utc) + timedelta(hours=23)).timestamp() * 1000)

    request_body = {
        "id": channel_id,
        "type": "web_hook",
        "address": webhook_url,
        "expiration": expiration_ms,
    }

    req = drive_v3.files.watch(
        fileId=profile.google_drive_folder_id,
        body=request_body,
    )

    response_data = await aiogoogle.as_user(req, user_creds=user_creds)
    response = WebhookSubscriptionResponse(**response_data)

    # Calculate expiration datetime from milliseconds
    expiration_time = datetime.fromtimestamp(int(response.expiration) / 1000, tz=timezone.utc)

    # Mark existing subscription as inactive if present
    if existing:
        existing.is_active = False
        session.add(existing)

    # Create new subscription record
    subscription = DriveWebhookSubscription(
        profile_id=profile.id,
        channel_id=response.id,
        resource_id=response.resourceId,
        drive_folder_id=profile.google_drive_folder_id,
        expiration_time=expiration_time,
        is_active=True,
    )
    session.add(subscription)
    session.commit()
    session.refresh(subscription)

    return subscription


async def stop_webhook_subscription(
    subscription: DriveWebhookSubscription,
    user_refresh_token: str,
    config: Config,
    session: Session,
) -> None:
    """Stop a Google Drive push notification channel.

    Args:
        subscription: Subscription to stop
        user_refresh_token: User's Google OAuth refresh token
        config: Application config with OAuth credentials
        session: Database session

    Raises:
        ValueError: If auth config missing
        Exception: If Drive API request fails
    """
    if config.auth is None:
        raise ValueError("Auth configuration required for Drive webhooks")

    # Initialize aiogoogle client
    client_creds = ClientCreds(
        client_id=config.auth.google_client_id,
        client_secret=config.auth.google_client_secret,
    )
    user_creds = UserCreds(refresh_token=user_refresh_token)
    aiogoogle = Aiogoogle(client_creds=client_creds)

    # Stop channel via Drive API
    drive_v3 = await aiogoogle.discover("drive", "v3")

    request_body = {
        "id": subscription.channel_id,
        "resourceId": subscription.resource_id,
    }

    req = drive_v3.channels.stop(body=request_body)
    await aiogoogle.as_user(req, user_creds=user_creds)

    # Mark subscription as inactive
    subscription.is_active = False
    session.add(subscription)
    session.commit()


def list_expiring_subscriptions(session: Session, hours_threshold: int = 12) -> list[DriveWebhookSubscription]:
    """List active subscriptions expiring within threshold hours.

    Args:
        session: Database session
        hours_threshold: Consider subscriptions expiring within this many hours

    Returns:
        List of expiring subscriptions needing renewal
    """
    threshold_time = datetime.now(timezone.utc) + timedelta(hours=hours_threshold)

    subscriptions = session.exec(
        select(DriveWebhookSubscription)
        .where(DriveWebhookSubscription.is_active == True)  # noqa: E712
        .where(DriveWebhookSubscription.expiration_time <= threshold_time)
    ).all()

    return list(subscriptions)


def list_profiles_needing_subscriptions(session: Session) -> list[Profile]:
    """List profiles with drive folders but no active subscriptions.

    Args:
        session: Database session

    Returns:
        List of profiles needing initial webhook setup
    """
    # Get all profiles with drive folders
    profiles_with_folders = session.exec(
        select(Profile).where(Profile.google_drive_folder_id.is_not(None))  # type: ignore
    ).all()

    # Filter to those without active subscriptions
    profiles_needing_setup = []
    for profile in profiles_with_folders:
        has_active = session.exec(
            select(DriveWebhookSubscription)
            .where(DriveWebhookSubscription.profile_id == profile.id)
            .where(DriveWebhookSubscription.is_active == True)  # noqa: E712
            .where(DriveWebhookSubscription.expiration_time > datetime.now(timezone.utc))
        ).first()

        if not has_active:
            profiles_needing_setup.append(profile)

    return profiles_needing_setup
