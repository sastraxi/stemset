"""Core audio processing logic shared between local and remote workers.

This module contains the pure business logic for audio separation,
independent of the execution environment (local vs Modal).
"""

from __future__ import annotations

import os
from pathlib import Path

from src.models.metadata import StemsMetadata
from src.processor.audio_utils import get_duration, pad_audio

from ..modern_separator import LOSSLESS_OUTPUT_CONFIG, StemSeparator

global has_set_limits
has_set_limits = False


def _set_pytorch_thread_limits() -> None:
    """Set PyTorch thread limits before any torch operations.

    Must be called before importing or using torch to avoid runtime errors.
    """
    global has_set_limits
    if has_set_limits:
        return

    thread_override = os.getenv("PYTORCH_NUM_THREADS")
    if thread_override:
        # Import torch only after checking env var
        import torch

        thread_count = int(thread_override)
        cpu_count = os.cpu_count() or 4

        torch.set_num_threads(thread_count)
        torch.set_num_interop_threads(thread_count)
        print(f"Limited PyTorch to {thread_count} threads (of {cpu_count} available)")

        has_set_limits = True


def _convert_to_wav_if_needed(input_path: Path) -> Path:
    """Convert audio file to WAV format if needed.

    Also ensures the audio is resampled to 44.1kHz as most separation models
    expect this sample rate.
    """
    from .audio_utils import convert_audio, get_sample_rate

    # Check if file is already a properly formatted WAV
    needs_conversion = input_path.suffix.lower() != ".wav"

    # Even if it's a WAV, we need to check if it needs resampling
    if not needs_conversion:
        try:
            sample_rate = get_sample_rate(input_path)
            needs_conversion = sample_rate != 44100
            print("No conversion needed." if not needs_conversion else "Resampling needed.")
        except (Exception,):
            # If we can't determine, assume conversion needed
            needs_conversion = True

    if not needs_conversion:
        return input_path

    wav_path = input_path.with_suffix(".converted.wav")

    action = "Converting" if input_path.suffix.lower() != ".wav" else "Resampling"
    print(f"{action} {input_path.name} to 44.1kHz WAV format...")

    try:
        _ = convert_audio(input_path, wav_path, sample_rate=44100)
        print(f"Successfully converted to {wav_path}")
        return wav_path
    except Exception as e:
        print(f"Error converting to WAV: {e}")
        raise


def _pad_audio_if_too_short(
    input_path: Path, min_duration_seconds: float = 11.0
) -> tuple[Path, float]:
    """Pad audio file with silence if it's shorter than minimum duration.

    Some separation models have issues with very short audio files (< 10 seconds).
    This function pads short files with silence at the end to meet the minimum duration.

    Args:
        input_path: Path to input audio file
        min_duration_seconds: Minimum duration in seconds (default 11.0 for safety margin)

    Returns:
        Path to padded audio file if padding was needed, otherwise original path
        and the duration of the audio file.

    Raises:
        subprocess.CalledProcessError: If ffmpeg fails to pad audio
        ValueError: If duration cannot be determined
    """
    duration = get_duration(input_path)
    if duration >= min_duration_seconds:
        return input_path, duration

    # Calculate padding needed
    padding_seconds = min_duration_seconds - duration
    padded_path = input_path.with_suffix(".padded.wav")

    print(
        f"Audio file is {duration:.2f}s, padding with {padding_seconds:.2f}s of silence to avoid processing issues..."
    )
    _ = pad_audio(input_path, padded_path, padding_seconds)
    return padded_path, min_duration_seconds


async def separate_to_wav(
    input_path: Path,
    output_dir: Path,
    profile_name: str,
    strategy_name: str,
) -> StemsMetadata:
    """Process an audio file and return stem metadata for lossless WAV files.

    This is the first stage of processing, ensuring all intermediate files are
    in a consistent format for analysis (LUFS, waveforms, clip detection).

    Args:
        input_path: Path to input audio file
        output_dir: Directory to write output stems
        profile_name: Profile name for separation config
        strategy_name: Strategy name to use

    Returns:
        StemsMetadata object for the generated WAV stems.

    Raises:
        Any exception from StemSeparator.separate_and_normalize
    """
    # Set PyTorch thread limits BEFORE any torch operations
    _set_pytorch_thread_limits()

    # Ensure input is in WAV format for processing
    converted_input_path = _convert_to_wav_if_needed(input_path)
    (padded_input_path, _) = _pad_audio_if_too_short(converted_input_path)

    # Create output directory if needed
    output_dir.mkdir(parents=True, exist_ok=True)

    # Run separation to lossless format (WAV)
    separator = StemSeparator(profile_name, strategy_name, LOSSLESS_OUTPUT_CONFIG)
    stems_metadata = await separator.separate_and_normalize(padded_input_path, output_dir)

    return stems_metadata
