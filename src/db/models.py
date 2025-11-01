# pyright: reportExplicitAny=false
"""Database models for Stemset using SQLModel."""

from datetime import datetime, timezone
from pathlib import Path
from typing import Any, ClassVar
from uuid import UUID, uuid4

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Column, Field, Relationship, SQLModel

from src.config import OutputConfig  # pyright: ignore[reportUnknownVariableType]


def utc_now() -> datetime:
    """Return current UTC datetime."""
    return datetime.now(timezone.utc)


def new_uuid() -> UUID:
    """Generate a new UUIDv4."""
    return uuid4()


# Join table for User ↔ Profile many-to-many relationship
class UserProfile(SQLModel, table=True):
    """Join table for User ↔ Profile many-to-many relationship."""

    __tablename__: ClassVar[Any] = "user_profiles"

    user_id: UUID = Field(foreign_key="users.id", primary_key=True)
    profile_id: UUID = Field(foreign_key="profiles.id", primary_key=True)
    created_at: datetime = Field(
        default_factory=utc_now, sa_column=Column(sa.DateTime(timezone=True), nullable=False)
    )


class User(SQLModel, table=True):
    """OAuth user with email-based authentication."""

    __tablename__: ClassVar[Any] = "users"

    id: UUID = Field(default_factory=new_uuid, primary_key=True)
    email: str = Field(unique=True, index=True)
    name: str | None = None
    picture_url: str | None = None
    created_at: datetime = Field(
        default_factory=utc_now, sa_column=Column(sa.DateTime(timezone=True), nullable=False)
    )
    last_login_at: datetime = Field(
        default_factory=utc_now, sa_column=Column(sa.DateTime(timezone=True), nullable=False)
    )

    # Relationships
    profiles: list["Profile"] = Relationship(
        back_populates="users", link_model=UserProfile, sa_relationship_kwargs={"lazy": "noload"}
    )


class Profile(SQLModel, table=True):
    """Processing profile (e.g., h4n, bobw)."""

    __tablename__: ClassVar[Any] = "profiles"

    id: UUID = Field(default_factory=new_uuid, primary_key=True)
    name: str = Field(unique=True, index=True)
    source_folder: str
    strategy_name: str
    created_at: datetime = Field(
        default_factory=utc_now, sa_column=Column(sa.DateTime(timezone=True), nullable=False)
    )

    # Relationships
    users: list["User"] = Relationship(
        back_populates="profiles", link_model=UserProfile, sa_relationship_kwargs={"lazy": "noload"}
    )
    audio_files: list["AudioFile"] = Relationship(
        back_populates="profile", sa_relationship_kwargs={"lazy": "noload"}
    )
    recordings: list["Recording"] = Relationship(
        back_populates="profile", sa_relationship_kwargs={"lazy": "noload"}
    )

    # TODO: Set output configuration in the database?
    @property
    def output(self):
        return OutputConfig()

    @property
    def input_folder(self) -> str:
        return f"input/{self.name}"

    @property
    def output_folder(self) -> str:
        return f"media/{self.name}"


class AudioFile(SQLModel, table=True):
    """Original uploaded/scanned source audio file."""

    __tablename__: ClassVar[Any] = "audio_files"

    id: UUID = Field(default_factory=new_uuid, primary_key=True)
    profile_id: UUID = Field(foreign_key="profiles.id", index=True)
    filename: str
    file_hash: str = Field(unique=True, index=True)  # SHA256
    storage_url: str  # R2/local path (e.g., "inputs/h4n/myfile.wav")
    file_size_bytes: int
    duration_seconds: float  # NOT NULL - fail fast if unknown
    uploaded_at: datetime = Field(
        default_factory=utc_now, sa_column=Column(sa.DateTime(timezone=True), nullable=False)
    )

    # Relationships
    profile: "Profile" = Relationship(
        back_populates="audio_files", sa_relationship_kwargs={"lazy": "noload"}
    )
    stems: list["Stem"] = Relationship(
        back_populates="audio_file", sa_relationship_kwargs={"lazy": "noload"}
    )


