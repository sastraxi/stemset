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


class RecordingConfigData(BaseModel):
    """User-specific recording configuration (nested in FileWithStems)."""

    playbackPosition: dict[str, float] | None = None
    stems: dict[str, bool] | None = None
    effects: dict[str, float] | None = None
    eq: dict[str, float] | None = None
    compressor: dict[str, float] | None = None
    reverb: dict[str, float] | None = None
    stereoExpander: dict[str, float] | None = None


class FileWithStems(BaseModel):
    """File with stems information from database."""

    id: str  # recording UUID
    name: str  # output_name
    display_name: str
    stems: list[StemResponse]
    created_at: str
    status: str | None = None  # "processing" if job exists and incomplete, None if complete
    config: RecordingConfigData | None = (
        None  # User-specific config (only populated when fetching single recording)
    )


class LogoutResponse(BaseModel):
    """Logout response."""

    success: bool
