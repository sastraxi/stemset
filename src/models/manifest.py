"""Pydantic models for static site manifests."""

from __future__ import annotations

from datetime import datetime
from pathlib import Path

from pydantic import BaseModel


class TrackInfo(BaseModel):
    """Information about a single track in a profile."""

    name: str
    stems: dict[str, str]  # stem_name -> relative path from media root
    metadata_url: str  # relative path to metadata.json
    created_at: datetime


class ProfileTracks(BaseModel):
    """Manifest of all tracks for a profile (tracks.json)."""

    profile_name: str
    tracks: list[TrackInfo]
    last_updated: datetime

    def to_file(self, file_path: Path) -> None:
        """Write manifest to a JSON file."""
        with open(file_path, "w") as f:
            _ = f.write(self.model_dump_json(indent=2))

    @classmethod
    def from_file(cls, file_path: Path) -> ProfileTracks:
        """Load manifest from a JSON file."""
        with open(file_path, "r") as f:
            return cls.model_validate_json(f.read())


class ProfileInfo(BaseModel):
    """Summary information about a profile."""

    name: str
    display_name: str
    track_count: int
    last_updated: datetime
    tracks_url: str  # relative path to tracks.json


class ProfilesManifest(BaseModel):
    """Top-level manifest of all profiles (profiles.json)."""

    profiles: list[ProfileInfo]
    generated_at: datetime

    def to_file(self, file_path: Path) -> None:
        """Write manifest to a JSON file."""
        with open(file_path, "w") as f:
            _ = f.write(self.model_dump_json(indent=2))

    @classmethod
    def from_file(cls, file_path: Path) -> ProfilesManifest:
        """Load manifest from a JSON file."""
        with open(file_path, "r") as f:
            return cls.model_validate_json(f.read())
