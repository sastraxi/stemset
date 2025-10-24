"""Modal serverless GPU worker for audio stem separation."""

from __future__ import annotations

import tempfile
import httpx
import os
from pathlib import Path
from typing import Any, cast

import modal

# Create Modal app
app = modal.App("stemset-gpu")

# R2 credentials secret (create via: modal secret create r2-secret)
r2_secret = modal.Secret.from_name("r2-secret")  # pyright: ignore[reportUnknownMemberType]


# Parse dependencies from pyproject.toml
def get_processing_dependencies() -> list[str]:
    """Extract processing dependencies from pyproject.toml.

    Returns list of dependencies from [dependency-groups.shared]
    and [dependency-groups.processing].
    """
    import tomllib
    from pathlib import Path

    pyproject_path = Path(__file__).parent.parent.parent / "pyproject.toml"
    with open(pyproject_path, "rb") as f:
        pyproject = tomllib.load(f)

    shared_deps = cast(list[str], pyproject["dependency-groups"]["shared"])
    processing_deps = cast(list[str], pyproject["dependency-groups"]["processing"])
    return shared_deps + processing_deps


# Container image with all processing dependencies
image = (
    modal.Image.debian_slim(python_version="3.13")
    .pip_install(*get_processing_dependencies())
    .apt_install("libsndfile1", "libopus0", "ffmpeg")
    .add_local_dir("src", "/root/src")
    .add_local_file("config.yaml", "/root/config.yaml")
)

# Mount R2 bucket for direct file access
# R2_ACCOUNT_ID and R2_BUCKET_NAME are read from the r2-secret at runtime
# Create the secret with: ./scripts/setup_modal_secret.sh
r2_account_id = os.environ.get("R2_ACCOUNT_ID", "")
r2_bucket_name = os.environ.get("R2_BUCKET_NAME", "stemset-media")

r2_mount = modal.CloudBucketMount(
    bucket_name=r2_bucket_name,
    bucket_endpoint_url=f"https://{r2_account_id}.r2.cloudflarestorage.com",
    secret=r2_secret,
)


@app.function(  # pyright: ignore[reportUnknownMemberType]
    image=image,
    gpu="A100-40GB",
    timeout=600,
    volumes={"/r2": r2_mount},
    secrets=[r2_secret],
)
@modal.web_endpoint(method="POST")  # pyright: ignore[reportUnknownMemberType]
def process(job_data: dict[str, Any]) -> dict[str, Any]:  # pyright: ignore[reportExplicitAny]
    """Process audio file using GPU and return results.

    This endpoint accepts a POST request with ProcessingJob JSON payload.
    Files are read from and written to the mounted R2 bucket.

    Args:
        job_data: ProcessingJob dict with input_key, strategy, output config, etc.

    Returns:
        ProcessingResult dict with status, stems list, or error message
    """
    import sys

    sys.path.insert(0, "/root")

    from src.gpu_worker.models import ProcessingJob, ProcessingResult
    from src.config import Profile, get_config
    from src.storage import R2Storage
    from src.modern_separator import StemSeparator
    from src.utils import compute_file_hash

    # Parse job data
    job = ProcessingJob.model_validate(job_data)

    try:
        # Load config
        config = get_config()

        # Create R2 storage client
        if config.r2 is None:
            raise ValueError("R2 configuration required for Modal worker")

        storage = R2Storage(config.r2)

        # Create temporary working directory
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)

            # Download input file from R2
            input_filename = Path(job.input_key).name
            input_path = temp_path / input_filename
            print(f"Downloading input: {job.input_key}")
            storage.download_input_file(job.profile_name, input_filename, input_path)

            # Compute hash to check for duplicates
            file_hash = compute_file_hash(input_path)
            print(f"File hash: {file_hash[:8]}...")

            # Check if output already exists in R2
            try:
                existing_metadata_key = f"{job.profile_name}/{job.output_name}/metadata.json"
                storage.s3_client.head_object(  # pyright: ignore[reportUnknownMemberType]
                    Bucket=storage.config.bucket_name, Key=existing_metadata_key
                )
                # If we got here, the output already exists
                raise ValueError(
                    f"Output '{job.output_name}' already exists. " +
                    f"This file has already been processed (hash: {file_hash[:8]})"
                )
            except storage.s3_client.exceptions.NoSuchKey:  # pyright: ignore[reportUnknownMemberType]
                # Good - output doesn't exist yet, we can proceed
                pass

            # Get strategy from config
            strategy = config.get_strategy(job.strategy_name)
            if strategy is None:
                raise ValueError(f"Strategy '{job.strategy_name}' not found")

            # Create temporary profile for processing
            temp_profile = Profile(
                name=job.profile_name,
                source_folder="/tmp/unused",  # Not used during processing
                strategy=job.strategy_name,
                output=job.output_config,
            )

            # Process the audio
            print(f"Processing with strategy: {job.strategy_name}")
            separator = StemSeparator(temp_profile)

            # Create temp output directory
            output_dir = temp_path / "output"
            output_dir.mkdir()

            # Run separation (this creates stems, metadata.json, and waveforms)
            stem_paths, _metadata = separator.separate_and_normalize(
                input_path, output_dir
            )

            # Upload all outputs to R2
            print(f"Uploading {len(stem_paths)} stems to R2")
            for stem_name, stem_path in stem_paths.items():
                storage.upload_file(
                    stem_path, job.profile_name, job.output_name, stem_path.name
                )

                # Upload waveform if it exists
                waveform_path = stem_path.parent / f"{stem_name}_waveform.png"
                if waveform_path.exists():
                    storage.upload_file(
                        waveform_path,
                        job.profile_name,
                        job.output_name,
                        waveform_path.name,
                    )

            # Upload metadata.json
            metadata_path = output_dir / "metadata.json"
            if metadata_path.exists():
                storage.upload_file(
                    metadata_path, job.profile_name, job.output_name, "metadata.json"
                )

            result = ProcessingResult(
                job_id=job.job_id, status="complete", stems=list(stem_paths.keys())
            )

            # Call back to API if callback URL provided
            if job.callback_url:
                print(f"Calling back to: {job.callback_url}")
                with httpx.Client() as client:
                    _ = client.post(job.callback_url, json=result.model_dump())

            return result.model_dump()

    except Exception as e:
        error_msg = str(e)
        print(f"Error processing job {job.job_id}: {error_msg}")

        result = ProcessingResult(job_id=job.job_id, status="error", error=error_msg)

        # Try to call back with error
        if job.callback_url:
            try:
                with httpx.Client() as client:
                    _ = client.post(job.callback_url, json=result.model_dump())
            except Exception:
                pass  # Best effort callback

        return result.model_dump()
