"""Callback preparation and sending utilities for processing workers."""

from __future__ import annotations

from pathlib import Path

import httpx

from ..models.metadata import StemsMetadata
from .models import ClipBoundary, ProcessingCallbackPayload, StemData, StemDataModel


def prepare_success_payload(
    stems_metadata: StemsMetadata,
    output_dir: Path,
    clip_boundaries: dict[str, ClipBoundary],
) -> ProcessingCallbackPayload:
    """Prepare a success callback payload from processing results.

    Args:
        stems_metadata: Metadata for all separated stems
        output_dir: Directory containing the stem files
        clip_boundaries: Detected clip boundaries

    Returns:
        ProcessingCallbackPayload ready to send to callback endpoint
    """
    stem_data_list: list[StemData] = []
    duration = stems_metadata.duration

    for stem_name, stem_meta in stems_metadata.stems.items():
        audio_path = output_dir / stem_meta.stem_url
        file_size_bytes = audio_path.stat().st_size if audio_path.exists() else 0

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

    return ProcessingCallbackPayload(
        status="complete",
        stems=[StemDataModel(**stem) for stem in stem_data_list],
        clip_boundaries=clip_boundaries,
    )


def prepare_error_payload(error: Exception | str) -> ProcessingCallbackPayload:
    """Prepare an error callback payload.

    Args:
        error: Exception or error message string

    Returns:
        ProcessingCallbackPayload with error status
    """
    error_msg = str(error)
    return ProcessingCallbackPayload(status="error", error=error_msg)


async def send_callback_async(
    callback_url: str,
    payload: ProcessingCallbackPayload,
    timeout: float = 30.0,
) -> None:
    """Send callback payload to API endpoint (async version).

    Args:
        callback_url: Full callback URL
        payload: Callback payload to send
        timeout: Request timeout in seconds

    Raises:
        httpx.HTTPStatusError: If callback request fails
    """
    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.post(callback_url, json=payload.model_dump())
        response.raise_for_status()


def send_callback_sync(
    callback_url: str,
    payload: ProcessingCallbackPayload,
    timeout: float = 30.0,
) -> None:
    """Send callback payload to API endpoint (sync version).

    Args:
        callback_url: Full callback URL
        payload: Callback payload to send
        timeout: Request timeout in seconds

    Raises:
        httpx.HTTPStatusError: If callback request fails
    """
    with httpx.Client(timeout=timeout) as client:
        response = client.post(callback_url, json=payload.model_dump())
        response.raise_for_status()


async def send_callback_with_error_handling_async(
    callback_url: str,
    payload: ProcessingCallbackPayload,
    error_prefix: str = "",
) -> None:
    """Send callback with automatic error handling (async).

    Args:
        callback_url: Full callback URL
        payload: Callback payload to send
        error_prefix: Prefix for error log messages
    """
    try:
        await send_callback_async(callback_url, payload)
    except Exception as e:
        print(f"{error_prefix}Failed to send callback: {e}")


def send_callback_with_error_handling_sync(
    callback_url: str,
    payload: ProcessingCallbackPayload,
    error_prefix: str = "",
) -> None:
    """Send callback with automatic error handling (sync).

    Args:
        callback_url: Full callback URL
        payload: Callback payload to send
        error_prefix: Prefix for error log messages
    """
    try:
        send_callback_sync(callback_url, payload)
    except Exception as e:
        print(f"{error_prefix}Failed to send callback: {e}")
