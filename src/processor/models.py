"""Data models for processor workflows."""

from __future__ import annotations

from typing import TypedDict

from pydantic import BaseModel


class StemData(TypedDict):
    """Stem metadata returned by processor (used in callbacks)."""

    stem_type: str
    measured_lufs: float
    peak_amplitude: float
    stem_gain_adjustment_db: float
    audio_url: str  # Relative path (e.g., "vocals.opus")
    waveform_url: str  # Relative path (e.g., "vocals_waveform.png")
    file_size_bytes: int
    duration_seconds: float


class StemDataModel(BaseModel):
    """Pydantic model for stem data (used in API responses)."""

    stem_type: str
    measured_lufs: float
    peak_amplitude: float
    stem_gain_adjustment_db: float
    audio_url: str
    waveform_url: str
    file_size_bytes: int
    duration_seconds: float


class ProcessingCallbackPayload(BaseModel):
    """Payload sent to callback endpoint after processing."""

    status: str  # "complete" or "error"
    stems: list[StemDataModel] | None = None  # Only present when status="complete"
    error: str | None = None  # Only present when status="error"
