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
