"""Functions for triggering audio processing tasks."""

from __future__ import annotations

import os
from typing import TYPE_CHECKING

import httpx
from litestar.background_tasks import BackgroundTask
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.config import get_engine
from src.db.models import Recording
from src.processor.local import process_locally
from src.processor.models import WorkerJobPayload

if TYPE_CHECKING:
    from src.config import Config
    from src.db.models import Profile


async def trigger_processing(
    recording: Recording,
    profile: Profile,
    input_filename: str,
    config: Config,
    backend_url: str,
) -> None:
    """Triggers audio processing for a recording, either locally or remotely.

    Args:
        recording: The Recording object to process.
        profile: The Profile associated with the recording.
        input_filename: The name of the input file in storage.
        config: The application configuration.
        backend_url: The base URL of the backend for callbacks.
    """
    callback_url = (
        f"{backend_url}/api/recordings/{recording.id}/complete/{recording.verification_token}"
    )
    gpu_worker_url = config.gpu_worker_url or os.getenv("GPU_WORKER_URL")

    if gpu_worker_url:
        # Remote Modal worker - trigger via HTTP
        worker_payload = WorkerJobPayload(
            recording_id=str(recording.id),
            profile_name=profile.name,
            strategy_name=profile.strategy_name,
            input_filename=input_filename,
            output_name=recording.output_name,
            callback_url=callback_url,
            output_config_dict=profile.output.model_dump(),
        )

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.post(gpu_worker_url, json=worker_payload.model_dump())
                response.raise_for_status()
                print(f"Triggered Modal worker for recording {recording.id}")
        except (httpx.TimeoutException, httpx.HTTPError) as e:
            print(f"Error: Failed to trigger Modal worker: {e}")
            # Clean up the recording on failure
            async with AsyncSession(get_engine()) as session:
                stmt = select(Recording).where(Recording.id == recording.id)
                result = await session.exec(stmt)
                failed_recording = result.first()
                if failed_recording:
                    failed_recording.status = "error"
                    failed_recording.error_message = f"Failed to start processing: {e}"
                    await session.commit()
            raise
    else:
        # Local processing - use background task directly
        print(f"[Local Worker] Queueing recording {recording.id} for background processing")
        task = BackgroundTask(process_locally, recording.id, config, backend_url)
        await task()
