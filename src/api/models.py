"""Pydantic models for API responses."""

from __future__ import annotations

from typing import Any

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

    id: str
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
    """User-specific recording configuration (nested in FileWithStems).

    Config values are stored flexibly - can be primitives or complex nested structures.
    """

    model_config = {"extra": "allow"}  # Allow any additional fields

    playbackPosition: dict[str, Any] | None = None  # pyright: ignore[reportExplicitAny]
    stems: dict[str, Any] | None = None  # pyright: ignore[reportExplicitAny]
    eq: dict[str, Any] | None = None  # pyright: ignore[reportExplicitAny]
    parametricEq: dict[str, Any] | None = None  # pyright: ignore[reportExplicitAny]
    compressor: dict[str, Any] | None = None  # pyright: ignore[reportExplicitAny]
    reverb: dict[str, Any] | None = None  # pyright: ignore[reportExplicitAny]
    stereoExpander: dict[str, Any] | None = None  # pyright: ignore[reportExplicitAny]


class SongMetadata(BaseModel):
    """Song metadata."""

    id: str
    name: str


class LocationMetadata(BaseModel):
    """Location metadata."""

    id: str
    name: str


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
    song: SongMetadata | None = None
    location: LocationMetadata | None = None
    date_recorded: str | None = None  # ISO format date string


class LogoutResponse(BaseModel):
    """Logout response."""

    success: bool


class StemData(BaseModel):
    """Stem data for worker callback."""

    stem_type: str
    measured_lufs: float
    peak_amplitude: float
    stem_gain_adjustment_db: float
    audio_url: str
    waveform_url: str
    file_size_bytes: int
    duration_seconds: float


class RecordingStatusResponse(BaseModel):
    """Recording status response."""

    recording_id: str
    status: str  # "processing", "complete", "error"
    error_message: str | None = None
    output_name: str
    display_name: str
    stems: list[dict[str, str | float | int]]
    config: RecordingConfigData | None = None


class ClipResponse(BaseModel):
    """Clip information response."""

    id: str  # clip UUID
    recording_id: str
    song_id: str | None = None
    start_time_sec: float
    end_time_sec: float
    display_name: str | None = None
    created_at: str
    updated_at: str


class ClipWithStemsResponse(BaseModel):
    """Clip with associated recording stems."""

    id: str
    recording_id: str
    song_id: str | None = None
    start_time_sec: float
    end_time_sec: float
    display_name: str | None = None
    created_at: str
    updated_at: str
    recording_output_name: str
    stems: list[StemResponse]


class CreateClipRequest(BaseModel):
    """Request to create a new clip."""

    recording_id: str
    start_time_sec: float
    end_time_sec: float
    song_id: str | None = None
    display_name: str | None = None


class UpdateClipRequest(BaseModel):
    """Request to update a clip."""

    start_time_sec: float | None = None
    end_time_sec: float | None = None
    song_id: str | None = None
    display_name: str | None = None
