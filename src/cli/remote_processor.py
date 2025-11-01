"""Remote GPU processing for CLI."""

from __future__ import annotations

import secrets
import uuid
import httpx
from pathlib import Path

from src.db.models import Profile
from src.models.metadata import StemMetadata, StemsMetadata

from ..config import Config
from ..storage import get_storage, R2Storage
from ..gpu_worker.models import ProcessingJob, ProcessingResult
from ..utils import compute_file_hash


def process_file_remotely(
    config: Config,
    profile: Profile,
    input_file: Path,
    output_folder_name: str,
    output_folder: Path,
) -> tuple[dict[str, Path], dict[str, StemMetadata]]:
    """Process a file using remote GPU worker.

    Args:
        config: Global configuration
        profile: Processing profile
        input_file: Path to input audio file
        output_folder_name: Name for the output folder (e.g., song_abc12345)
        output_folder: Local path where results will be downloaded

    Returns:
        Tuple of (stem_paths, stem_metadata) similar to local processing

    Raises:
        ValueError: If GPU worker URL not configured or R2 not configured
        RuntimeError: If processing fails
    """
    if config.gpu_worker_url is None:
        raise ValueError(
            "Remote processing requires gpu_worker_url in config.yaml. "
            + "Add: gpu_worker_url: ${GPU_WORKER_URL}"
        )

    if config.r2 is None:
        raise ValueError("Remote processing requires R2 storage configured in config.yaml")

    # Get storage (must be R2 for remote processing)
    storage = get_storage(config)

    if not isinstance(storage, R2Storage):
        raise ValueError("Remote processing requires R2 storage")

    # Check if input file already exists in R2 with same content
    input_filename = input_file.name
    input_key = f"inputs/{profile.name}/{input_filename}"

    should_upload = True
    try:
        # Check if file exists and compare SHA256 hash from metadata
        head_response = storage.s3_client.head_object(
            Bucket=storage.config.bucket_name,
            Key=input_key,
        )

        # Get SHA256 from metadata
        metadata = head_response.get("Metadata", {})
        r2_sha256 = metadata.get("sha256")

        if r2_sha256:
            # Compute local file SHA256
            local_sha256 = compute_file_hash(input_file)

            if r2_sha256 == local_sha256:
                print("  Input already in R2 (identical) ✓")
                should_upload = False
            else:
                print("  Input exists but differs, re-uploading...", end="", flush=True)
        else:
            # Old upload without SHA256 metadata, re-upload to add metadata
            print("  Input exists (no hash metadata), re-uploading...", end="", flush=True)
    except storage.s3_client.exceptions.NoSuchKey:
        # File doesn't exist, need to upload
        print("  Uploading input to R2...", end="", flush=True)

    if should_upload:
        _ = storage.upload_input_file(
            input_file,
            profile.name,
            input_filename,
        )
        print(" ✓")

    # Create job payload
    job_id = str(uuid.uuid4())
    verification_token = secrets.token_urlsafe(32)
    job = ProcessingJob(
        job_id=job_id,
        profile_name=profile.name,
        strategy_name=profile.strategy_name,
        input_key=input_key,
        output_name=output_folder_name,
        output_config=profile.output,
        callback_url=None,  # CLI doesn't need callback, we'll poll
        verification_token=verification_token,
    )

    # Trigger GPU worker
    print("  Triggering GPU worker...", end="", flush=True)
    gpu_worker_url = config.gpu_worker_url.rstrip("/")

    with httpx.Client(timeout=300.0, follow_redirects=True) as client:
        # POST to root endpoint (Modal fastapi_endpoint uses function at root)
        response = client.post(
            gpu_worker_url,
            json=job.model_dump(),
        )
        _ = response.raise_for_status()
        result_data = response.json()  # pyright: ignore[reportAny]

    result = ProcessingResult.model_validate(result_data)
    print(" ✓")

    # Check result
    if result.status == "error":
        raise RuntimeError(f"GPU processing failed: {result.error}")

    if result.stems is None:
        raise RuntimeError("GPU processing returned no stems")

    print(f"  GPU processing complete! Created {len(result.stems)} stems")

    # Download results from R2 to local media folder
    print("  Downloading results to local media...", end="", flush=True)
    output_folder.mkdir(parents=True, exist_ok=True)

    stem_paths: dict[str, Path] = {}

    # Download each stem
    for stem_name in result.stems:
        # Determine file extension
        stem_ext = f".{profile.output.format.value}"
        stem_filename = f"{stem_name}{stem_ext}"

        # Download stem file
        dest_path = output_folder / stem_filename
        storage.s3_client.download_file(
            storage.config.bucket_name,
            f"{profile.name}/{output_folder_name}/{stem_filename}",
            str(dest_path),
        )
        stem_paths[stem_name] = dest_path

        # Download waveform
        waveform_filename = f"{stem_name}_waveform.png"
        waveform_path = output_folder / waveform_filename
        try:
            storage.s3_client.download_file(
                storage.config.bucket_name,
                f"{profile.name}/{output_folder_name}/{waveform_filename}",
                str(waveform_path),
            )
        except Exception:
            pass  # Waveform is optional

    # Download metadata.json
    metadata_path = output_folder / "metadata.json"
    try:
        storage.s3_client.download_file(
            storage.config.bucket_name,
            f"{profile.name}/{output_folder_name}/metadata.json",
            str(metadata_path),
        )
    except Exception:
        pass  # Metadata is optional

    print(" ✓")

    if not metadata_path.exists():
        raise RuntimeError("No metadata.json found in processing results")

    stems_metadata_obj = StemsMetadata.from_file(metadata_path)
    return stem_paths, stems_metadata_obj.stems
