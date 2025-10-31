"""Pydantic models for API responses."""

from __future__ import annotations

from pydantic import BaseModel


class AuthStatusResponse(BaseModel):
    """Auth status response."""

    authenticated: bool
    user: dict[str, str | None] | None = None


class LoginCallbackResponse(BaseModel):
    """OAuth callback response with JWT token."""

    token: str
    user: dict[str, str | None]


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

    id: str  # recording UUID
    name: str  # output_name
    display_name: str
    stems: list[StemResponse]
    created_at: str
    status: str | None = None  # "processing" if job exists and incomplete, None if complete


class LogoutResponse(BaseModel):
    """Logout response."""

    success: bool
