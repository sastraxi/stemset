"""Audio utilities based on ffmpeg/ffprobe.

This module provides a unified interface for audio operations using ffmpeg/ffprobe,
eliminating the need for format-specific libraries like soundfile.
"""

from __future__ import annotations

import subprocess
from pathlib import Path

import numpy as np


def get_duration(audio_path: Path) -> float:
    """Get audio file duration in seconds using ffprobe.

    Args:
        audio_path: Path to audio file

    Returns:
        Duration in seconds

    Raises:
        subprocess.CalledProcessError: If ffprobe fails
        ValueError: If duration cannot be parsed
    """
    cmd = [
        "ffprobe",
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        str(audio_path),
    ]
    result = subprocess.run(cmd, check=True, capture_output=True, text=True)
    return float(result.stdout.strip())


def get_sample_rate(audio_path: Path) -> int:
    """Get audio file sample rate using ffprobe.

    Args:
        audio_path: Path to audio file

    Returns:
        Sample rate in Hz

    Raises:
        subprocess.CalledProcessError: If ffprobe fails
        ValueError: If sample rate cannot be parsed
    """
    cmd = [
        "ffprobe",
        "-v",
        "error",
        "-select_streams",
        "a:0",
        "-show_entries",
        "stream=sample_rate",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        str(audio_path),
    ]
    result = subprocess.run(cmd, check=True, capture_output=True, text=True)
    return int(result.stdout.strip())


def read_audio(audio_path: Path) -> tuple[np.ndarray, int]:
    """Read audio file to numpy array using ffmpeg.

    Args:
        audio_path: Path to audio file

    Returns:
        Tuple of (audio_data, sample_rate) where audio_data is a numpy array
        with shape (samples,) for mono or (samples, channels) for multi-channel.

    Raises:
        subprocess.CalledProcessError: If ffmpeg fails
    """
    # First get the sample rate
    sample_rate = get_sample_rate(audio_path)

    # Decode audio to raw PCM (f32le = 32-bit float little-endian)
    cmd = [
        "ffmpeg",
        "-v",
        "error",
        "-i",
        str(audio_path),
        "-f",
        "f32le",  # 32-bit float PCM
        "-acodec",
        "pcm_f32le",
        "-",  # Output to stdout
    ]

    result = subprocess.run(cmd, check=True, capture_output=True)

    # Convert raw bytes to numpy array
    audio_data = np.frombuffer(result.stdout, dtype=np.float32)

    # Get number of channels to reshape properly
    channels = _get_channels(audio_path)
    if channels > 1:
        audio_data = audio_data.reshape(-1, channels)

    return audio_data, sample_rate


def _get_channels(audio_path: Path) -> int:
    """Get number of audio channels using ffprobe.

    Args:
        audio_path: Path to audio file

    Returns:
        Number of channels

    Raises:
        subprocess.CalledProcessError: If ffprobe fails
    """
    cmd = [
        "ffprobe",
        "-v",
        "error",
        "-select_streams",
        "a:0",
        "-show_entries",
        "stream=channels",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        str(audio_path),
    ]
    result = subprocess.run(cmd, check=True, capture_output=True, text=True)
    return int(result.stdout.strip())


def convert_audio(
    input_path: Path,
    output_path: Path,
    sample_rate: int | None = None,
    bitrate: str | None = None,
    codec: str | None = None,
):
    """Convert audio file using ffmpeg.

    Args:
        input_path: Input audio file
        output_path: Output audio file
        sample_rate: Target sample rate in Hz (optional)
        bitrate: Target bitrate like "128k" (optional)
        codec: Audio codec like "libopus", "aac" (optional, inferred from extension if not provided)

    Raises:
        subprocess.CalledProcessError: If ffmpeg fails
    """
    cmd = [
        "ffmpeg",
        "-y",  # Overwrite output
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        str(input_path),
    ]

    # Add optional parameters
    if sample_rate is not None:
        cmd.extend(["-ar", str(sample_rate)])

    if codec is not None:
        cmd.extend(["-c:a", codec])

    if bitrate is not None:
        cmd.extend(["-b:a", bitrate])

    cmd.append(str(output_path))

    return subprocess.run(cmd, check=True, capture_output=True, text=True)


def pad_audio(input_path: Path, output_path: Path, pad_duration: float):
    """Pad audio file with silence at the end using ffmpeg.

    Args:
        input_path: Input audio file
        output_path: Output audio file
        pad_duration: Duration of silence to add in seconds

    Raises:
        subprocess.CalledProcessError: If ffmpeg fails
    """
    cmd = [
        "ffmpeg",
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        str(input_path),
        "-af",
        f"apad=pad_dur={pad_duration}",
        str(output_path),
    ]
    return subprocess.run(cmd, check=True, capture_output=True, text=True)
