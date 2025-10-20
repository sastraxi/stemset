"""CLI entrypoint for stemset processing."""

from __future__ import annotations

import asyncio
import subprocess
from datetime import datetime
from pathlib import Path
from typing import Annotated

import typer
from dotenv import load_dotenv

from .config import get_config, JobStatus
from .scanner import FileScanner
from .queue import get_queue
from .modern_separator import StemSeparator
from .models.manifest import ProfileInfo, ProfilesManifest, ProfileTracks, TrackInfo

app = typer.Typer(
    name="stemset",
    help="AI-powered audio stem separation tool",
    no_args_is_help=True,
)


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


def generate_manifests() -> int:
    """Generate static manifest files for all profiles.

    Creates:
    - media/profiles.json - Top-level manifest of all profiles
    - media/{profile}/tracks.json - Track list for each profile

    Returns:
        Exit code (0 for success, 1 for error)
    """
    try:
        config = get_config()
        media_root = Path("media")

        if not media_root.exists():
            print("Error: media/ directory not found", file=sys.stderr)
            return 1

        print("Generating static manifests...")
        print()

        profile_infos = []
        generation_time = datetime.now()

        # Process each profile
        for profile in config.profiles:
            profile_dir = media_root / profile.name

            if not profile_dir.exists():
                print(f"Skipping profile '{profile.name}' (no media directory)")
                continue

            print(f"Processing profile: {profile.name}")

            # Find all track directories
            track_infos = []
            for item in profile_dir.iterdir():
                # Skip hidden files and .processed_hashes.json
                if item.name.startswith(".") or not item.is_dir():
                    continue

                track_name = item.name
                print(f"  - {track_name}")

                # Find available stems
                stems = {}
                for stem_name in ["vocals", "drums", "bass", "other"]:
                    # Check for both .opus and .wav formats
                    for ext in [".opus", ".wav"]:
                        stem_path = item / f"{stem_name}{ext}"
                        if stem_path.exists():
                            # Just the filename (peer to metadata.json)
                            stems[stem_name] = f"{stem_name}{ext}"
                            break

                if not stems:
                    print(f"    Warning: No stems found, skipping")
                    continue

                # Get creation timestamp from metadata.json if it exists
                metadata_path = item / "metadata.json"
                created_at = datetime.fromtimestamp(item.stat().st_mtime)

                # Build TrackInfo
                track_info = TrackInfo(
                    name=track_name,
                    stems=stems,
                    metadata_url="metadata.json",  # Peer file
                    created_at=created_at,
                )
                track_infos.append(track_info)

            # Sort tracks by creation time (newest first)
            track_infos.sort(key=lambda t: t.created_at, reverse=True)

            # Create ProfileTracks manifest
            profile_tracks = ProfileTracks(
                profile_name=profile.name,
                tracks=track_infos,
                last_updated=generation_time,
            )

            # Write tracks.json
            tracks_file = profile_dir / "tracks.json"
            profile_tracks.to_file(tracks_file)
            print(f"  ✓ Created {tracks_file}")

            # Add to top-level profile list
            profile_info = ProfileInfo(
                name=profile.name,
                display_name=profile.name.replace("_", " ").replace("-", " ").title(),
                track_count=len(track_infos),
                last_updated=generation_time,
                tracks_url=f"{profile.name}/tracks.json",
            )
            profile_infos.append(profile_info)
            print()

        # Create top-level profiles manifest
        profiles_manifest = ProfilesManifest(
            profiles=profile_infos,
            generated_at=generation_time,
        )

        profiles_file = media_root / "profiles.json"
        profiles_manifest.to_file(profiles_file)
        print(f"✓ Created {profiles_file}")
        print()
        print("=" * 60)
        print(f"Successfully generated manifests for {len(profile_infos)} profile(s)")

        return 0

    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1


@app.command(name="process")
def process_cmd(
    profile: Annotated[str, typer.Argument(help="Profile name from config.yaml")],
    file: Annotated[Path | None, typer.Argument(help="Specific WAV file to process")] = None,
) -> None:
    """Process audio files for stem separation.

    If FILE is provided, processes that specific file.
    Otherwise, scans the profile's source folder for new files and processes them.
    """
    if file:
        # Single file mode
        file_path = file.expanduser().resolve()
        exit_code = asyncio.run(process_single_file(profile, file_path))
    else:
        # Directory scan mode
        exit_code = asyncio.run(process_profile(profile))

    raise typer.Exit(code=exit_code)


@app.command(name="build")
def build_cmd() -> None:
    """Generate static manifest files for all profiles.

    Creates:
    - media/profiles.json - Top-level manifest of all profiles
    - media/{profile}/tracks.json - Track list for each profile

    Run this after processing new tracks to update the static site manifests.
    """
    exit_code = generate_manifests()
    raise typer.Exit(code=exit_code)


