"""Migrate song from recording to clips

Revision ID: 010_migrate_song
Revises: c30e8283f491
Create Date: 2025-11-15 14:45:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "010_migrate_song"
down_revision: Union[str, Sequence[str], None] = "c30e8283f491"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Migrate song_id from recordings to clips where clips don't have a song
    op.execute("""
        UPDATE clips
        SET song_id = recordings.song_id
        FROM recordings
        WHERE clips.recording_id = recordings.id
          AND clips.song_id IS NULL
          AND recordings.song_id IS NOT NULL
    """)

    # Drop song_id column from recordings table
    op.drop_column('recordings', 'song_id')


def downgrade() -> None:
    """Downgrade schema."""
    # Re-add song_id column to recordings
    op.add_column(
        'recordings',
        sa.Column('song_id', sa.UUID(), nullable=True)
    )

    # Re-create foreign key constraint
    op.create_foreign_key(
        'recordings_song_id_fkey',
        'recordings',
        'songs',
        ['song_id'],
        ['id'],
        ondelete='SET NULL'
    )
