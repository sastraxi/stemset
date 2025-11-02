"""Song management endpoints."""

from __future__ import annotations

from uuid import UUID

from litestar import get, post
from litestar.exceptions import HTTPException, NotFoundException
from litestar.status_codes import HTTP_409_CONFLICT
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from ..db.config import get_engine
from ..db.models import Profile as DBProfile
from ..db.models import Song


class SongResponse(BaseModel):
    """Song metadata response."""

    id: str
    name: str
    created_at: str


class CreateSongRequest(BaseModel):
    """Request to create a new song."""

    name: str


@get("/api/profiles/{profile_id:uuid}/songs")
async def get_profile_songs(profile_id: UUID) -> list[SongResponse]:
    """Get all songs for a profile."""
    engine = get_engine()

    async with AsyncSession(engine, expire_on_commit=False) as session:
        # Verify profile exists
        result = await session.exec(select(DBProfile).where(DBProfile.id == profile_id))
        profile = result.first()
        if profile is None:
            raise NotFoundException(detail=f"Profile with ID '{profile_id}' not found")

        # Get songs
        stmt = select(Song).where(Song.profile_id == profile_id).order_by(Song.name)
        result = await session.exec(stmt)
        songs = result.all()

        return [
            SongResponse(id=str(song.id), name=song.name, created_at=song.created_at.isoformat())
            for song in songs
        ]


@post("/api/profiles/{profile_id:uuid}/songs")
async def create_song(profile_id: UUID, data: CreateSongRequest) -> SongResponse:
    """Create a new song for a profile."""
    engine = get_engine()

    async with AsyncSession(engine, expire_on_commit=False) as session:
        # Verify profile exists
        result = await session.exec(select(DBProfile).where(DBProfile.id == profile_id))
        profile = result.first()
        if profile is None:
            raise NotFoundException(detail=f"Profile with ID '{profile_id}' not found")

        # Create song
        song = Song(profile_id=profile_id, name=data.name)

        session.add(song)
        try:
            await session.commit()
            await session.refresh(song)
        except IntegrityError:
            await session.rollback()
            raise HTTPException(
                status_code=HTTP_409_CONFLICT,
                detail=f"Song with name '{data.name}' already exists for this profile",
            )

        return SongResponse(id=str(song.id), name=song.name, created_at=song.created_at.isoformat())
