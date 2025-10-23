"""Profile and file management endpoints."""

from __future__ import annotations

from pathlib import Path

from litestar import get
from litestar.exceptions import NotFoundException
from litestar.response import File, Redirect

from ..config import get_config
from ..storage import get_storage
from ..models.metadata import StemsMetadata
from .models import FileWithStems, ProfileResponse


@get("/api/profiles")
async def get_profiles() -> list[ProfileResponse]:
    """Get all configured profiles."""
    config = get_config()
    return [
        ProfileResponse(name=p.name, source_folder=p.source_folder)
        for p in config.profiles
    ]


@get("/api/profiles/{profile_name:str}")
async def get_profile(profile_name: str) -> ProfileResponse:
    """Get a specific profile by name."""
    config = get_config()
    profile = config.get_profile(profile_name)
    if profile is None:
        raise NotFoundException(detail=f"Profile '{profile_name}' not found")

    return ProfileResponse(name=profile.name, source_folder=profile.source_folder)


@get("/api/profiles/{profile_name:str}/files")
async def get_profile_files(profile_name: str) -> list[FileWithStems]:
    """Get all processed files for a profile."""
    config = get_config()
    profile = config.get_profile(profile_name)
    if profile is None:
        raise NotFoundException(detail=f"Profile '{profile_name}' not found")

    storage = get_storage(config)
    file_names = storage.list_files(profile_name)

    files = []
    for file_name in file_names:
        metadata_url = storage.get_metadata_url(profile_name, file_name)
        files.append(FileWithStems(name=file_name, metadata_url=metadata_url))

    return files

