"""Remote GPU processing for CLI."""

from __future__ import annotations

import time
import uuid
import httpx
from pathlib import Path

from ..config import Config, Profile
from ..storage import get_storage
from ..gpu_worker.models import ProcessingJob, ProcessingResult


def process_file_remotely(
    config: Config,
    profile: Profile,
    input_file: Path,
    output_folder_name: str,
    output_folder: Path,
) -> tuple[dict[str, Path], dict[str, dict[str, str | float]]]:
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
            "Add: gpu_worker_url: ${GPU_WORKER_URL}"
        )

    if config.r2 is None:
        raise ValueError(
            "Remote processing requires R2 storage configured in config.yaml"
        )

    # Get storage (must be R2 for remote processing)
    storage = get_storage(config)

    # Upload input file to R2
    print(f"  Uploading input to R2...", end="", flush=True)
    input_filename = input_file.name
    storage.upload_input_file(input_file, profile.name, input_filename)
    input_key = f"inputs/{profile.name}/{input_filename}"
    print(" ✓")

    # Create job payload
    job_id = str(uuid.uuid4())
    job = ProcessingJob(
        job_id=job_id,
        profile_name=profile.name,
        strategy_name=profile.strategy,
        input_key=input_key,
        output_name=output_folder_name,
        output_config=profile.output,
        callback_url=None,  # CLI doesn't need callback, we'll poll
    )

    # Trigger GPU worker
    print(f"  Triggering GPU worker...", end="", flush=True)
    gpu_worker_url = config.gpu_worker_url.rstrip("/")

    with httpx.Client(timeout=300.0) as client:
        # POST to /process endpoint
        response = client.post(
            f"{gpu_worker_url}/process",
            json=job.model_dump(),
        )
        response.raise_for_status()
        result_data = response.json()

    result = ProcessingResult.model_validate(result_data)
    print(" ✓")

    # Check result
    if result.status == "error":
        raise RuntimeError(f"GPU processing failed: {result.error}")

    if result.stems is None:
        raise RuntimeError("GPU processing returned no stems")

    print(f"  GPU processing complete! Created {len(result.stems)} stems")

    # Download results from R2 to local media folder
    print(f"  Downloading results to local media...", end="", flush=True)
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

    # Load metadata from downloaded file
    from ..models.metadata import StemsMetadata

    if metadata_path.exists():
        stems_metadata_obj = StemsMetadata.from_file(metadata_path)
        # Convert to dict format expected by caller
        stem_metadata = {
            stem_name: {
                "stem_type": meta.stem_type,
                "measured_lufs": meta.measured_lufs,
            }
            for stem_name, meta in stems_metadata_obj.stems.items()
        }
    else:
        # No metadata available
        stem_metadata = {stem_name: {} for stem_name in result.stems}

    return stem_paths, stem_metadata
