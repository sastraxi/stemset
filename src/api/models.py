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


class FileWithStems(BaseModel):
    """File with metadata URL."""

    name: str
    metadata_url: str


class JobStatusResponse(BaseModel):
    """Job status response."""

    job_id: str
    status: str  # "processing", "complete", or "error"
    stems: list[str] | None = None
    error: str | None = None


class TriggerProcessingRequest(BaseModel):
    """Request to trigger remote processing."""

    profile_name: str
    filename: str
    output_name: str  # Output folder name (e.g., song_abc12345)