@app.command(name="deploy")
def deploy_cmd(
    dry_run: Annotated[bool, typer.Option("--dry-run", help="Show what would be deployed without uploading")] = False,
) -> None:
    """Deploy frontend and media to Cloudflare Pages using Wrangler CLI.

    This command:
    1. Builds the frontend (bun run build)
    2. Copies media/ into frontend/dist/
    3. Deploys frontend/dist/ to Cloudflare Pages

    Requires wrangler to be installed and configured.
    Run 'stemset build' before deploying to ensure manifests are up to date.
    """
    media_dir = Path("media")
    frontend_dir = Path("frontend")
    dist_dir = frontend_dir / "dist"

    # Check prerequisites
    if not media_dir.exists():
        typer.secho("Error: media/ directory not found", fg=typer.colors.RED, err=True)
        raise typer.Exit(code=1)

    if not frontend_dir.exists():
        typer.secho("Error: frontend/ directory not found", fg=typer.colors.RED, err=True)
        raise typer.Exit(code=1)

    # Check if bun is installed
    try:
        result = subprocess.run(
            ["bun", "--version"],
            capture_output=True,
            text=True,
            check=False,
        )
        if result.returncode != 0:
            typer.secho("Error: bun not found. Install from: https://bun.sh", fg=typer.colors.RED, err=True)
            raise typer.Exit(code=1)
    except FileNotFoundError:
        typer.secho("Error: bun not found. Install from: https://bun.sh", fg=typer.colors.RED, err=True)
        raise typer.Exit(code=1)

    # Check if wrangler is installed
    try:
        result = subprocess.run(
            ["wrangler", "--version"],
            capture_output=True,
            text=True,
            check=False,
        )
        if result.returncode != 0:
            typer.secho("Error: wrangler CLI not found. Install with: npm install -g wrangler", fg=typer.colors.RED, err=True)
            raise typer.Exit(code=1)
    except FileNotFoundError:
        typer.secho("Error: wrangler CLI not found. Install with: npm install -g wrangler", fg=typer.colors.RED, err=True)
        raise typer.Exit(code=1)

    if dry_run:
        typer.secho("Dry run mode - would perform the following:", fg=typer.colors.YELLOW)
        typer.echo("  1. Build frontend: bun run build")
        typer.echo(f"  2. Copy media/ → {dist_dir / 'media'}")

        # Count files
        media_file_count = sum(1 for _ in media_dir.rglob("*") if _.is_file())
        typer.echo(f"  3. Deploy {dist_dir} to Cloudflare Pages ({media_file_count} media files)")

        typer.secho("\nRun without --dry-run to deploy", fg=typer.colors.YELLOW)
        raise typer.Exit(code=0)

    # Step 1: Build frontend
    typer.secho("Building frontend...", fg=typer.colors.GREEN)
    result = subprocess.run(
        ["bun", "run", "build"],
        cwd=str(frontend_dir),
        check=False,
    )

    if result.returncode != 0:
        typer.secho("\n✗ Frontend build failed", fg=typer.colors.RED, err=True)
        raise typer.Exit(code=result.returncode)

    typer.secho("✓ Frontend built successfully\n", fg=typer.colors.GREEN)

    # Step 2: Copy media into dist
    import shutil

    typer.secho("Copying media files to dist...", fg=typer.colors.GREEN)
    dist_media = dist_dir / "media"

    # Remove existing media if present
    if dist_media.exists():
        shutil.rmtree(dist_media)

    # Copy media directory
    shutil.copytree(media_dir, dist_media)

    media_file_count = sum(1 for _ in dist_media.rglob("*") if _.is_file())
    typer.secho(f"✓ Copied {media_file_count} media files\n", fg=typer.colors.GREEN)

    # Step 3: Deploy to Cloudflare Pages
    typer.secho("Deploying to Cloudflare Pages...", fg=typer.colors.GREEN)
    typer.echo(f"Directory: {dist_dir.absolute()}")
    typer.echo()

    # Run wrangler pages deploy
    # User will need authentication via wrangler login or CLOUDFLARE_API_TOKEN
    result = subprocess.run(
        ["wrangler", "pages", "deploy", str(dist_dir)],
        check=False,
    )

    if result.returncode == 0:
        typer.secho("\n✓ Deployment successful!", fg=typer.colors.GREEN)
    else:
        typer.secho("\n✗ Deployment failed", fg=typer.colors.RED, err=True)

    raise typer.Exit(code=result.returncode)


def main() -> None:
    """Main CLI entrypoint."""
    # Load .env file if it exists (doesn't override existing env vars)
    load_dotenv()
    app()


if __name__ == "__main__":
    main()
