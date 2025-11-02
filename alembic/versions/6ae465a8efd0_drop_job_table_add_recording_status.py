"""drop_job_table_add_recording_status

Revision ID: 6ae465a8efd0
Revises: 6bca8a156b3a
Create Date: 2025-11-02 01:25:23.445097

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '6ae465a8efd0'
down_revision: Union[str, Sequence[str], None] = '6bca8a156b3a'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Add status tracking fields to recordings table
    op.add_column('recordings', sa.Column('status', sa.String(), nullable=False, server_default='complete'))
    op.add_column('recordings', sa.Column('error_message', sa.String(), nullable=True))
    op.add_column('recordings', sa.Column('verification_token', sa.String(), nullable=True))

    # Drop the jobs table (no longer needed)
    op.drop_table('jobs')


def downgrade() -> None:
    """Downgrade schema."""
    # Recreate jobs table
    op.create_table(
        'jobs',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('job_id', sa.String(), nullable=False),
        sa.Column('verification_token', sa.String(), nullable=False),
        sa.Column('profile_id', sa.UUID(), nullable=False),
        sa.Column('recording_id', sa.UUID(), nullable=False),
        sa.Column('audio_file_id', sa.UUID(), nullable=False),
        sa.Column('filename', sa.String(), nullable=False),
        sa.Column('file_hash', sa.String(), nullable=False),
        sa.Column('output_name', sa.String(), nullable=False),
        sa.Column('status', sa.String(), nullable=False),
        sa.Column('error_message', sa.String(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['profile_id'], ['profiles.id']),
        sa.ForeignKeyConstraint(['recording_id'], ['recordings.id']),
        sa.ForeignKeyConstraint(['audio_file_id'], ['audio_files.id']),
    )
    op.create_index('ix_jobs_job_id', 'jobs', ['job_id'], unique=True)
    op.create_index('ix_jobs_verification_token', 'jobs', ['verification_token'], unique=False)
    op.create_index('ix_jobs_profile_id', 'jobs', ['profile_id'], unique=False)
    op.create_index('ix_jobs_recording_id', 'jobs', ['recording_id'], unique=False)
    op.create_index('ix_jobs_audio_file_id', 'jobs', ['audio_file_id'], unique=False)

    # Remove new columns from recordings
    op.drop_column('recordings', 'verification_token')
    op.drop_column('recordings', 'error_message')
    op.drop_column('recordings', 'status')
