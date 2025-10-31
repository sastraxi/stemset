"""Recording configuration endpoints (user-specific settings)."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from litestar import get, patch
from litestar.connection import Request
from litestar.exceptions import NotFoundException
from pydantic import BaseModel
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from ..db.config import get_engine
from ..db.models import RecordingUserConfig as DBRecordingUserConfig
from ..db.models import User


class RecordingConfigResponse(BaseModel):
    """Recording configuration response (all keys for a recording)."""

    playbackPosition: dict[str, Any] | None = None
    stems: dict[str, Any] | None = None
    effects: dict[str, Any] | None = None


class UpdateConfigRequest(BaseModel):
    """Request to update a specific config key."""

    key: str  # 'playbackPosition', 'stems', or 'effects'
    value: dict[str, Any]


async def get_user_id_from_email(session: AsyncSession, email: str) -> UUID:
    """Get user UUID from email, creating user if needed."""
    result = await session.exec(select(User).where(User.email == email))
    user = result.first()

    if not user:
        # This shouldn't happen if auth middleware is working correctly
        raise NotFoundException(detail=f"User not found: {email}")

    return user.id


@get("/api/recordings/{recording_id:uuid}/config")
async def get_recording_config(
    recording_id: UUID, request: Request[Any, Any, Any]
) -> RecordingConfigResponse:
    """Get all configuration for a recording (user-specific).

    Returns separate keys for playbackPosition, stems, and effects.
    """
    # Get user email from auth middleware
    user_email = request.scope.get("state", {}).get("user_email")
    if not user_email:
        raise NotFoundException(detail="User not authenticated")

    engine = get_engine()
    async with AsyncSession(engine) as session:
        user_id = await get_user_id_from_email(session, user_email)

        # Fetch all config records for this user + recording
        stmt = select(DBRecordingUserConfig).where(
            DBRecordingUserConfig.user_id == user_id,
            DBRecordingUserConfig.recording_id == recording_id,
        )
        result = await session.exec(stmt)
        configs = result.all()

        # Build response with separate keys
        response = RecordingConfigResponse()
        for config in configs:
            if config.config_key == "playbackPosition":
                response.playbackPosition = config.config_value
            elif config.config_key == "stems":
                response.stems = config.config_value
            elif config.config_key == "effects":
                response.effects = config.config_value

        return response


@patch("/api/recordings/{recording_id:uuid}/config")
async def update_recording_config(
    recording_id: UUID, request: Request[Any, Any, Any], data: UpdateConfigRequest
) -> RecordingConfigResponse:
    """Update a specific config key for a recording (upsert).

    Supports partial updates - only updates the specified key.
    """
    # Get user email from auth middleware
    user_email = request.scope.get("state", {}).get("user_email")
    if not user_email:
        raise NotFoundException(detail="User not authenticated")

    # Validate key
    if data.key not in ("playbackPosition", "stems", "effects"):
        raise NotFoundException(detail=f"Invalid config key: {data.key}")

    engine = get_engine()
    async with AsyncSession(engine) as session:
        user_id = await get_user_id_from_email(session, user_email)

        # Check if config record exists
        stmt = select(DBRecordingUserConfig).where(
            DBRecordingUserConfig.user_id == user_id,
            DBRecordingUserConfig.recording_id == recording_id,
            DBRecordingUserConfig.config_key == data.key,
        )
        result = await session.exec(stmt)
        config = result.first()

        if config:
            # Update existing
            config.config_value = data.value
        else:
            # Create new
            config = DBRecordingUserConfig(
                user_id=user_id,
                recording_id=recording_id,
                config_key=data.key,
                config_value=data.value,
            )
            session.add(config)

        await session.commit()

        # Fetch all configs to return full state after update
        stmt = select(DBRecordingUserConfig).where(
            DBRecordingUserConfig.user_id == user_id,
            DBRecordingUserConfig.recording_id == recording_id,
        )
        result = await session.exec(stmt)
        configs = result.all()

        # Build response with separate keys
        response = RecordingConfigResponse()
        for config in configs:
            if config.config_key == "playbackPosition":
                response.playbackPosition = config.config_value
            elif config.config_key == "stems":
                response.stems = config.config_value
            elif config.config_key == "effects":
                response.effects = config.config_value

        return response
