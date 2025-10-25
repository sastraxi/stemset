"""Modal serverless GPU worker for audio stem separation."""

from __future__ import annotations

import tempfile
import httpx
import os
from pathlib import Path
from typing import Any
from dotenv import load_dotenv

import modal

# Load .env file for build-time configuration
_ = load_dotenv()

# Define modal app with R2 secrets
app = modal.App("stemset-gpu")

# Container image with all processing dependencies
# R2 configuration for runtime (Modal worker only needs R2, not OAuth/JWT)
# Our CI/CD runner (i.e. Github) is the source-of-truth for these env vars and secrets
required_env_vars = {
    "R2_ACCOUNT_ID": os.environ.get("R2_ACCOUNT_ID", ""),
    "R2_ACCESS_KEY_ID": os.environ.get("R2_ACCESS_KEY_ID", ""),
    "R2_SECRET_ACCESS_KEY": os.environ.get("R2_SECRET_ACCESS_KEY", ""),
    "R2_BUCKET_NAME": os.environ.get("R2_BUCKET_NAME", "stemset-media"),
    "R2_PUBLIC_URL": os.environ.get("R2_PUBLIC_URL", ""),
    "BACKEND_URL": os.environ.get("BACKEND_URL_PRODUCTION", ""),
}

missing_vars = [k for k, v in required_env_vars.items() if not v]
if missing_vars:
    raise RuntimeError(f"Missing required environment variables for Modal worker: {missing_vars}")

# These variables are not used by the worker but are required to load the config
dummy_required_vars = {
    "GOOGLE_CLIENT_ID": "dummy",
    "GOOGLE_CLIENT_SECRET": "dummy",
    "JWT_SECRET": "dummy",
    "OAUTH_REDIRECT_URI": "dummy",
    "GPU_WORKER_URL": "dummy",
}

image = (
    modal.Image.debian_slim(python_version="3.13")
    .apt_install("libsndfile1", "libopus0", "ffmpeg")
    # preload known models
    .env({"STEMSET_MODEL_CACHE_DIR": "/root/.models"})
    .uv_sync(groups=["preload_models", "processing"], frozen=True)
    .add_local_file("scripts/preload_models.py", "/root/preload_models.py", copy=True)
    .run_commands("uv run python /root/preload_models.py")
    # uv sync phase
    .add_local_file("uv.lock", "/root/uv.lock", copy=True)
    .add_local_file("pyproject.toml", "/root/pyproject.toml", copy=True)
    .uv_sync(groups=["shared", "processing", "modal"], frozen=True)
    # app (added last to optimize build caching)
    .env(required_env_vars)
    .env(dummy_required_vars)
    .add_local_dir("src", "/root/src", ignore=modal.FilePatternMatcher("**/__pycache__/**"))
    .add_local_file("config.yaml", "/root/config.yaml")
)

# Mount R2 bucket for direct file access
# CloudBucketMount reads AWS credentials from Modal secrets at runtime
r2_account_id = os.environ.get("R2_ACCOUNT_ID", "")
r2_bucket_name = os.environ.get("R2_BUCKET_NAME", "stemset-media")
r2_mount = modal.CloudBucketMount(
    bucket_name=r2_bucket_name,
    bucket_endpoint_url=f"https://{r2_account_id}.r2.cloudflarestorage.com",
    secret=modal.Secret.from_name("r2-secret"),  # pyright: ignore[reportUnknownMemberType]
)


@app.function(  # pyright: ignore[reportUnknownMemberType]
    image=image,
    gpu="A100-40GB",
    timeout=180,
    volumes={"/r2": r2_mount},
)
@modal.fastapi_endpoint(method="POST")  # pyright: ignore[reportUnknownMemberType]
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
    from botocore.client import ClientError

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
            stem_paths, _metadata = separator.separate_and_normalize(input_path, output_dir)

            # Check if output already exists in R2 and compare sizes
            # Get size of first generated stem for comparison
            first_stem_path = next(iter(stem_paths.values()))
            new_stem_size = first_stem_path.stat().st_size

            try:
                # Try to get existing stem from R2
                stem_ext = f".{job.output_config.format.value}"
                first_stem_name = next(iter(stem_paths.keys()))
                existing_key = f"{job.profile_name}/{job.output_name}/{first_stem_name}{stem_ext}"

                head_response = storage.s3_client.head_object(
                    Bucket=storage.config.bucket_name, Key=existing_key
                )

                existing_size = head_response.get("ContentLength", 0)

                # Compare sizes - allow overwrite if within 10x
                if existing_size > 0:
                    size_ratio = max(new_stem_size, existing_size) / min(
                        new_stem_size, existing_size
                    )
                    if size_ratio > 10:
                        raise ValueError(
                            f"Output size mismatch: new={new_stem_size} bytes, "
                            + f"existing={existing_size} bytes (ratio: {size_ratio:.1f}x). "
                            + "Refusing to overwrite - something may be wrong."
                        )
                    else:
                        print(f"Overwriting existing output (size ratio: {size_ratio:.1f}x)")

            except ClientError as e:
                if e.response["Error"]["Code"] == "404":
                    # No existing output, proceed normally
                    print(f"No existing output found")
                else:
                    # Some other S3 error
                    raise

            # Upload all outputs to R2
            print(f"Uploading {len(stem_paths)} stems to R2")
            for stem_name, stem_path in stem_paths.items():
                storage.upload_file(stem_path, job.profile_name, job.output_name, stem_path.name)

                # Upload waveform if it exists
                waveform_path = stem_path.parent / f"{stem_name}_waveform.png"
                if waveform_path.exists():
                    storage.upload_file(
                        waveform_path,
                        job.profile_name,
                        job.output_name,
                        waveform_path.name,
                    )

            # Upload metadata.json with source file hash
            metadata_path = output_dir / "metadata.json"
            if metadata_path.exists():
                storage.upload_file(
                    metadata_path,
                    job.profile_name,
                    job.output_name,
                    "metadata.json",
                    extra_metadata={"source-sha256": file_hash},
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