class Recording(SQLModel, table=True):
    """Processed output with separated stems (replaces 'Song')."""

    __tablename__: ClassVar[Any] = "recordings"

    id: UUID = Field(default_factory=new_uuid, primary_key=True)
    profile_id: UUID = Field(foreign_key="profiles.id", index=True)
    output_name: str  # Folder name in media/ (e.g., "080805-001")
    display_name: str  # User-editable, defaults to filename
    created_at: datetime = Field(
        default_factory=utc_now, sa_column=Column(sa.DateTime(timezone=True), nullable=False)
    )
    updated_at: datetime = Field(
        default_factory=utc_now, sa_column=Column(sa.DateTime(timezone=True), nullable=False)
    )

    # Relationships
    profile: "Profile" = Relationship(
        back_populates="recordings", sa_relationship_kwargs={"lazy": "noload"}
    )
    stems: list["Stem"] = Relationship(
        back_populates="recording", sa_relationship_kwargs={"lazy": "noload"}
    )


class Stem(SQLModel, table=True):
    """Individual separated track (vocals, drums, bass, etc.)."""

    __tablename__: ClassVar[Any] = "stems"

    id: UUID = Field(default_factory=new_uuid, primary_key=True)
    recording_id: UUID = Field(foreign_key="recordings.id", index=True)
    audio_file_id: UUID = Field(
        foreign_key="audio_files.id", index=True
    )  # Source file this stem came from
    stem_type: str  # "vocals", "drums", "bass", etc.
    measured_lufs: float
    peak_amplitude: float
    stem_gain_adjustment_db: float
    audio_url: str  # Relative path (e.g., "vocals.opus")
    waveform_url: str  # Relative path (e.g., "vocals_waveform.png")
    file_size_bytes: int
    duration_seconds: float  # NOT NULL - fail fast if unknown
    created_at: datetime = Field(
        default_factory=utc_now, sa_column=Column(sa.DateTime(timezone=True), nullable=False)
    )

    # Relationships
    recording: "Recording" = Relationship(
        back_populates="stems", sa_relationship_kwargs={"lazy": "noload"}
    )
    audio_file: "AudioFile" = Relationship(
        back_populates="stems", sa_relationship_kwargs={"lazy": "noload"}
    )


class Job(SQLModel, table=True):
    """Processing job for tracking async GPU worker tasks."""

    __tablename__: ClassVar[Any] = "jobs"

    id: UUID = Field(default_factory=new_uuid, primary_key=True)
    job_id: str = Field(unique=True, index=True)  # UUID string for external reference
    verification_token: str = Field(index=True)  # Random secret for callback authentication
    profile_id: UUID = Field(foreign_key="profiles.id", index=True)
    recording_id: UUID = Field(foreign_key="recordings.id", index=True)
    audio_file_id: UUID = Field(foreign_key="audio_files.id", index=True)

    # Job details
    filename: str
    file_hash: str
    output_name: str

    # Status tracking
    status: str  # "processing", "complete", "error"
    error_message: str | None = None

    # Timestamps
    created_at: datetime = Field(
        default_factory=utc_now, sa_column=Column(sa.DateTime(timezone=True), nullable=False)
    )
    completed_at: datetime | None = Field(
        default=None, sa_column=Column(sa.DateTime(timezone=True), nullable=True)
    )

    # Relationships
    profile: "Profile" = Relationship(sa_relationship_kwargs={"lazy": "noload"})
    recording: "Recording" = Relationship(sa_relationship_kwargs={"lazy": "noload"})
    audio_file: "AudioFile" = Relationship(sa_relationship_kwargs={"lazy": "noload"})


class RecordingUserConfig(SQLModel, table=True):
    """User-specific recording configuration (effects, playback position, stem settings)."""

    __tablename__: ClassVar[Any] = "recording_user_configs"

    id: UUID = Field(default_factory=new_uuid, primary_key=True)
    user_id: UUID = Field(foreign_key="users.id", index=True)
    recording_id: UUID = Field(foreign_key="recordings.id", index=True)
    config_key: str = Field(max_length=50)  # 'playbackPosition', 'stems', 'effects'
    config_value: dict[str, float | str | bool] = Field(sa_column=Column(JSONB, nullable=False))
    created_at: datetime = Field(
        default_factory=utc_now, sa_column=Column(sa.DateTime(timezone=True), nullable=False)
    )
    updated_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(sa.DateTime(timezone=True), nullable=False, onupdate=utc_now),
    )

    # Relationships
    user: "User" = Relationship(sa_relationship_kwargs={"lazy": "noload"})
    recording: "Recording" = Relationship(sa_relationship_kwargs={"lazy": "noload"})

    # Composite unique constraint (user_id, recording_id, config_key)
    __table_args__ = (
        sa.UniqueConstraint(
            "user_id", "recording_id", "config_key", name="uq_user_recording_config_key"
        ),
        sa.Index("idx_user_recording_configs", "user_id", "recording_id"),
    )
