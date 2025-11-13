"""Location management endpoints."""

from __future__ import annotations

from litestar import get, post
from litestar.exceptions import HTTPException, NotFoundException
from litestar.status_codes import HTTP_409_CONFLICT
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from ..db.config import get_engine
from ..db.models import Location
from ..db.models import Profile as DBProfile


class LocationResponse(BaseModel):
    """Location metadata response."""

    id: str
    name: str
    created_at: str


class CreateLocationRequest(BaseModel):
    """Request to create a new location."""

    name: str


@get("/api/profiles/{profile_name:str}/locations")
async def get_profile_locations(profile_name: str) -> list[LocationResponse]:
    """Get all locations for a profile."""
    engine = get_engine()

    async with AsyncSession(engine, expire_on_commit=False) as session:
        # Verify profile exists
        result = await session.exec(select(DBProfile).where(DBProfile.name == profile_name))
        profile = result.first()
        if profile is None:
            raise NotFoundException(detail=f"Profile with name '{profile_name}' not found")
        # Get locations
        stmt = select(Location).where(Location.profile_id == profile.id).order_by(Location.name)
        result = await session.exec(stmt)
        locations = result.all()

        return [
            LocationResponse(
                id=str(location.id),
                name=location.name,
                created_at=location.created_at.isoformat(),
            )
            for location in locations
        ]


@post("/api/profiles/{profile_name:str}/locations")
async def create_location(profile_name: str, data: CreateLocationRequest) -> LocationResponse:
    """Create a new location for a profile."""
    engine = get_engine()

    async with AsyncSession(engine, expire_on_commit=False) as session:
        # Verify profile exists
        result = await session.exec(select(DBProfile).where(DBProfile.name == profile_name))
        profile = result.first()
        if profile is None:
            raise NotFoundException(detail=f"Profile with name '{profile_name}' not found")

        # Create location
        location = Location(profile_id=profile.id, name=data.name)

        session.add(location)
        try:
            await session.commit()
            await session.refresh(location)
        except IntegrityError:
            await session.rollback()
            raise HTTPException(
                status_code=HTTP_409_CONFLICT,
                detail=f"Location with name '{data.name}' already exists for this profile",
            )

        return LocationResponse(
            id=str(location.id),
            name=location.name,
            created_at=location.created_at.isoformat(),
        )
