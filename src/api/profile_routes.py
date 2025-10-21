"""Profile and file management endpoints."""

from __future__ import annotations

from pathlib import Path

from litestar import get
from litestar.exceptions import NotFoundException
from litestar.response import File

from ..config import get_config
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

    media_path = profile.get_media_path()
    if not media_path.exists():
        return []

    files = []
    for folder in media_path.iterdir():
        if folder.is_dir() and not folder.name.startswith("."):
            stems = {}
            for stem_name in ["vocals", "drums", "bass", "other"]:
                for ext in [".opus", ".wav"]:
                    stem_path = folder / f"{stem_name}{ext}"
                    if stem_path.exists():
                        stems[stem_name] = f"/media/{profile_name}/{folder.name}/{stem_name}{ext}"
                        break

            if stems:
                files.append(
                    FileWithStems(
                        name=folder.name,
                        path=str(folder),
                        stems=stems,
                    )
                )

    return files


@get("/api/profiles/{profile_name:str}/files/{file_name:str}/metadata")
async def get_file_metadata(profile_name: str, file_name: str) -> StemsMetadata:
    """Get metadata for a specific processed file."""
    config = get_config()
    profile = config.get_profile(profile_name)
    if profile is None:
        raise NotFoundException(detail=f"Profile '{profile_name}' not found")

    media_path = profile.get_media_path()
    metadata_file = media_path / file_name / "metadata.json"

    if not metadata_file.exists():
        raise NotFoundException(detail=f"Metadata not found for '{file_name}'")

    return StemsMetadata.from_file(metadata_file)


@get("/api/profiles/{profile_name:str}/songs/{song_name:str}/stems/{stem_name:str}/waveform")
async def get_stem_waveform(profile_name: str, song_name: str, stem_name: str) -> File:
    """Serve waveform PNG for a specific stem.

    The waveform is rendered as white on transparent background.
    Frontend should apply color via CSS filters or canvas operations.
    """
    print(f"Fetching waveform for profile='{profile_name}', song='{song_name}', stem='{stem_name}'")
    config = get_config()
    profile = config.get_profile(profile_name)
    if profile is None:
        raise NotFoundException(detail=f"Profile '{profile_name}' not found")

    waveform_path = Path("media") / profile_name / song_name / f"{stem_name}_waveform.png"

    if not waveform_path.exists():
        raise NotFoundException(detail=f"Waveform not found for stem '{stem_name}'")

    return File(
        path=waveform_path,
        filename=f"{stem_name}_waveform.png",
        media_type="image/png",
    )


