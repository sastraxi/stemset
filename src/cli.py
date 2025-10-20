"""CLI entrypoint for stemset processing."""

from __future__ import annotations

import argparse
import asyncio
import sys
from datetime import datetime
from pathlib import Path
from typing import cast

from .config import get_config, JobStatus
from .scanner import FileScanner
from .queue import get_queue
from .modern_separator import StemSeparator


async def process_single_file(profile_name: str, file_path: Path) -> int:
    """Process a single file using a profile, ignoring hash tracking.

    Args:
        profile_name: Name of the profile to use
        file_path: Path to the audio file to process

    Returns:
        Exit code (0 for success, 1 for error)
    """
    try:
        # Load config and get profile
        config = get_config()
        profile = config.get_profile(profile_name)
        if not profile:
            print(f"Error: Profile '{profile_name}' not found in config.yaml", file=sys.stderr)
            print(f"Available profiles: {', '.join(p.name for p in config.profiles)}", file=sys.stderr)
            return 1

        # Validate file exists and is an audio file
        if not file_path.exists():
            print(f"Error: File not found: {file_path}", file=sys.stderr)
            return 1

        if file_path.suffix.lower() not in {".wav", ".wave"}:
            print(f"Error: File must be a WAV file, got: {file_path.suffix}", file=sys.stderr)
            return 1

        print(f"Processing file with profile: {profile.name}")
        print(f"Input file: {file_path}")
        print(f"Output format: {profile.output.format} @ {profile.output.bitrate}kbps")
        print()

        # Derive output name from filename
        scanner = FileScanner(profile)
        output_name = scanner._derive_output_name(file_path)

        # Compute hash for output folder naming
        file_hash = scanner._compute_file_hash(file_path)
        output_folder_name = f"{output_name}_{file_hash[:8]}"

        media_dir = Path("media") / profile.name
        output_folder = media_dir / output_folder_name

        print(f"Output folder: {output_folder}")
        print()

        # Run separation
        separator = StemSeparator(profile)

        try:
            # Run separation in thread pool (blocking operation)
            # Metadata and waveforms are saved automatically
            loop = asyncio.get_event_loop()
            stem_paths, _stem_metadata = await loop.run_in_executor(
                None,
                separator.separate_and_normalize,
                file_path,
                output_folder
            )

            print()
            print("=" * 60)
            print(f"✓ Success! Created {len(stem_paths)} stems")
            for stem_name, stem_path in stem_paths.items():
                print(f"  - {stem_name}: {stem_path.name}")
            print(f"Output folder: {output_folder}")

            return 0

        except Exception as e:
            print(f"✗ Failed: {e}", file=sys.stderr)
            return 1

    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1


async def process_profile(profile_name: str) -> int:
    """Process all files for a given profile.

    Args:
        profile_name: Name of the profile to process

    Returns:
        Exit code (0 for success, 1 for error)
    """
    try:
        # Load config and get profile
        config = get_config()
        profile = config.get_profile(profile_name)
        if not profile:
            print(f"Error: Profile '{profile_name}' not found in config.yaml", file=sys.stderr)
            print(f"Available profiles: {', '.join(p.name for p in config.profiles)}", file=sys.stderr)
            return 1

        print(f"Processing profile: {profile.name}")
        print(f"Source folder: {profile.source_folder}")
        print(f"Output format: {profile.output.format} @ {profile.output.bitrate}kbps")
        print()

        # Initialize scanner and queue
        scanner = FileScanner(profile)
        queue = get_queue()

        # Scan for new files
        print("Scanning for new files...")
        new_files = scanner.scan_for_new_files()

        if not new_files:
            print("No new files found.")
            return 0

        print(f"Found {len(new_files)} new file(s):")
        for file_path, output_name in new_files:
            print(f"  - {file_path.name} -> {output_name}")
        print()

        # Queue all files
        media_dir = Path("media") / profile.name
        for file_path, output_name in new_files:
            output_folder = media_dir / output_name
            _ = queue.add_job(
                profile_name=profile.name,
                input_file=file_path,
                output_folder=output_folder,
            )

        print(f"Queued {len(new_files)} job(s) for processing")
        print()

        # Process all jobs sequentially by pulling from the queue
        separator = StemSeparator(profile)
        processed_count = 0
        failed_count = 0

        # Process jobs one by one
        for i in range(len(new_files)):
            try:
                # Get next job from internal queue (with timeout)
                job = await asyncio.wait_for(queue.queue.get(), timeout=1.0)
            except asyncio.TimeoutError:
                print(f"Warning: Expected {len(new_files)} jobs but queue is empty", file=sys.stderr)
                break

            print(f"[{i + 1}/{len(new_files)}] Processing: {job.input_file.name}")
            print(f"  Output folder: {job.output_folder}")

            # Update status
            job.status = JobStatus.PROCESSING
            job.started_at = datetime.now()

            try:
                # Run separation in thread pool (blocking operation)
                # Metadata and waveforms are saved automatically
                loop = asyncio.get_event_loop()
                stem_paths, _stem_metadata = await loop.run_in_executor(
                    None,
                    separator.separate_and_normalize,
                    job.input_file,
                    job.output_folder
                )

                # Mark as completed
                job.status = JobStatus.COMPLETED
                job.completed_at = datetime.now()
                job.output_files = {name: str(path) for name, path in stem_paths.items()}
                processed_count += 1

                print(f"  ✓ Success! Created {len(stem_paths)} stems")
                for stem_name, stem_path in stem_paths.items():
                    print(f"    - {stem_name}: {stem_path.name}")
                print()

            except Exception as e:
                # Mark as failed
                job.status = JobStatus.FAILED
                job.completed_at = datetime.now()
                job.error = str(e)
                failed_count += 1

                print(f"  ✗ Failed: {e}", file=sys.stderr)
                print()

            finally:
                # Mark task as done
                queue.queue.task_done()

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


def main() -> None:
    """Main CLI entrypoint."""
    parser = argparse.ArgumentParser(
        description="Process audio files for stem separation",
        prog="stemset"
    )
    _ = parser.add_argument(
        "profile",
        help="Profile name to process (from config.yaml)"
    )
    _ = parser.add_argument(
        "file",
        nargs="?",
        help="Optional: specific WAV file to process (ignores hash tracking, always processes)"
    )

    args = parser.parse_args()

    profile_name = cast(str, args.profile)
    file_arg = cast(str | None, args.file)

    # Determine which mode to use
    if file_arg:
        # Single file mode
        file_path = Path(file_arg).expanduser().resolve()
        exit_code = asyncio.run(process_single_file(profile_name, file_path))
    else:
        # Directory scan mode
        exit_code = asyncio.run(process_profile(profile_name))

    sys.exit(exit_code)


if __name__ == "__main__":
    main()
