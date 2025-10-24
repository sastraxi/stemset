"""Pydantic models for GPU worker job payloads."""

from __future__ import annotations

from pydantic import BaseModel, Field

from ..config import OutputConfig


class ProcessingJob(BaseModel):
    """Job payload for audio processing."""

    job_id: str = Field(..., description="Unique job identifier")
    profile_name: str = Field(..., description="Profile name for output organization")
    strategy_name: str = Field(..., description="Strategy to use for separation")
    input_key: str = Field(..., description="R2 key for input file (e.g., inputs/h4n/file.wav)")
    output_name: str = Field(..., description="Output folder name (e.g., song_abc12345)")
    output_config: OutputConfig = Field(..., description="Output format configuration")
    callback_url: str | None = Field(default=None, description="URL to call when complete")


class ProcessingResult(BaseModel):
    """Result from audio processing."""

    job_id: str = Field(..., description="Job identifier")
    status: str = Field(..., description="Status (complete or error)")
    stems: list[str] | None = Field(default=None, description="List of stem names created")
    error: str | None = Field(default=None, description="Error message if status=error")
