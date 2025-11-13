"""Song management endpoints."""

from __future__ import annotations

from litestar import get, post
from litestar.exceptions import HTTPException, NotFoundException
from litestar.status_codes import HTTP_409_CONFLICT
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from ..db.config import get_engine
from ..db.models import Clip, Song
from ..db.models import Profile as DBProfile


class SongResponse(BaseModel):
    """Song metadata response."""

    id: str
    name: str
    created_at: str


class CreateSongRequest(BaseModel):
    """Request to create a new song."""

    name: str


class SongWithClipCount(BaseModel):
    """Song with clip count."""

    id: str
    name: str
    created_at: str
    clip_count: int


@get("/api/profiles/{profile_name:str}/songs")
async def get_profile_songs_by_name(profile_name: str) -> list[SongWithClipCount]:
    """Get all songs in a profile with clip counts."""
    engine = get_engine()

    async with AsyncSession(engine, expire_on_commit=False) as session:
        # Get profile
        stmt = select(DBProfile).where(DBProfile.name == profile_name)
        result = await session.exec(stmt)
        profile = result.first()

        if profile is None:
            raise NotFoundException(f"Profile '{profile_name}' not found")

        # Get all songs with clip counts in this profile
        from sqlalchemy import func

        stmt = (
            select(Song, func.count(Clip.id).label("clip_count"))  # pyright: ignore[reportArgumentType]
            .outerjoin(Clip)
            .where(Song.profile_id == profile.id)
            .group_by(Song.id)  # pyright: ignore[reportArgumentType]
            .order_by(Song.name)
        )
        result = await session.exec(stmt)
        rows = result.all()

        return [
            SongWithClipCount(
                id=str(song.id),
                name=song.name,
                created_at=song.created_at.isoformat(),
                clip_count=clip_count,
            )
            for song, clip_count in rows
        ]


@post("/api/profiles/{profile_name:str}/songs")
async def create_song(profile_name: str, data: CreateSongRequest) -> SongResponse:
    """Create a new song for a profile."""
    engine = get_engine()

    async with AsyncSession(engine, expire_on_commit=False) as session:
        # Verify profile exists
        result = await session.exec(select(DBProfile).where(DBProfile.name == profile_name))
        profile = result.first()
        if profile is None:
            raise NotFoundException(detail=f"Profile '{profile_name}' not found")

        # Create song
        song = Song(profile_id=profile.id, name=data.name)

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
