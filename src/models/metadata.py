"""Utilities for audio metadata analysis and stem metadata creation.

This module is split into two parts:
1. Pydantic models (StemMetadata, StemsMetadata) - lightweight, no processing deps
2. Processing utilities (imported lazily) - require numpy, pyloudnorm, etc.
"""

from __future__ import annotations

from pathlib import Path
from pydantic import BaseModel

from ..config import Profile


class StemMetadata(BaseModel):
    """Metadata for a single stem."""

    stem_type: str
    measured_lufs: float
    peak_amplitude: float
    stem_gain_adjustment_db: float
    stem_url: str  # Relative path to audio file (e.g., "vocals.opus")
    waveform_url: str  # Relative path to waveform PNG (e.g., "vocals_waveform.png")


class StemsMetadata(BaseModel):
    """Metadata for all stems in a separation."""

    stems: dict[str, StemMetadata]
    display_name: str = ""  # Empty string means use the folder name as default

    def to_file(self, file_path: Path) -> None:
        """Write metadata to a JSON file."""
        with open(file_path, "w") as f:
            f.write(self.model_dump_json(indent=2))

    @classmethod
    def from_file(cls, file_path: Path) -> "StemsMetadata":
        """Load metadata from a JSON file."""
        with open(file_path, "r") as f:
            return cls.model_validate_json(f.read())
