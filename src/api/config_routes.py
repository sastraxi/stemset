"""Recording configuration endpoints (user-specific settings)."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from litestar import patch
from litestar.exceptions import NotFoundException, ValidationException
from litestar.response import Response
from litestar.status_codes import HTTP_204_NO_CONTENT
from pydantic import BaseModel
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.api.types import AppRequest

from ..db.config import get_engine
from ..db.models import RecordingUserConfig as DBRecordingUserConfig
from ..db.models import User


class UpdateConfigRequest(BaseModel):
    """Request to update a specific config key."""

    key: str  # 'playbackPosition', 'stems', 'eq', 'compressor', 'reverb', 'stereoExpander'
    value: dict[str, Any]  # pyright: ignore[reportExplicitAny]


async def get_user_id_from_email(session: AsyncSession, email: str) -> UUID:
    """Get user UUID from email, creating user if needed."""
    result = await session.exec(select(User).where(User.email == email))
    user = result.first()

    if not user:
        # This shouldn't happen if auth middleware is working correctly
        raise NotFoundException(detail=f"User not found: {email}")

    return user.id


@patch("/api/recordings/{recording_id:uuid}/config")
async def update_recording_config(
    recording_id: UUID, request: AppRequest, data: UpdateConfigRequest
) -> Response[None]:
    """Update a specific config key for a recording (upsert).

    Supports partial updates - only updates the specified key.
    Returns 204 No Content on success.
    """
    # Get user from auth middleware (properly typed!)
    user = request.user

    # Validate key (allow individual effect configs plus legacy merged configs)
    valid_keys = (
        "playbackPosition",
        "stems",
        "effects",
        "eq",
        "compressor",
        "reverb",
        "stereoExpander",
    )
    if data.key not in valid_keys:
        raise ValidationException(
            detail=f"Invalid config key: {data.key}. Must be one of: {', '.join(valid_keys)}"
        )

    engine = get_engine()
    async with AsyncSession(engine, expire_on_commit=False) as session:
        user_id = await get_user_id_from_email(session, user.email)

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

        # Return 204 No Content - frontend will update cache manually
        return Response(content=None, status_code=HTTP_204_NO_CONTENT)
