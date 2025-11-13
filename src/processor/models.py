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


class ClipBoundary(BaseModel):
    """Time boundary for a detected clip within a recording."""

    start_time_sec: float
    end_time_sec: float


class ProcessingCallbackPayload(BaseModel):
    """Payload sent to callback endpoint after processing."""

    status: str  # "complete" or "error"
    stems: list[StemDataModel] | None = None  # Only present when status="complete"
    error: str | None = None  # Only present when status="error"
    clip_boundaries: dict[str, ClipBoundary] | None = None  # Optional clip detection results (keyed by clip ID)


class WorkerJobPayload(BaseModel):
    """Payload sent to worker (Modal or local) to initiate processing.

    Note: verification_token is embedded in callback_url path, not sent separately.
    """

    recording_id: str
    profile_name: str
    strategy_name: str
    input_filename: str
    output_name: str
    callback_url: str  # Contains embedded verification_token in URL path


class WorkerAcceptedResponse(BaseModel):
    """Response from worker when job is accepted."""

    status: str  # "accepted"
    recording_id: str


class UploadResponse(BaseModel):
    """Response from upload endpoint."""

    recording_id: str
    profile_name: str
    output_name: str
    filename: str
    status: str  # "processing" or "complete"
    message: str | None = None  # Optional message for already-processed files
