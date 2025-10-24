"""GPU worker service HTTP API."""

from __future__ import annotations

import tempfile
import httpx
from pathlib import Path
from litestar import Litestar, post
from litestar.datastructures import State
from litestar.exceptions import ConflictException

from .models import ProcessingJob, ProcessingResult
from ..config import Config, Profile, Strategy, get_config
from ..storage import R2Storage, get_storage
from ..modern_separator import StemSeparator
from ..utils import compute_file_hash


@post("/process")
async def process_audio(data: ProcessingJob, state: State) -> ProcessingResult:
    """Process audio file and return results.

    Args:
        data: Job payload with input URL, strategy, and output configuration
        state: Litestar application state (contains config)

    Returns:
        Processing result with status and stem names
    """
    config: Config = state.config
    storage: R2Storage = state.storage

    try:
        # Create temporary working directory
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)

            # Download input file from R2
            input_filename = Path(data.input_key).name
            input_path = temp_path / input_filename
            print(f"Downloading input: {data.input_key}")
            storage.download_input_file(data.profile_name, input_filename, input_path)

            # Compute hash to check for duplicates
            file_hash = compute_file_hash(input_path)
            print(f"File hash: {file_hash[:8]}...")

            # Check if output already exists in R2
            try:
                # Try to get metadata.json for this output
                existing_metadata_key = f"{data.profile_name}/{data.output_name}/metadata.json"
                storage.s3_client.head_object(
                    Bucket=storage.config.bucket_name,
                    Key=existing_metadata_key
                )
                # If we got here, the output already exists
                raise ConflictException(
                    detail=f"Output '{data.output_name}' already exists. "
                    f"This file has already been processed (hash: {file_hash[:8]})"
                )
            except storage.s3_client.exceptions.NoSuchKey:
                # Good - output doesn't exist yet, we can proceed
                pass

            # Get strategy from config
            strategy = config.get_strategy(data.strategy_name)
            if strategy is None:
                raise ValueError(f"Strategy '{data.strategy_name}' not found")

            # Create temporary profile for processing
            # (we don't need source_folder for GPU worker)
            temp_profile = Profile(
                name=data.profile_name,
                source_folder="/tmp/unused",  # Not used during processing
                strategy=data.strategy_name,
                output=data.output_config,
            )

            # Process the audio
            print(f"Processing with strategy: {data.strategy_name}")
            separator = StemSeparator(temp_profile)

            # Create temp output directory
            output_dir = temp_path / "output"
            output_dir.mkdir()

            # Run separation (this creates stems, metadata, and waveforms)
            stem_paths, stem_metadata = separator.separate_and_normalize(
                input_path,
                output_dir
            )

            # Upload all outputs to R2
            print(f"Uploading {len(stem_paths)} stems to R2")
            for stem_name, stem_path in stem_paths.items():
                storage.upload_file(
                    stem_path,
                    data.profile_name,
                    data.output_name,
                    stem_path.name
                )

                # Upload waveform if it exists
                waveform_path = stem_path.parent / f"{stem_name}_waveform.png"
                if waveform_path.exists():
                    storage.upload_file(
                        waveform_path,
                        data.profile_name,
                        data.output_name,
                        waveform_path.name
                    )

            # Upload metadata.json
            metadata_path = output_dir / "metadata.json"
            if metadata_path.exists():
                storage.upload_file(
                    metadata_path,
                    data.profile_name,
                    data.output_name,
                    "metadata.json"
                )

            result = ProcessingResult(
                job_id=data.job_id,
                status="complete",
                stems=list(stem_paths.keys())
            )

            # Call back to API if callback URL provided
            if data.callback_url:
                print(f"Calling back to: {data.callback_url}")
                async with httpx.AsyncClient() as client:
                    await client.post(data.callback_url, json=result.model_dump())

            return result

    except Exception as e:
        error_msg = str(e)
        print(f"Error processing job {data.job_id}: {error_msg}")

        result = ProcessingResult(
            job_id=data.job_id,
            status="error",
            error=error_msg
        )

        # Try to call back with error
        if data.callback_url:
            try:
                async with httpx.AsyncClient() as client:
                    await client.post(data.callback_url, json=result.model_dump())
            except Exception:
                pass  # Best effort callback

        return result


def create_app() -> Litestar:
    """Create and configure the Litestar application.

    Note: This app requires R2 storage to be configured.
    """
    # Load config
    config = get_config()

    # Force R2 storage (GPU worker must use R2)
    if config.r2 is None:
        raise ValueError(
            "GPU worker requires R2 storage to be configured in config.yaml"
        )

    storage = R2Storage(config.r2)

    # Create app with state
    app = Litestar(
        route_handlers=[process_audio],
        state=State({"config": config, "storage": storage})
    )

    return app


# Application instance (used by uvicorn)
app = create_app()
