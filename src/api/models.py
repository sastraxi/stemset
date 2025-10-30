"""Pydantic models for API responses."""

from __future__ import annotations

from pydantic import BaseModel


class AuthStatusResponse(BaseModel):
    """Auth status response."""

    authenticated: bool
    user: dict[str, str | None] | None = None


class ProfileResponse(BaseModel):
    """Profile information response."""

    name: str
    source_folder: str


class StemResponse(BaseModel):
    """Individual stem information."""

    stem_type: str
    measured_lufs: float
    peak_amplitude: float
    stem_gain_adjustment_db: float
    audio_url: str
    waveform_url: str
    file_size_bytes: int
    duration_seconds: float


class FileWithStems(BaseModel):
    """File with stems information from database."""

    name: str  # output_name
    display_name: str
    stems: list[StemResponse]
    created_at: str


class JobStatusResponse(BaseModel):
    """Job status response."""

    job_id: str
    profile_name: str
    output_name: str
    filename: str
    status: str  # "processing", "complete", or "error"
    stems: list[str] | None = None
    error: str | None = None


class LogoutResponse(BaseModel):
    """Logout response."""

    success: bool
