"""Normalize AudioFile schema and add Google Drive support

Revision ID: 011_normalize_audiofile
Revises: 010_migrate_song
Create Date: 2025-11-18 00:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "011_normalize_audiofile"
down_revision: Union[str, Sequence[str], None] = "010_migrate_song"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # 1. Add google_drive_folder_id to profiles
    op.add_column(
        'profiles',
        sa.Column('google_drive_folder_id', sa.String(), nullable=True)
    )

    # 1b. Add google_refresh_token to users
    op.add_column(
        'users',
        sa.Column('google_refresh_token', sa.String(), nullable=True)
    )

    # 2. Add new source tracking columns to audio_files
    op.add_column(
        'audio_files',
        sa.Column('source_type', sa.String(), nullable=True)
    )
    op.add_column(
        'audio_files',
        sa.Column('source_id', sa.String(), nullable=True)
    )
    op.add_column(
        'audio_files',
        sa.Column('source_parent_id', sa.String(), nullable=True)
    )
    op.add_column(
        'audio_files',
        sa.Column('source_modified_time', sa.Integer(), nullable=True)
    )

    # 3. Migrate existing data: mark all existing files as "upload" type
    #    and use file_hash as source_id
    op.execute("""
        UPDATE audio_files
        SET source_type = 'upload',
            source_id = file_hash,
            source_parent_id = NULL,
            source_modified_time = NULL
    """)

    # 4. Make source_type and source_id NOT NULL after backfilling
    op.alter_column('audio_files', 'source_type', nullable=False)
    op.alter_column('audio_files', 'source_id', nullable=False)

    # 5. Drop old unique constraint/index on file_hash (if it exists)
    #    We need to allow same hash across different source types
    op.drop_index('ix_audio_files_file_hash', 'audio_files', if_exists=True)

    # 6. Create new unique constraint on (profile_id, source_type, source_id)
    op.create_unique_constraint(
        'uq_audio_files_profile_source',
        'audio_files',
        ['profile_id', 'source_type', 'source_id']
    )

    # 7. Create index on source_id for faster lookups
    op.create_index('ix_audio_files_source_id', 'audio_files', ['source_id'])

    # 8. Drop storage_url and duration_seconds (will be derived)
    #    Note: We'll compute storage_url from profile_id + file_hash
    #    and duration_seconds from first stem
    op.drop_column('audio_files', 'storage_url')
    op.drop_column('audio_files', 'duration_seconds')


def downgrade() -> None:
    """Downgrade schema."""
    # Reverse the migration

    # 0. Drop google_refresh_token from users
    op.drop_column('users', 'google_refresh_token')

    # 1. Re-add storage_url and duration_seconds
    op.add_column(
        'audio_files',
        sa.Column('storage_url', sa.String(), nullable=True)
    )
    op.add_column(
        'audio_files',
        sa.Column('duration_seconds', sa.Float(), nullable=True)
    )

    # 2. Backfill storage_url from profile name + filename
    #    This is best-effort; may not be perfect
    op.execute("""
        UPDATE audio_files
        SET storage_url = 'inputs/' || profiles.name || '/' || audio_files.filename,
            duration_seconds = 0.0
        FROM profiles
        WHERE audio_files.profile_id = profiles.id
    """)

    op.alter_column('audio_files', 'storage_url', nullable=False)
    op.alter_column('audio_files', 'duration_seconds', nullable=False)

    # 3. Drop new constraint and index
    op.drop_index('ix_audio_files_source_id', 'audio_files')
    op.drop_constraint('uq_audio_files_profile_source', 'audio_files', type_='unique')

    # 4. Re-create unique index on file_hash
    op.create_index('ix_audio_files_file_hash', 'audio_files', ['file_hash'], unique=True)

    # 5. Drop source tracking columns
    op.drop_column('audio_files', 'source_modified_time')
    op.drop_column('audio_files', 'source_parent_id')
    op.drop_column('audio_files', 'source_id')
    op.drop_column('audio_files', 'source_type')

    # 6. Drop google_drive_folder_id from profiles
    op.drop_column('profiles', 'google_drive_folder_id')
