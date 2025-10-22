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
        stems = {}
        # Try to find stems in both opus and wav formats
        for stem_name in ["vocals", "drums", "bass", "other"]:
            for ext in [".opus", ".wav"]:
                # For local storage, verify file exists before creating URL
                if not config.r2:
                    stem_path = Path("media") / profile_name / file_name / f"{stem_name}{ext}"
                    if not stem_path.exists():
                        continue

                # Generate URL (works for both local and R2)
                stems[stem_name] = storage.get_file_url(profile_name, file_name, stem_name, ext)
                break

        if stems:
            files.append(
                FileWithStems(
                    name=file_name,
                    path=f"media/{profile_name}/{file_name}",
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

    # For R2, redirect to the metadata URL
    if config.r2:
        storage = get_storage(config)
        metadata_url = storage.get_metadata_url(profile_name, file_name)
        return Redirect(path=metadata_url)

    # For local storage, read and return the file
    media_path = profile.get_media_path()
    metadata_file = media_path / file_name / "metadata.json"

    if not metadata_file.exists():
        raise NotFoundException(detail=f"Metadata not found for '{file_name}'")

    return StemsMetadata.from_file(metadata_file)


@get("/api/profiles/{profile_name:str}/songs/{song_name:str}/stems/{stem_name:str}/waveform")
async def get_stem_waveform(profile_name: str, song_name: str, stem_name: str) -> File | Redirect:
    """Serve waveform PNG for a specific stem.

    The waveform is rendered as white on transparent background.
    Frontend should apply color via CSS filters or canvas operations.
    """
    print(f"Fetching waveform for profile='{profile_name}', song='{song_name}', stem='{stem_name}'")
    config = get_config()
    profile = config.get_profile(profile_name)
    if profile is None:
        raise NotFoundException(detail=f"Profile '{profile_name}' not found")

    # For R2, redirect to the waveform URL
    if config.r2:
        storage = get_storage(config)
        waveform_url = storage.get_waveform_url(profile_name, song_name, stem_name)
        return Redirect(path=waveform_url)

    # For local storage, serve the file
    waveform_path = Path("media") / profile_name / song_name / f"{stem_name}_waveform.png"

    if not waveform_path.exists():
        raise NotFoundException(detail=f"Waveform not found for stem '{stem_name}'")

    return File(
        path=waveform_path,
        filename=f"{stem_name}_waveform.png",
        media_type="image/png",
    )


