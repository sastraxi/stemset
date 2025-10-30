"""CLI command to migrate existing metadata.json files to PostgreSQL database."""

from __future__ import annotations

import hashlib
from pathlib import Path

import soundfile as sf
from sqlmodel import Session, select

from src.config import load_config
from src.db.config import get_sync_engine
from src.db.models import AudioFile, Profile, Recording, Stem
from src.models.metadata import StemsMetadata


def get_audio_duration(file_path: Path) -> float:
    """Get audio file duration in seconds. Fail fast if cannot be determined."""
    try:
        info = sf.info(str(file_path))
        return float(info.duration)
    except Exception as e:
        raise ValueError(
            f"Failed to determine duration for {file_path}: {e}. " +
            "Duration is required - cannot proceed."
        ) from e


def get_file_size(file_path: Path) -> int:
    """Get file size in bytes."""
    return file_path.stat().st_size


def compute_file_hash(file_path: Path) -> str:
    """Compute SHA256 hash of file contents."""
    sha256 = hashlib.sha256()
    with open(file_path, "rb") as f:
        while chunk := f.read(8192):
            sha256.update(chunk)
    return sha256.hexdigest()


def migrate_profile(
    session: Session, profile_name: str, profile_source: str, strategy_name: str
) -> None:
    """Migrate one profile's data from filesystem to database."""
    media_dir = Path("media") / profile_name
    if not media_dir.exists():
        print(f"  📁 No media directory found for profile '{profile_name}', skipping")
        return

    # Create or get Profile record
    result = session.exec(select(Profile).where(Profile.name == profile_name))
    profile = result.first()
    if not profile:
        profile = Profile(
            name=profile_name,
            source_folder=profile_source,
            strategy_name=strategy_name,
        )
        session.add(profile)
        session.commit()
        session.refresh(profile)
        print(f"  ✅ Created profile: {profile_name}")
    else:
        print(f"  ℹ️  Profile '{profile_name}' already exists")

    # Scan output directories (each is one recording)
    recording_dirs = [d for d in media_dir.iterdir() if d.is_dir()]
    print(f"  📂 Found {len(recording_dirs)} recording(s)")

    for recording_dir in recording_dirs:
        metadata_file = recording_dir / "metadata.json"
        if not metadata_file.exists():
            print(f"    ⚠️  Skipping {recording_dir.name} - no metadata.json")
            continue

        output_name = recording_dir.name

        # Check if recording already exists
        result = session.exec(
            select(Recording).where(
                Recording.profile_id == profile.id,
                Recording.output_name == output_name,
            )
        )
        existing_recording = result.first()
        if existing_recording:
            print(f"    ⏭️  Recording '{output_name}' already migrated, skipping")
            continue

        # Load metadata using Pydantic model for type safety
        metadata = StemsMetadata.from_file(metadata_file)

        if not metadata.stems:
            print(f"    ⚠️  Skipping {output_name} - no stems in metadata")
            continue

        # Try to find source audio file
        # Pattern: Look for common audio file extensions in the recording directory
        # or in the profile's source folder
        source_audio_path = None
        audio_extensions = [".wav", ".mp3", ".m4a", ".flac", ".aif", ".aiff"]

        # First check if there's a source file in the recording directory
        for ext in audio_extensions:
            potential_source = recording_dir / f"source{ext}"
            if potential_source.exists():
                source_audio_path = potential_source
                break

        # If not found, we'll need to create a dummy AudioFile entry
        # In a real scenario, you might want to skip this or handle it differently
        if not source_audio_path:
            # For migration purposes, we'll infer from the first stem file
            first_stem_name = next(iter(metadata.stems.keys()))
            first_stem_metadata = metadata.stems[first_stem_name]
            sample_stem_path = recording_dir / first_stem_metadata.stem_url

            if not sample_stem_path.exists():
                print(f"    ⚠️  Skipping {output_name} - cannot find stem files")
                continue

            # Use stem to infer audio file properties
            # For hash, we'll use output_name as a fallback
            file_hash = hashlib.sha256(output_name.encode()).hexdigest()
            duration_seconds = get_audio_duration(sample_stem_path)
            file_size_bytes = 0  # Unknown for source
            source_filename = f"{output_name}.wav"  # Inferred
            storage_url = f"inputs/{profile_name}/{source_filename}"

            print(
                f"    ℹ️  No source file found for '{output_name}', " +
                "creating placeholder AudioFile"
            )
        else:
            # We have an actual source file
            file_hash = compute_file_hash(source_audio_path)
            duration_seconds = get_audio_duration(source_audio_path)
            file_size_bytes = get_file_size(source_audio_path)
            source_filename = source_audio_path.name
            storage_url = f"inputs/{profile_name}/{source_filename}"

        # Check if AudioFile already exists by hash
        result = session.exec(
            select(AudioFile).where(AudioFile.file_hash == file_hash)
        )
        audio_file = result.first()
        if not audio_file:
            audio_file = AudioFile(
                profile_id=profile.id,
                filename=source_filename,
                file_hash=file_hash,
                storage_url=storage_url,
                file_size_bytes=file_size_bytes,
                duration_seconds=duration_seconds,
            )
            session.add(audio_file)
            session.commit()
            session.refresh(audio_file)

        # Create Recording
        display_name = metadata.display_name or output_name
        recording = Recording(
            profile_id=profile.id,
            output_name=output_name,
            display_name=display_name,
        )
        session.add(recording)
        session.commit()
        session.refresh(recording)

        # Create Stems
        stem_count = 0
        for stem_type, stem_metadata in metadata.stems.items():
            stem_path = recording_dir / stem_metadata.stem_url
            if not stem_path.exists():
                print(f"      ⚠️  Stem file not found: {stem_path}")
                continue

            stem_duration = get_audio_duration(stem_path)
            stem_size = get_file_size(stem_path)

            stem = Stem(
                recording_id=recording.id,
                audio_file_id=audio_file.id,
                stem_type=stem_type,
                measured_lufs=stem_metadata.measured_lufs,
                peak_amplitude=stem_metadata.peak_amplitude,
                stem_gain_adjustment_db=stem_metadata.stem_gain_adjustment_db,
                audio_url=stem_metadata.stem_url,
                waveform_url=stem_metadata.waveform_url,
                file_size_bytes=stem_size,
                duration_seconds=stem_duration,
            )
            session.add(stem)
            stem_count += 1

        session.commit()
        print(
            f"    ✅ Migrated recording '{output_name}' with {stem_count} stem(s)"
        )


def run_migration() -> None:
    """Main migration function."""
    print("🚀 Starting database migration from metadata.json files...\n")

    # Load config to get profiles
    config = load_config()

    engine = get_sync_engine()
    with Session(engine) as session:
        for profile_config in config.profiles:
            print(f"📋 Processing profile: {profile_config.name}")
            migrate_profile(
                session,
                profile_config.name,
                profile_config.source_folder,
                profile_config.strategy,
            )
            print()

    print("✨ Migration complete!")


def migrate_command() -> None:
    """CLI entrypoint for migration command."""
    run_migration()
