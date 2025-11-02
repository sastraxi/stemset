"""Core audio processing logic shared between local and remote workers.

This module contains the pure business logic for audio separation,
independent of the execution environment (local vs Modal).
"""

from __future__ import annotations

import os
from pathlib import Path

import soundfile as sf  # pyright: ignore[reportMissingTypeStubs]

from ..modern_separator import StemSeparator
from .models import StemData


def _set_pytorch_thread_limits() -> None:
    """Set PyTorch thread limits before any torch operations.

    Must be called before importing or using torch to avoid runtime errors.
    """
    thread_override = os.getenv("PYTORCH_NUM_THREADS")
    if thread_override:
        # Import torch only after checking env var
        import torch

        thread_count = int(thread_override)
        cpu_count = os.cpu_count() or 4

        torch.set_num_threads(thread_count)
        torch.set_num_interop_threads(thread_count)
        print(f"Limited PyTorch to {thread_count} threads (of {cpu_count} available)")


def process_audio_file(
    input_path: Path,
    output_dir: Path,
    profile_name: str,
    strategy_name: str,
) -> list[StemData]:
    """Process an audio file and return stem metadata.

    This is the core processing logic used by both local and Modal workers.

    Args:
        input_path: Path to input audio file
        output_dir: Directory to write output stems
        profile_name: Profile name for separation config
        strategy_name: Strategy name to use

    Returns:
        List of stem metadata dicts with keys:
            - stem_type: Stem name (e.g., "vocals", "drums")
            - measured_lufs: Measured LUFS value
            - peak_amplitude: Peak amplitude
            - stem_gain_adjustment_db: Gain adjustment in dB
            - audio_url: Relative path to audio file
            - waveform_url: Relative path to waveform PNG
            - file_size_bytes: Size of audio file in bytes
            - duration_seconds: Duration in seconds

    Raises:
        Any exception from StemSeparator.separate_and_normalize
    """
    # Set PyTorch thread limits BEFORE any torch operations
    _set_pytorch_thread_limits()

    # Create output directory if needed
    output_dir.mkdir(parents=True, exist_ok=True)

    # Run separation
    separator = StemSeparator(profile_name, strategy_name)
    stems_metadata = separator.separate_and_normalize(input_path, output_dir)

    # Convert to callback format
    stem_data_list: list[StemData] = []
    for stem_name, stem_meta in stems_metadata.stems.items():
        # Get file size and duration
        audio_path = output_dir / stem_meta.stem_url
        file_size_bytes = audio_path.stat().st_size
        info = sf.info(str(audio_path))  # pyright: ignore[reportUnknownMemberType]
        duration_seconds = float(info.duration)  # pyright: ignore[reportAny]

        stem_data_list.append(
            StemData(
                stem_type=stem_name,
                measured_lufs=stem_meta.measured_lufs,
                peak_amplitude=stem_meta.peak_amplitude,
                stem_gain_adjustment_db=stem_meta.stem_gain_adjustment_db,
                audio_url=stem_meta.stem_url,  # Relative path
                waveform_url=stem_meta.waveform_url,  # Relative path
                file_size_bytes=file_size_bytes,
                duration_seconds=duration_seconds,
            )
        )

    return stem_data_list
