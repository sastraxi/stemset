"""CLI command to migrate existing metadata.json files to PostgreSQL database."""

from __future__ import annotations

import hashlib
from pathlib import Path
from venv import logger

import soundfile as sf  # pyright: ignore[reportMissingTypeStubs]
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
            f"Failed to determine duration for {file_path}: {e}. "
            + "Duration is required - cannot proceed."
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


def build_input_file_hash_lookup() -> dict[str, tuple[str, Path | None]]:
    """
    Build a lookup table of file hash -> (storage_url, local_path).

    This hashes all local input files and then queries R2 for files with SHA256 metadata.
    Returns a dict where keys are SHA256 hashes and values are (storage_url, local_path).
    local_path is None for files only found in R2.
    """
    hash_lookup = {}

    print("🔍 Building hash lookup for input files...")

    # First, hash all local input files
    input_dir = Path("input")
    if input_dir.exists():
        print("  📁 Scanning local input/ directory...")
        for profile_dir in input_dir.iterdir():
            if not profile_dir.is_dir():
                continue

            print(f"    📂 Scanning {profile_dir.name}/")
            for audio_file in profile_dir.iterdir():
                if audio_file.is_file() and audio_file.suffix.lower() in [
                    ".wav",
                    ".mp3",
                    ".m4a",
                    ".flac",
                    ".aif",
                    ".aiff",
                ]:
                    try:
                        file_hash = compute_file_hash(audio_file)
                        storage_url = f"inputs/{profile_dir.name}/{audio_file.name}"
                        hash_lookup[file_hash] = (storage_url, audio_file)
                        print(f"      ✅ {audio_file.name}: {file_hash[:8]}...")
                    except Exception as e:
                        print(f"      ⚠️  Error hashing {audio_file}: {e}")
                        continue

    # Then, query R2 storage for files with SHA256 metadata
    config = load_config()
    if config.r2 is not None:
        from ..storage import R2Storage

        r2_storage = R2Storage(config.r2)

        print("  ☁️  Scanning R2 inputs/ bucket...")
        try:
            # List all objects under inputs/ prefix
            response = r2_storage.s3_client.list_objects_v2(
                Bucket=config.r2.bucket_name, Prefix="inputs/"
            )

            for obj in response.get("Contents", []):
                key = obj.get("Key")
                if not key:
                    logger.warning("R2 object with no Key found, skipping", extra=obj)
                    continue

                # Get object metadata to check SHA256
                try:
                    head_response = r2_storage.s3_client.head_object(
                        Bucket=config.r2.bucket_name, Key=key
                    )

                    metadata = head_response.get("Metadata", {})
                    stored_hash = metadata.get("sha256")

                    if stored_hash:
                        # Only add if we don't already have this hash from local files
                        if stored_hash not in hash_lookup:
                            hash_lookup[stored_hash] = (key, None)
                            filename = key.split("/")[-1]
                            print(f"      ✅ {filename}: {stored_hash[:8]}...")

                except Exception as e:
                    print(f"      ⚠️  Error checking R2 object {key}: {e}")
                    continue

        except Exception as e:
            print(f"    ⚠️  Error scanning R2 storage: {e}")

    print(f"  📊 Found {len(hash_lookup)} unique input files")
    return hash_lookup


def migrate_profile(
    session: Session,
    profile: Profile,
    hash_lookup: dict[str, tuple[str, Path | None]],
) -> None:
    """Migrate one profile's data from filesystem to database."""
    media_dir = Path(profile.output_folder)
    if not media_dir.exists():
        print(f"  📁 No media directory found for profile '{profile.name}', skipping")
        return

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

        # Try to find source audio file using hash lookup
        source_audio_path = None
        file_hash = None
        storage_url = None
        source_filename = None

        # First check if there's a source file in the recording directory (legacy approach)
        audio_extensions = [".wav", ".mp3", ".m4a", ".flac", ".aif", ".aiff"]
        for ext in audio_extensions:
            potential_source = recording_dir / f"source{ext}"
            if potential_source.exists():
                source_audio_path = potential_source
                file_hash = compute_file_hash(source_audio_path)
                source_filename = source_audio_path.name
                storage_url = f"={profile.input_folder}/{source_filename}"
                break

        # If not found locally, try to find by matching partial hash from folder name
        if not source_audio_path:
            # Extract partial hash from output_name (folder name)
            # Format: "2025-09-22_-_We_re_not_right_f4e5a89b" -> "f4e5a89b"
            parts = output_name.split("_")
            if len(parts) >= 2:
                partial_hash = parts[-1]  # Get the last part after the final underscore

                # Search for a full hash that starts with this partial hash
                matching_hash = None
                for full_hash in hash_lookup:
                    if full_hash.startswith(partial_hash):
                        matching_hash = full_hash
                        break

                if matching_hash:
                    # Found the source file by partial hash match!
                    storage_url, source_audio_path = hash_lookup[matching_hash]
                    file_hash = matching_hash
                    source_filename = storage_url.split("/")[-1]
                    print(
                        f"    ✅ Found source file by partial hash {partial_hash}: {source_filename}"
                    )
                else:
                    print(f"    ⚠️  No input file found matching partial hash: {partial_hash}")

            if not file_hash:
                # Last resort: create placeholder AudioFile entry
                first_stem_name = next(iter(metadata.stems.keys()))
                first_stem_metadata = metadata.stems[first_stem_name]
                sample_stem_path = recording_dir / first_stem_metadata.stem_url

                if not sample_stem_path.exists():
                    print(f"    ⚠️  Skipping {output_name} - cannot find stem files")
                    continue

                # Use output_name as fallback hash for placeholder
                file_hash = hashlib.sha256(output_name.encode()).hexdigest()
                source_filename = f"{output_name}.wav"  # Inferred
                storage_url = f"{profile.input_folder}/{source_filename}"

                print(
                    f"    ℹ️  No source file found for '{output_name}', "
                    + "creating placeholder AudioFile"
                )

        # Determine audio file properties
        if source_audio_path:
            # We have the actual file - get real properties
            duration_seconds = get_audio_duration(source_audio_path)
            file_size_bytes = get_file_size(source_audio_path)
        else:
            # Use stem file to infer duration, unknown file size
            first_stem_name = next(iter(metadata.stems.keys()))
            first_stem_metadata = metadata.stems[first_stem_name]
            sample_stem_path = recording_dir / first_stem_metadata.stem_url
            duration_seconds = get_audio_duration(sample_stem_path)
            file_size_bytes = 0  # Unknown for placeholder

        # Ensure we have all required values before creating AudioFile
        if not file_hash or not source_filename or not storage_url:
            print(f"    ⚠️  Skipping {output_name} - missing required file information")
            continue

        # Check if AudioFile already exists by hash
        result = session.exec(select(AudioFile).where(AudioFile.file_hash == file_hash))
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
        print(f"    ✅ Migrated recording '{output_name}' with {stem_count} stem(s)")


def run_migration() -> None:
    """Main migration function."""
    print("🚀 Starting database migration from metadata.json files...\n")

    # Build hash lookup for all input files
    hash_lookup = build_input_file_hash_lookup()
    print()

    # Iterate over all Profiles in the database
    engine = get_sync_engine()
    with Session(engine) as session:
        for profile in session.exec(select(Profile)):
            print(f"📋 Processing profile: {profile.name}")
            migrate_profile(session, profile, hash_lookup)
            print()

    print("✨ Migration complete!")


def migrate_command() -> None:
    """CLI entrypoint for migration command."""
    run_migration()
