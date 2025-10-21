"""Pydantic models for API responses."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel

from ..config import JobStatus


class AuthStatusResponse(BaseModel):
    """Auth status response."""

    authenticated: bool
    email: str | None = None


class ProfileResponse(BaseModel):
    """Profile information response."""

    name: str
    source_folder: str


class FileItem(BaseModel):
    """Processed file item."""

    name: str
    path: str
    created_at: str


class FilesResponse(BaseModel):
    """List of processed files."""

    files: list[FileItem]


class ScanResponse(BaseModel):
    """Scan results response."""

    queued: int
    message: str


class JobResponse(BaseModel):
    """Job information response."""

    id: str
    profile_name: str
    input_file: str
    output_folder: str
    status: JobStatus
    created_at: datetime
    started_at: datetime | None
    completed_at: datetime | None
    output_files: dict[str, str] | None
    error: str | None


class QueueStatusResponse(BaseModel):
    """Queue status response."""

    queue_size: int
    processing: bool
    current_job: JobResponse | None


class FileWithStems(BaseModel):
    """File with stem paths."""

    name: str
    path: str
    stems: dict[str, str]


class JobListResponse(BaseModel):
    """List of jobs."""

    jobs: list[JobResponse]
