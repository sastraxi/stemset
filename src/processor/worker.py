"""Modal serverless GPU worker for audio stem separation."""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

import httpx
import modal
from dotenv import load_dotenv

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
async def _process_internal(job_data: dict[str, str]) -> dict[str, str]:
    """Internal function that performs actual processing (spawned asynchronously).

    Workflow:
    1. Download input from R2
    2. Run separation with StemSeparator
    3. Upload stems and waveforms to R2
    4. Call back to API with pointers to metadata

    Args:
        job_data: Worker job payload dict (WorkerJobPayload.model_dump())

    Returns:
        Status dict
    """
    import sys

    sys.path.insert(0, "/root")

    from src.config import OutputConfig, get_config
    from src.processor.core import separate_to_wav
    from src.processor.models import (
        ProcessingCallbackPayload,
        StemData,
        StemDataModel,
        WorkerJobPayload,
    )
    from src.storage import R2Storage
    from src.utils import compute_file_hash

    # Parse and validate job data with Pydantic
    payload = WorkerJobPayload(**job_data)
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
            print("Detecting clip boundaries...")
            from src.processor.clip_detection import detect_clip_boundaries

            stems_dict = {
                stem_name: output_dir / stem_meta.stem_url
                for stem_name, stem_meta in stems_metadata.stems.items()
            }
            clip_boundaries = detect_clip_boundaries(stems_dict)
            print(f"Detected {len(clip_boundaries)} clip(s)")

            # Step 3: Convert to final output format (e.g., M4A)
            output_config = OutputConfig(**output_config_dict)
            if output_config.format.value.lower() != "wav":
                print(f"Converting stems to {output_config.format.value} format...")
                for stem_name, stem_meta in stems_metadata.stems.items():
                    source_path = output_dir / stem_meta.stem_url
                    dest_path = source_path.with_suffix(
                        f".{output_config.format.value.lower()}"
                    )

                    _ = output_config.convert(source_path, dest_path)

                    # Update metadata to point to new file
                    stem_meta.stem_url = dest_path.name
                    source_path.unlink(missing_ok=True)  # Delete intermediate WAV

                print("  ✓ Format conversion complete.")

            # Step 4: Upload final stems and waveforms to R2
            r2_prefix = f"{profile_name}/{output_name}"
            print(f"Uploading {len(stems_metadata.stems)} stems to R2: {r2_prefix}/")

            for stem_meta in stems_metadata.stems.values():
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

            # Step 5: Prepare final data for callback
            stem_data_list: list[StemData] = []
            duration = 0.0
            for stem_name, stem_meta in stems_metadata.stems.items():
                audio_path = output_dir / stem_meta.stem_url
                file_size_bytes = audio_path.stat().st_size
                duration = stem_meta.duration  # All stems have same duration

                stem_data_list.append(
                    StemData(
                        stem_type=stem_name,
                        measured_lufs=stem_meta.measured_lufs,
                        peak_amplitude=stem_meta.peak_amplitude,
                        stem_gain_adjustment_db=stem_meta.stem_gain_adjustment_db,
                        audio_url=stem_meta.stem_url,
                        waveform_url=stem_meta.waveform_url,
                        file_size_bytes=file_size_bytes,
                        duration_seconds=duration,
                    )
                )

            callback_payload = ProcessingCallbackPayload(
                status="complete",
                stems=[StemDataModel(**stem) for stem in stem_data_list],
                clip_boundaries=clip_boundaries,
            )

            print(f"Calling back to: {callback_url}")
            with httpx.Client(timeout=30.0) as client:
                response = client.post(callback_url, json=callback_payload.model_dump())
                _ = response.raise_for_status()

            return {"status": "ok", "recording_id": recording_id}

    except Exception as e:
        error_msg = str(e)
        print(f"Error processing recording {recording_id}: {error_msg}")

        # Try to call back with error
        try:
            callback_payload = ProcessingCallbackPayload(
                status="error",
                error=error_msg,
            )
            with httpx.Client(timeout=30.0) as client:
                response = client.post(callback_url, json=callback_payload.model_dump())
                _ = response.raise_for_status()
        except Exception as callback_error:
            print(f"Failed to send error callback: {callback_error}")

        return {"status": "error", "error": error_msg, "recording_id": recording_id}


@app.function(image=image)  # pyright: ignore[reportUnknownMemberType]
@modal.fastapi_endpoint(method="POST")  # pyright: ignore[reportUnknownMemberType]
def process(job_data: dict[str, str]) -> dict[str, str]:
    """FastAPI endpoint that spawns processing job and returns immediately.

    Args:
        job_data: Worker job payload dict (from WorkerJobPayload.model_dump())

    Returns:
        WorkerAcceptedResponse as dict
    """
    import sys

    sys.path.insert(0, "/root")

    from src.processor.models import WorkerAcceptedResponse, WorkerJobPayload

    # Validate payload with Pydantic
    payload = WorkerJobPayload(**job_data)

    # Spawn the processing job asynchronously (returns immediately)
    _ = _process_internal.spawn(job_data)

    print(f"Spawned processing job for recording {payload.recording_id}")

    response = WorkerAcceptedResponse(status="accepted", recording_id=payload.recording_id)
    return response.model_dump()
