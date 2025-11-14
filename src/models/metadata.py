"""Utilities for audio metadata analysis and stem metadata creation.

This module provides Pydantic models for stem metadata that are used during
audio separation. All metadata is stored in the database - no JSON files!
"""

from __future__ import annotations

from pydantic import BaseModel


class StemMetadata(BaseModel):
    """Metadata for a single stem."""

    stem_type: str
    measured_lufs: float
    peak_amplitude: float
    stem_gain_adjustment_db: float
    stem_url: str  # Relative path to audio file (e.g., "vocals.opus")
    waveform_url: str  # Relative path to waveform PNG (e.g., "vocals_waveform.png")


class StemsMetadata(BaseModel):
    """Metadata for all stems in a separation.

    This is returned by the separation engine and then stored in the database.
    No JSON files are written - database is the source of truth!
    """

    stems: dict[str, StemMetadata]
    duration: float = 0.0
    display_name: str = ""  # Empty string means use the folder name as default
