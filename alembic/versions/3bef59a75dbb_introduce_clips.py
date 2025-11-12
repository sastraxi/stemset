# pyright: reportUnusedCallResult=false, reportDeprecated=false
"""introduce_clips

Revision ID: 3bef59a75dbb
Revises: 751a4a03ce9b
Create Date: 2025-11-12 00:37:52.895359

"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "3bef59a75dbb"
down_revision: Union[str, Sequence[str], None] = "751a4a03ce9b"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Create clips table
    op.create_table(
        "clips",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("recording_id", sa.UUID(), nullable=False),
        sa.Column("song_id", sa.UUID(), nullable=True),
        sa.Column("start_time_sec", sa.Float(), nullable=False, server_default="0.0"),
        sa.Column("end_time_sec", sa.Float(), nullable=False),
        sa.Column("display_name", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["recording_id"], ["recordings.id"]),
        sa.ForeignKeyConstraint(["song_id"], ["songs.id"]),
        sa.CheckConstraint("end_time_sec > start_time_sec", name="ck_clip_time_range"),
    )
    op.create_index("ix_clips_recording_id", "clips", ["recording_id"])
    op.create_index("ix_clips_song_id", "clips", ["song_id"])

    # Data migration: Create full-length clips for all existing recordings
    # This uses a raw SQL query to join recordings with their stems to get duration
    op.execute("""
        INSERT INTO clips (id, recording_id, song_id, start_time_sec, end_time_sec, display_name, created_at, updated_at)
        SELECT
            gen_random_uuid() AS id,
            r.id AS recording_id,
            r.song_id,
            0.0 AS start_time_sec,
            MAX(s.duration_seconds) AS end_time_sec,
            NULL AS display_name,
            NOW() AS created_at,
            NOW() AS updated_at
        FROM recordings r
        INNER JOIN stems s ON s.recording_id = r.id
        WHERE r.status = 'complete'
        GROUP BY r.id, r.song_id
        HAVING COUNT(DISTINCT s.duration_seconds) = 1
    """)


def downgrade() -> None:
    """Downgrade schema."""
    # Drop clips table
    op.drop_index("ix_clips_song_id", "clips")
    op.drop_index("ix_clips_recording_id", "clips")
    op.drop_table("clips")
