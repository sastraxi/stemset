"""add_songs_locations_metadata

Revision ID: 751a4a03ce9b
Revises: 6ae465a8efd0
Create Date: 2025-11-02 14:08:48.846898

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "751a4a03ce9b"
down_revision: Union[str, Sequence[str], None] = "6ae465a8efd0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Create songs table
    op.create_table(
        "songs",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("profile_id", sa.UUID(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["profile_id"], ["profiles.id"]),
        sa.UniqueConstraint("profile_id", "name", name="uq_profile_song_name"),
    )
    op.create_index("ix_songs_profile_id", "songs", ["profile_id"])

    # Create locations table
    op.create_table(
        "locations",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("profile_id", sa.UUID(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["profile_id"], ["profiles.id"]),
        sa.UniqueConstraint("profile_id", "name", name="uq_profile_location_name"),
    )
    op.create_index("ix_locations_profile_id", "locations", ["profile_id"])

    # Add metadata columns to recordings table
    op.add_column("recordings", sa.Column("song_id", sa.UUID(), nullable=True))
    op.add_column("recordings", sa.Column("location_id", sa.UUID(), nullable=True))
    op.add_column(
        "recordings", sa.Column("date_recorded", sa.DateTime(timezone=False), nullable=True)
    )

    # Add foreign key constraints
    op.create_foreign_key("fk_recordings_song_id", "recordings", "songs", ["song_id"], ["id"])
    op.create_foreign_key(
        "fk_recordings_location_id", "recordings", "locations", ["location_id"], ["id"]
    )

    # Add indexes
    op.create_index("ix_recordings_song_id", "recordings", ["song_id"])
    op.create_index("ix_recordings_location_id", "recordings", ["location_id"])


def downgrade() -> None:
    """Downgrade schema."""
    # Drop indexes and foreign keys from recordings
    op.drop_index("ix_recordings_location_id", "recordings")
    op.drop_index("ix_recordings_song_id", "recordings")
    op.drop_constraint("fk_recordings_location_id", "recordings", type_="foreignkey")
    op.drop_constraint("fk_recordings_song_id", "recordings", type_="foreignkey")

    # Drop metadata columns from recordings
    op.drop_column("recordings", "date_recorded")
    op.drop_column("recordings", "location_id")
    op.drop_column("recordings", "song_id")

    # Drop locations table
    op.drop_index("ix_locations_profile_id", "locations")
    op.drop_table("locations")

    # Drop songs table
    op.drop_index("ix_songs_profile_id", "songs")
    op.drop_table("songs")
