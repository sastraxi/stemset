"""Audio processing logic for CLI."""

from __future__ import annotations

import asyncio
import soundfile as sf  # pyright: ignore[reportMissingTypeStubs]
import sys
from pathlib import Path

from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from ..config import get_config
from ..db.config import get_engine
from ..db.models import AudioFile, Profile, Recording, Stem
from ..models.metadata import StemMetadata
from ..utils import compute_file_hash, derive_output_name
from ..modern_separator import StemSeparator
from .scanner import AUDIO_EXTENSIONS, scan_for_new_files
from .remote_processor import process_file_remotely
from .sync import sync_profile_from_r2, sync_profile_to_r2


async def save_processing_results_to_db(
    profile: Profile,
    input_file: Path,
    file_hash: str,
    output_folder_name: str,
    output_folder: Path,
    stem_paths: dict[str, Path],
    stem_metadata: dict[str, StemMetadata],
) -> None:
    """Save processing results to the database.

    Creates AudioFile, Recording, and Stem records after successful separation.

    Args:
        profile: Profile configuration
        input_file: Path to the input audio file
        file_hash: SHA256 hash of the input file
        output_folder_name: Name of the output folder (e.g., "filename_hash")
        output_folder: Path to the output folder
        stem_paths: Dict mapping stem name to output file path
        stem_metadata: Dict mapping stem name to metadata
    """
    engine = get_engine()

    async with AsyncSession(engine) as session:
        # 1. Get or create Profile record
        result = await session.exec(select(Profile).where(Profile.name == profile.name))
        db_profile = result.first()
        if not db_profile:
            raise ValueError(f"Profile not found in database: {profile.name}")

        # 2. Get or create AudioFile record
        result = await session.exec(select(AudioFile).where(AudioFile.file_hash == file_hash))
        audio_file = result.first()
        if not audio_file:
            # Get file info
            file_size_bytes = input_file.stat().st_size
            info = sf.info(str(input_file))
            duration_seconds = float(info.duration)

            storage_url = f"inputs/{profile.name}/{input_file.name}"

            audio_file = AudioFile(
                profile_id=db_profile.id,
                filename=input_file.name,
                file_hash=file_hash,
                storage_url=storage_url,
                file_size_bytes=file_size_bytes,
                duration_seconds=duration_seconds,
            )
            session.add(audio_file)
            await session.commit()
            await session.refresh(audio_file)

        # 3. Create Recording record
        display_name = output_folder_name  # Use output folder name as default display name
        recording = Recording(
            profile_id=db_profile.id,
            output_name=output_folder_name,
            display_name=display_name,
        )
        session.add(recording)
        await session.commit()
        await session.refresh(recording)

        # 4. Create Stem records
        for stem_name, stem_path in stem_paths.items():
            metadata = stem_metadata[stem_name]
            stem_size = stem_path.stat().st_size
            stem_info = sf.info(str(stem_path))
            stem_duration = float(stem_info.duration)

            stem = Stem(
                recording_id=recording.id,
                audio_file_id=audio_file.id,
                stem_type=stem_name,
                measured_lufs=metadata.measured_lufs,
                peak_amplitude=metadata.peak_amplitude,
                stem_gain_adjustment_db=metadata.stem_gain_adjustment_db,
                audio_url=metadata.stem_url,
                waveform_url=metadata.waveform_url,
                file_size_bytes=stem_size,
                duration_seconds=stem_duration,
            )
            session.add(stem)

        await session.commit()


def save_to_database(
    profile: Profile,
    input_file: Path,
    file_hash: str,
    output_folder_name: str,
    output_folder: Path,
    stem_paths: dict[str, Path],
    stem_metadata: dict[str, StemMetadata],
) -> None:
    """Synchronous wrapper for save_processing_results_to_db."""
    asyncio.run(
        save_processing_results_to_db(
            profile,
            input_file,
            file_hash,
            output_folder_name,
            output_folder,
            stem_paths,
            stem_metadata,
        )
    )


def process_single_file(profile: Profile, file_path: Path, use_gpu: bool) -> int:
    """Process a single file using a profile, ignoring hash tracking.

    Args:
        profile: Profile object to use
        file_path: Path to the audio file to process
        use_local: If True, force local; if False, force GPU; if None, auto-detect

    Returns:
        Exit code (0 for success, 1 for error)
    """
    try:
        config = get_config()

        # Sync from R2 before processing (download any files not present locally)
        sync_profile_from_r2(config, profile)

        # Validate file exists and is an audio file
        if not file_path.exists():
            print(f"Error: File not found: {file_path}", file=sys.stderr)
            return 1

        if file_path.suffix.lower() not in AUDIO_EXTENSIONS:
            print(f"Error: File must be a WAV file, got: {file_path.suffix}", file=sys.stderr)
            return 1

        print(f"Processing file with profile: {profile.name}")
        print(f"Input file: {file_path}")
        print(f"Output format: {profile.output.format} @ {profile.output.bitrate}kbps")
        print()

        # Derive output name from filename
        output_name = derive_output_name(file_path)

        # Compute hash for output folder naming
        file_hash = compute_file_hash(file_path)
        output_folder_name = f"{output_name}_{file_hash[:8]}"

        media_dir = Path("media") / profile.name
        output_folder = media_dir / output_folder_name

        print(f"Output folder: {output_folder}")
        print()

        if use_gpu:
            print("Using GPU worker for processing (use --local to process locally)")
            try:
                stem_paths, stem_metadata = process_file_remotely(
                    config, profile, file_path, output_folder_name, output_folder
                )

                print()
                print("=" * 60)
                print(f"✓ Success! Created {len(stem_paths)} stems")
                for stem_name, stem_path in stem_paths.items():
                    print(f"  - {stem_name}: {stem_path.name}")
                print(f"Output folder: {output_folder}")

                # Save to database
                print("Saving to database...")
                save_to_database(
                    profile,
                    file_path,
                    file_hash,
                    output_folder_name,
                    output_folder,
                    stem_paths,
                    stem_metadata,
                )

                # Sync to R2 after processing (remote already uploaded, but sync handles conflicts)
                sync_profile_to_r2(config, profile)

                return 0

            except Exception as e:
                print(f"✗ Failed: {e}", file=sys.stderr)
                return 1
        else:
            # Local processing
            print("Processing locally")
            separator = StemSeparator(profile.name, profile.strategy_name)

            try:
                # Run separation (blocking operation)
                # Metadata and waveforms are saved automatically
                stem_paths, stem_metadata = separator.separate_and_normalize(
                    file_path, output_folder
                )

                print()
                print("=" * 60)
                print(f"✓ Success! Created {len(stem_paths)} stems")
                for stem_name, stem_path in stem_paths.items():
                    print(f"  - {stem_name}: {stem_path.name}")
                print(f"Output folder: {output_folder}")

                # Save to database
                print("Saving to database...")
                save_to_database(
                    profile,
                    file_path,
                    file_hash,
                    output_folder_name,
                    output_folder,
                    stem_paths,
                    stem_metadata,
                )

                # Sync to R2 after processing
                sync_profile_to_r2(config, profile)

                return 0

            except Exception as e:
                print(f"✗ Failed: {e}", file=sys.stderr)
                return 1

    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1
