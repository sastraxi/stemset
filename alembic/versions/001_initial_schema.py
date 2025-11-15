"""Initial schema with users, profiles, audio files, recordings, and stems

Revision ID: 001
Revises:
Create Date: 2025-01-30

"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Create users table
    op.create_table(
        "users",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("email", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=True),
        sa.Column("picture_url", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_users_email"), "users", ["email"], unique=True)

    # Create profiles table
    op.create_table(
        "profiles",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("source_folder", sa.String(), nullable=False),
        sa.Column("strategy_name", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_profiles_name"), "profiles", ["name"], unique=True)

    # Create user_profiles join table
    op.create_table(
        "user_profiles",
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("profile_id", sa.UUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["profile_id"],
            ["profiles.id"],
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
        ),
        sa.PrimaryKeyConstraint("user_id", "profile_id"),
    )

    # Create audio_files table
    op.create_table(
        "audio_files",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("profile_id", sa.UUID(), nullable=False),
        sa.Column("filename", sa.String(), nullable=False),
        sa.Column("file_hash", sa.String(), nullable=False),
        sa.Column("storage_url", sa.String(), nullable=False),
        sa.Column("file_size_bytes", sa.Integer(), nullable=False),
        sa.Column("duration_seconds", sa.Float(), nullable=False),
        sa.Column("uploaded_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["profile_id"],
            ["profiles.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_audio_files_file_hash"), "audio_files", ["file_hash"], unique=True)
    op.create_index(op.f("ix_audio_files_profile_id"), "audio_files", ["profile_id"], unique=False)

    # Create recordings table
    op.create_table(
        "recordings",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("profile_id", sa.UUID(), nullable=False),
        sa.Column("output_name", sa.String(), nullable=False),
        sa.Column("display_name", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["profile_id"],
            ["profiles.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_recordings_profile_id"), "recordings", ["profile_id"], unique=False)

    # Create stems table
    op.create_table(
        "stems",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("recording_id", sa.UUID(), nullable=False),
        sa.Column("audio_file_id", sa.UUID(), nullable=False),
        sa.Column("stem_type", sa.String(), nullable=False),
        sa.Column("measured_lufs", sa.Float(), nullable=False),
        sa.Column("peak_amplitude", sa.Float(), nullable=False),
        sa.Column("stem_gain_adjustment_db", sa.Float(), nullable=False),
        sa.Column("audio_url", sa.String(), nullable=False),
        sa.Column("waveform_url", sa.String(), nullable=False),
        sa.Column("file_size_bytes", sa.Integer(), nullable=False),
        sa.Column("duration_seconds", sa.Float(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["audio_file_id"],
            ["audio_files.id"],
        ),
        sa.ForeignKeyConstraint(
            ["recording_id"],
            ["recordings.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_stems_audio_file_id"), "stems", ["audio_file_id"], unique=False)
    op.create_index(op.f("ix_stems_recording_id"), "stems", ["recording_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_stems_recording_id"), table_name="stems")
    op.drop_index(op.f("ix_stems_audio_file_id"), table_name="stems")
    op.drop_table("stems")
    op.drop_index(op.f("ix_recordings_profile_id"), table_name="recordings")
    op.drop_table("recordings")
    op.drop_index(op.f("ix_audio_files_profile_id"), table_name="audio_files")
    op.drop_index(op.f("ix_audio_files_file_hash"), table_name="audio_files")
    op.drop_table("audio_files")
    op.drop_table("user_profiles")
    op.drop_index(op.f("ix_profiles_name"), table_name="profiles")
    op.drop_table("profiles")
    op.drop_index(op.f("ix_users_email"), table_name="users")
    op.drop_table("users")
