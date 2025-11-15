"""Modal serverless GPU worker for audio stem separation."""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

import modal
from dotenv import load_dotenv

from src.processor.models import WorkerAcceptedResponse, WorkerJobPayload

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
    "BACKEND_URL": os.environ.get("BACKEND_URL", ""),
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
    timeout=240,
    volumes={"/r2": r2_mount},
)
async def _process_internal(payload: WorkerJobPayload) -> WorkerAcceptedResponse:
    """Internal function that performs actual processing (spawned asynchronously).

    Workflow:
    1. Download input from R2
    2. Run separation with StemSeparator
    3. Upload stems and waveforms to R2
    4. Call back to API with pointers to metadata

    Args:
        payload: Worker job payload

    Returns:
        Worker accepted response
    """
    import sys

    sys.path.insert(0, "/root")

    from src.config import OutputConfig, get_config
    from src.processor.callbacks import (
        prepare_error_payload,
        prepare_success_payload,
        send_callback_with_error_handling_sync,
    )
    from src.processor.core import (
        convert_stems_to_final_format,
        detect_clips,
        separate_to_wav,
    )
    from src.storage import R2Storage
    from src.utils import compute_file_hash

    # Extract payload fields
    recording_id = payload.recording_id
    profile_name = payload.profile_name
    strategy_name = payload.strategy_name
    input_filename = payload.input_filename
    output_name = payload.output_name
    callback_url = payload.callback_url
    output_config_dict = payload.output_config_dict

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
            input_path = temp_path / input_filename
            print(f"Downloading input from R2: inputs/{profile_name}/{input_filename}")
            storage.s3_client.download_file(
                storage.config.bucket_name,
                f"inputs/{profile_name}/{input_filename}",
                str(input_path),
            )

            # Compute hash for logging
            file_hash = compute_file_hash(input_path)
            print(f"File hash: {file_hash[:8]}...")

            # Create temp output directory
            output_dir = temp_path / "output"

            # Step 1: Run separation to lossless WAV format
            print(f"Processing with strategy: {strategy_name}")
            stems_metadata = await separate_to_wav(
                input_path=input_path,
                output_dir=output_dir,
                profile_name=profile_name,
                strategy_name=strategy_name,
            )

            # Step 2: Detect clip boundaries from separated WAV stems
            clip_boundaries = detect_clips(stems_metadata, output_dir)

            # Step 3: Convert to final output format (e.g., M4A)
            output_config = OutputConfig(**output_config_dict)  # pyright: ignore[reportAny]
            final_stems_metadata = convert_stems_to_final_format(
                stems_metadata,
                output_dir,
                output_config,
                delete_intermediate_wavs=True,
            )

            # Step 4: Upload final stems and waveforms to R2
            r2_prefix = f"{profile_name}/{output_name}"
            print(f"Uploading {len(final_stems_metadata.stems)} stems to R2: {r2_prefix}/")

            for stem_meta in final_stems_metadata.stems.values():
                # Upload audio file
                audio_path = output_dir / stem_meta.stem_url
                r2_audio_key = f"{r2_prefix}/{stem_meta.stem_url}"
                storage.s3_client.upload_file(
                    str(audio_path),
                    storage.config.bucket_name,
                    r2_audio_key,
                )

                # Upload waveform
                waveform_path = output_dir / stem_meta.waveform_url
                r2_waveform_key = f"{r2_prefix}/{stem_meta.waveform_url}"
                storage.s3_client.upload_file(
                    str(waveform_path),
                    storage.config.bucket_name,
                    r2_waveform_key,
                )

            # Step 5: Prepare and send callback
            print(f"Calling back to: {callback_url}")
            callback_payload = prepare_success_payload(
                final_stems_metadata, output_dir, clip_boundaries
            )
            send_callback_with_error_handling_sync(callback_url, callback_payload)

            return WorkerAcceptedResponse(status="accepted", recording_id=recording_id)

    except Exception as e:
        error_msg = str(e)
        print(f"Error processing recording {recording_id}: {error_msg}")

        # Try to call back with error
        callback_payload = prepare_error_payload(error_msg)
        send_callback_with_error_handling_sync(callback_url, callback_payload)

        return WorkerAcceptedResponse(status="error", recording_id=recording_id)


@app.function(image=image)  # pyright: ignore[reportUnknownMemberType]
@modal.fastapi_endpoint(method="POST")  # pyright: ignore[reportUnknownMemberType]
def process(payload: WorkerJobPayload) -> WorkerAcceptedResponse:
    """FastAPI endpoint that spawns processing job and returns immediately.

    Args:
        payload: Worker job payload

    Returns:
        WorkerAcceptedResponse
    """
    # Spawn the processing job asynchronously (returns immediately)
    _ = _process_internal.spawn(payload)

    print(f"Spawned processing job for recording {payload.recording_id}")

    return WorkerAcceptedResponse(status="accepted", recording_id=payload.recording_id)
