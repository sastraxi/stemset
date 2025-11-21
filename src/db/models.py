# pyright: reportExplicitAny=false
"""Database models for Stemset using SQLModel."""

from datetime import datetime, timezone
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
    google_refresh_token: str | None = None  # OAuth refresh token for Drive API
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
    google_drive_folder_id: str | None = None
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
    songs: list["Song"] = Relationship(
        back_populates="profile", sa_relationship_kwargs={"lazy": "noload"}
    )
    locations: list["Location"] = Relationship(
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
    """Source audio file reference (upload, Google Drive, or local scan).

    Normalized schema with source tracking:
    - source_type: "upload" | "google_drive" | "local_scan"
    - source_id: Unique identifier within source type (file_hash or drive_file_id)
    - Unique constraint: (profile_id, source_type, source_id)

    Derived properties (not stored):
    - storage_url: Computed from profile + file_hash
    - duration_seconds: Query first stem
    """

    __tablename__: ClassVar[Any] = "audio_files"
    __table_args__: ClassVar[Any] = (
        sa.UniqueConstraint("profile_id", "source_type", "source_id", name="uq_audio_files_profile_source"),
    )

    id: UUID = Field(default_factory=new_uuid, primary_key=True)
    profile_id: UUID = Field(foreign_key="profiles.id", index=True)

    # Source tracking
    source_type: str  # "upload" | "google_drive" | "local_scan"
    source_id: str = Field(index=True)  # drive_file_id OR file_hash
    source_parent_id: str | None = None  # For navigation (drive folders)
    source_modified_time: int | None = None  # Unix timestamp

    # File metadata
    filename: str  # Display name
    file_hash: str  # SHA256 content hash (for dedup)
    file_size_bytes: int

    uploaded_at: datetime = Field(
        default_factory=utc_now, sa_column=Column(sa.DateTime(timezone=True), nullable=False)
    )

    # Relationships
    profile: "Profile" = Relationship(
        back_populates="audio_files", sa_relationship_kwargs={"lazy": "noload"}
    )
    recordings: list["Recording"] = Relationship(
        back_populates="audio_file", sa_relationship_kwargs={"lazy": "noload"}
    )
    stems: list["Stem"] = Relationship(
        back_populates="audio_file", sa_relationship_kwargs={"lazy": "noload"}
    )

    @property
    def is_from_drive(self) -> bool:
        """Check if this file originated from Google Drive."""
        return self.source_type == "google_drive"


class Song(SQLModel, table=True):
    """Song metadata owned by profile."""

    __tablename__: ClassVar[Any] = "songs"

    id: UUID = Field(default_factory=new_uuid, primary_key=True)
    profile_id: UUID = Field(foreign_key="profiles.id", index=True)
    name: str
    created_at: datetime = Field(
        default_factory=utc_now, sa_column=Column(sa.DateTime(timezone=True), nullable=False)
    )

    # Relationships
    profile: "Profile" = Relationship(sa_relationship_kwargs={"lazy": "noload"})
    clips: list["Clip"] = Relationship(
        back_populates="song", sa_relationship_kwargs={"lazy": "noload"}
    )

    # Unique constraint on (profile_id, name)
    __table_args__ = (sa.UniqueConstraint("profile_id", "name", name="uq_profile_song_name"),)


class Location(SQLModel, table=True):
    """Location metadata owned by profile."""

    __tablename__: ClassVar[Any] = "locations"

    id: UUID = Field(default_factory=new_uuid, primary_key=True)
    profile_id: UUID = Field(foreign_key="profiles.id", index=True)
    name: str
    created_at: datetime = Field(
        default_factory=utc_now, sa_column=Column(sa.DateTime(timezone=True), nullable=False)
    )

    # Relationships
    profile: "Profile" = Relationship(sa_relationship_kwargs={"lazy": "noload"})
    recordings: list["Recording"] = Relationship(
        back_populates="location", sa_relationship_kwargs={"lazy": "noload"}
    )

    # Unique constraint on (profile_id, name)
    __table_args__ = (sa.UniqueConstraint("profile_id", "name", name="uq_profile_location_name"),)


class Recording(SQLModel, table=True):
    """Processed output with separated stems (replaces 'Song')."""

    __tablename__: ClassVar[Any] = "recordings"

    id: UUID = Field(default_factory=new_uuid, primary_key=True)
    profile_id: UUID = Field(foreign_key="profiles.id", index=True)
    audio_file_id: UUID = Field(foreign_key="audio_files.id", index=True)
    output_name: str  # Folder name in media/ (e.g., "080805-001")
    display_name: str  # User-editable, defaults to filename

    # Metadata fields
    location_id: UUID | None = Field(default=None, foreign_key="locations.id", index=True)
    date_recorded: datetime | None = Field(
        default=None, sa_column=Column(sa.DateTime(timezone=False), nullable=True)
    )

    # Status tracking (replaces Job table)
    status: str = Field(default="processing")  # "processing", "complete", "error"
    error_message: str | None = None
    verification_token: str | None = None  # For callback authentication

    # Serialized metadata for reprocessing
    stems_metadata_json: dict[str, Any] | None = Field(
        default=None, sa_column=Column(JSONB, nullable=True)
    )
    clip_boundaries_json: dict[str, Any] | None = Field(
        default=None, sa_column=Column(JSONB, nullable=True)
    )

    # Idempotency flags
    separated_at: datetime | None = Field(
        default=None, sa_column=Column(sa.DateTime(timezone=True), nullable=True)
    )
    clips_detected_at: datetime | None = Field(
        default=None, sa_column=Column(sa.DateTime(timezone=True), nullable=True)
    )
    converted_at: datetime | None = Field(
        default=None, sa_column=Column(sa.DateTime(timezone=True), nullable=True)
    )

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
    audio_file: "AudioFile" = Relationship(
        back_populates="recordings", sa_relationship_kwargs={"lazy": "noload"}
    )
    stems: list["Stem"] = Relationship(
        back_populates="recording", sa_relationship_kwargs={"lazy": "noload"}
    )
    clips: list["Clip"] = Relationship(
        back_populates="recording", sa_relationship_kwargs={"lazy": "noload"}
    )
    location: Location | None = Relationship(
        back_populates="recordings", sa_relationship_kwargs={"lazy": "noload"}
    )


class Clip(SQLModel, table=True):
    """Timed portion of a recording [startTime ... endTime]."""

    __tablename__: ClassVar[Any] = "clips"

    id: UUID = Field(default_factory=new_uuid, primary_key=True)
    recording_id: UUID = Field(foreign_key="recordings.id", index=True)
    song_id: UUID | None = Field(default=None, foreign_key="songs.id", index=True)
    start_time_sec: float = Field(default=0.0, ge=0.0)  # Seconds from start (32-bit float)
    end_time_sec: float = Field(ge=0.0)  # Seconds from start (32-bit float)
    display_name: str | None = None  # User-editable label (e.g., "Verse 1")
    created_at: datetime = Field(
        default_factory=utc_now, sa_column=Column(sa.DateTime(timezone=True), nullable=False)
    )
    updated_at: datetime = Field(
        default_factory=utc_now, sa_column=Column(sa.DateTime(timezone=True), nullable=False)
    )

    # Relationships
    recording: "Recording" = Relationship(
        back_populates="clips", sa_relationship_kwargs={"lazy": "noload"}
    )
    song: Song | None = Relationship(
        back_populates="clips", sa_relationship_kwargs={"lazy": "noload"}
    )

    # Constraint: end_time_sec must be greater than start_time_sec
    __table_args__ = (
        sa.CheckConstraint("end_time_sec > start_time_sec", name="ck_clip_time_range"),
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


class RecordingUserConfig(SQLModel, table=True):
    """User-specific recording configuration (effects, playback position, stem settings)."""

    __tablename__: ClassVar[Any] = "recording_user_configs"

    id: UUID = Field(default_factory=new_uuid, primary_key=True)
    user_id: UUID = Field(foreign_key="users.id", index=True)
    recording_id: UUID = Field(foreign_key="recordings.id", index=True)
    config_key: str = Field(
        max_length=50
    )  # 'playbackPosition', 'stems', 'eq', 'parametricEq', 'compressor', 'reverb', 'stereoExpander'
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


class DriveWebhookSubscription(SQLModel, table=True):
    """Google Drive webhook subscription for auto-import monitoring.

    Tracks active Google Drive push notification channels per profile.
    Google Drive webhooks expire after max 24 hours, requiring periodic renewal.
    """

    __tablename__: ClassVar[Any] = "drive_webhook_subscriptions"

    id: UUID = Field(default_factory=new_uuid, primary_key=True)
    profile_id: UUID = Field(foreign_key="profiles.id", index=True)

    # Google Drive API subscription identifiers
    channel_id: str = Field(unique=True, index=True)  # UUID we generate
    resource_id: str  # Opaque ID returned by Drive API
    drive_folder_id: str  # Which folder we're watching

    # Subscription lifecycle
    expiration_time: datetime = Field(sa_column=Column(sa.DateTime(timezone=True), nullable=False))
    is_active: bool = Field(default=True, index=True)

    created_at: datetime = Field(
        default_factory=utc_now, sa_column=Column(sa.DateTime(timezone=True), nullable=False)
    )
    updated_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(sa.DateTime(timezone=True), nullable=False, onupdate=utc_now),
    )

    # Relationships
    profile: "Profile" = Relationship(sa_relationship_kwargs={"lazy": "noload"})
