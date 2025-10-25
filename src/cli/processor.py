"""Audio processing logic for CLI."""

from __future__ import annotations

import sys
from pathlib import Path

from ..config import Profile, get_config
from ..utils import compute_file_hash
from ..modern_separator import StemSeparator
from .scanner import AUDIO_EXTENSIONS, derive_output_name, scan_for_new_files
from .remote_processor import process_file_remotely
from .sync import sync_profile_from_r2, sync_profile_to_r2


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
                stem_paths, _stem_metadata = process_file_remotely(
                    config,
                    profile,
                    file_path,
                    output_folder_name,
                    output_folder
                )

                print()
                print("=" * 60)
                print(f"✓ Success! Created {len(stem_paths)} stems")
                for stem_name, stem_path in stem_paths.items():
                    print(f"  - {stem_name}: {stem_path.name}")
                print(f"Output folder: {output_folder}")

                # Sync to R2 after processing (remote already uploaded, but sync handles conflicts)
                sync_profile_to_r2(config, profile)

                return 0

            except Exception as e:
                print(f"✗ Failed: {e}", file=sys.stderr)
                return 1
        else:
            # Local processing
            print("Processing locally")
            separator = StemSeparator(profile)

            try:
                # Run separation (blocking operation)
                # Metadata and waveforms are saved automatically
                stem_paths, _stem_metadata = separator.separate_and_normalize(
                    file_path,
                    output_folder
                )

                print()
                print("=" * 60)
                print(f"✓ Success! Created {len(stem_paths)} stems")
                for stem_name, stem_path in stem_paths.items():
                    print(f"  - {stem_name}: {stem_path.name}")
                print(f"Output folder: {output_folder}")

                # Sync to R2 after processing
                sync_profile_to_r2(config, profile)

                return 0

            except Exception as e:
                print(f"✗ Failed: {e}", file=sys.stderr)
                return 1

    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1


def process_profile(profile: Profile, use_gpu: bool) -> int:
    """Process all files for a given profile.

    Args:
        profile: Profile object to process
        use_local: If True, force local; if False, force GPU; if None, auto-detect

    Returns:
        Exit code (0 for success, 1 for error)
    """
    try:
        config = get_config()

        # Sync from R2 before processing
        sync_profile_from_r2(config, profile)

        print(f"Processing profile: {profile.name}")
        print(f"Source folder: {profile.source_folder}")
        print(f"Output format: {profile.output.format} @ {profile.output.bitrate}kbps")
        print()

        # Scan for new files
        print("Scanning for new files...")
        source_path = profile.get_source_path()
        media_path = profile.get_media_path()
        new_files = scan_for_new_files(source_path, media_path)

        if not new_files:
            print("No new files found.")
            return 0

        print(f"Found {len(new_files)} new file(s):")
        for file_path, output_name in new_files:
            print(f"  - {file_path.name} -> {output_name}")
        print()

        # Process all files sequentially
        processed_count = 0
        failed_count = 0

        if use_gpu:
            print("Using GPU worker for processing (use --local to process locally)")
            print()

            for i, (input_file, output_name) in enumerate(new_files):
                output_folder = media_path / output_name

                print(f"[{i + 1}/{len(new_files)}] Processing: {input_file.name}")
                print(f"  Output folder: {output_folder}")

                try:
                    stem_paths, _stem_metadata = process_file_remotely(
                        config,
                        profile,
                        input_file,
                        output_name,
                        output_folder
                    )

                    processed_count += 1

                    print(f"  ✓ Success! Created {len(stem_paths)} stems")
                    for stem_name, stem_path in stem_paths.items():
                        print(f"    - {stem_name}: {stem_path.name}")
                    print()

                except Exception as e:
                    failed_count += 1
                    print(f"  ✗ Failed: {e}", file=sys.stderr)
                    print()

        else:
            # Local processing
            print("Processing locally")
            print()
            separator = StemSeparator(profile)

            for i, (input_file, output_name) in enumerate(new_files):
                output_folder = media_path / output_name

                print(f"[{i + 1}/{len(new_files)}] Processing: {input_file.name}")
                print(f"  Output folder: {output_folder}")

                try:
                    # Run separation (blocking operation)
                    # Metadata and waveforms are saved automatically
                    stem_paths, _stem_metadata = separator.separate_and_normalize(
                        input_file,
                        output_folder
                    )

                    processed_count += 1

                    print(f"  ✓ Success! Created {len(stem_paths)} stems")
                    for stem_name, stem_path in stem_paths.items():
                        print(f"    - {stem_name}: {stem_path.name}")
                    print()

                except Exception as e:
                    failed_count += 1
                    print(f"  ✗ Failed: {e}", file=sys.stderr)
                    print()

        # Sync to R2 after all processing
        if processed_count > 0:
            sync_profile_to_r2(config, profile)

        # Summary
        print("=" * 60)
        print(f"Processing complete!")
        print(f"  Successful: {processed_count}")
        print(f"  Failed: {failed_count}")
        print(f"  Total: {len(new_files)}")

        return 0 if failed_count == 0 else 1

    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1
