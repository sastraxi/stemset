"""Automatic clip boundary detection for audio recordings.

Implements silence-based segmentation to detect natural breaks between songs
in recordings (e.g., live performances, rehearsals, DJ sets).
"""

from __future__ import annotations

from pathlib import Path
from typing import TypedDict

import numpy as np
import numpy.typing as npt
import scipy.ndimage
import soundfile as sf

from src.processor.models import ClipBoundary


class TimeRange(TypedDict):
    """Time range in seconds."""

    start: float
    end: float


# Detection parameters (tunable)
DEFAULT_THRESHOLD_DB = -40.0  # dB below peak for silence threshold
DEFAULT_DILATION_SEC = 0.5  # Seconds to bridge brief pauses
DEFAULT_MIN_CLIP_DURATION_SEC = 5.0  # Minimum clip length to keep
RMS_FRAME_LENGTH = 2048  # Frame length for RMS computation
RMS_HOP_LENGTH = 512  # Hop length for RMS computation


def detect_clip_boundaries(
    stems_dict: dict[str, Path],
    sample_rate: int | None = None,
    threshold_db: float | None = None,
    dilation_sec: float = DEFAULT_DILATION_SEC,
    min_clip_duration_sec: float = DEFAULT_MIN_CLIP_DURATION_SEC,
    adaptive_threshold: bool = True,
) -> dict[str, ClipBoundary]:
    """Detect clip boundaries using silence-based segmentation with activity islands.

    Algorithm (as designed in clips-ui-extension.md):
    1. Activity Detection Per Stem: Compute RMS energy, threshold to binary active/inactive,
       apply morphological dilation to bridge brief pauses
    2. Find Activity Islands: Compute intersection of all stem activity ranges
       (regions where ALL stems are active = high-confidence clip centers)
    3. Grow to Natural Boundaries: Expand each island to include overlapping activity
       from ANY stem, ensuring complete musical phrases

    Args:
        stems_dict: Dictionary mapping stem types to audio file paths
        sample_rate: Sample rate (if None, detected from first stem)
        threshold_db: Silence threshold in dB below peak (if None and adaptive_threshold=True,
                     computed automatically per stem)
        dilation_sec: Seconds to bridge brief pauses (morphological dilation)
        min_clip_duration_sec: Minimum clip duration to keep
        adaptive_threshold: If True and threshold_db is None, compute per-stem thresholds
                          based on dynamic range analysis

    Returns:
        Dictionary mapping clip IDs (e.g., "clip_0", "clip_1") to ClipBoundary objects,
        ordered by start time
    """
    import librosa

    if not stems_dict:
        return {}

    # Load all stems into memory
    stems_audio: dict[str, np.ndarray] = {}
    detected_sr = sample_rate

    for stem_type, stem_path in stems_dict.items():
        audio, sr = sf.read(stem_path)
        if detected_sr is None:
            detected_sr = sr
        elif sr != detected_sr:
            # Resample if needed
            audio = librosa.resample(audio, orig_sr=sr, target_sr=detected_sr)

        # Convert to mono if stereo
        if audio.ndim > 1:
            audio = np.mean(audio, axis=1)

        stems_audio[stem_type] = audio

    if detected_sr is None:
        raise ValueError("Could not determine sample rate")

    sr = detected_sr

    # Get total duration from the first loaded stem
    first_stem_audio = next(iter(stems_audio.values()))
    total_duration_sec = len(first_stem_audio) / sr

    # Step 1: Activity Detection Per Stem
    stem_activity_ranges: dict[str, list[TimeRange]] = {}

    for stem_type, audio in stems_audio.items():
        # Compute RMS energy
        rms = librosa.feature.rms(
            y=audio,
            frame_length=RMS_FRAME_LENGTH,
            hop_length=RMS_HOP_LENGTH,
        )[0]

        # Convert to dB relative to max
        rms_db = librosa.amplitude_to_db(rms, ref=np.max(rms))

        # Determine threshold for this stem
        if threshold_db is not None:
            stem_threshold = threshold_db
        elif adaptive_threshold:
            stem_threshold = _compute_adaptive_threshold(rms_db)
        else:
            stem_threshold = DEFAULT_THRESHOLD_DB

        # Threshold to binary (1 = active, 0 = inactive)
        active_frames = (rms_db > stem_threshold).astype(bool)

        # Apply morphological dilation to bridge brief pauses
        dilation_frames = int(dilation_sec * sr / RMS_HOP_LENGTH)
        if dilation_frames > 0:
            active_frames = scipy.ndimage.binary_dilation(
                active_frames,
                structure=np.ones(dilation_frames),
            )

        # Convert binary array to time ranges
        ranges = _binary_to_time_ranges(active_frames, sr, RMS_HOP_LENGTH)  # pyright: ignore[reportArgumentType]
        stem_activity_ranges[stem_type] = ranges

    # Step 2: Find Activity Islands (intersection of all stems)
    islands = _compute_intersection_ranges(list(stem_activity_ranges.values()))

    if not islands:
        # Fallback: If no islands, check if the whole file is a valid clip
        if total_duration_sec >= min_clip_duration_sec:
            print("No activity islands found, creating a single clip for the full duration.")
            return {
                "clip_0": ClipBoundary(start_time_sec=0.0, end_time_sec=total_duration_sec)
            }
        return {}

    # Step 3: Grow to Natural Boundaries
    # For each island, expand to include ANY stem activity overlapping boundaries
    all_stem_ranges = [r for ranges in stem_activity_ranges.values() for r in ranges]
    expanded_boundaries: list[TimeRange] = []

    for island in islands:
        # Iteratively expand boundaries
        current_start = island["start"]
        current_end = island["end"]

        changed = True
        while changed:
            changed = False
            for range_item in all_stem_ranges:
                range_start = range_item["start"]
                range_end = range_item["end"]
                # Check if this range overlaps or is adjacent to current boundary
                if range_end >= current_start and range_start <= current_end:
                    # Expand to include this range
                    new_start = min(current_start, range_start)
                    new_end = max(current_end, range_end)
                    if new_start < current_start or new_end > current_end:
                        current_start = new_start
                        current_end = new_end
                        changed = True

        expanded_boundaries.append({"start": current_start, "end": current_end})

    # Merge overlapping expanded boundaries
    merged_boundaries = _merge_overlapping_ranges(expanded_boundaries)

    # Filter out clips shorter than minimum duration
    filtered_boundaries = [
        boundary
        for boundary in merged_boundaries
        if (boundary["end"] - boundary["start"]) >= min_clip_duration_sec
    ]

    # Return as ordered dict with clip IDs
    return {
        f"clip_{i}": ClipBoundary(start_time_sec=boundary["start"], end_time_sec=boundary["end"])
        for i, boundary in enumerate(filtered_boundaries)
    }


def _binary_to_time_ranges(
    binary_array: npt.NDArray[np.bool_],
    sample_rate: int,
    hop_length: int,
) -> list[TimeRange]:
    """Convert binary activity array to time ranges.

    Args:
        binary_array: Binary array (True = active, False = inactive)
        sample_rate: Audio sample rate
        hop_length: Hop length used for frame computation

    Returns:
        List of TimeRange dictionaries
    """
    ranges: list[TimeRange] = []
    in_range = False
    start_frame = 0

    for i, active in enumerate(binary_array):  # pyright: ignore[reportAny]
        if active and not in_range:
            # Start of new range
            start_frame = i
            in_range = True
        elif not active and in_range:
            # End of range
            start_time = start_frame * hop_length / sample_rate
            end_time = i * hop_length / sample_rate
            ranges.append({"start": start_time, "end": end_time})
            in_range = False

    # Handle case where range extends to end
    if in_range:
        start_time = start_frame * hop_length / sample_rate
        end_time = len(binary_array) * hop_length / sample_rate
        ranges.append({"start": start_time, "end": end_time})

    return ranges


def _compute_intersection_ranges(
    range_lists: list[list[TimeRange]],
) -> list[TimeRange]:
    """Compute intersection of all range lists (regions where ALL ranges overlap).

    Args:
        range_lists: List of range lists, each containing TimeRange dictionaries

    Returns:
        List of intersection ranges
    """
    if not range_lists:
        return []

    if len(range_lists) == 1:
        return range_lists[0]

    # Start with first list, iteratively intersect with others
    result = range_lists[0]
    for ranges in range_lists[1:]:
        result = _intersect_two_range_lists(result, ranges)
        if not result:
            return []

    return result


def _intersect_two_range_lists(
    ranges_a: list[TimeRange],
    ranges_b: list[TimeRange],
) -> list[TimeRange]:
    """Compute intersection of two range lists.

    Args:
        ranges_a: First range list
        ranges_b: Second range list

    Returns:
        List of intersection ranges
    """
    intersections: list[TimeRange] = []

    for range_a in ranges_a:
        for range_b in ranges_b:
            # Check for overlap
            overlap_start = max(range_a["start"], range_b["start"])
            overlap_end = min(range_a["end"], range_b["end"])

            if overlap_start < overlap_end:
                intersections.append({"start": overlap_start, "end": overlap_end})

    return _merge_overlapping_ranges(intersections)


def _merge_overlapping_ranges(
    ranges: list[TimeRange],
) -> list[TimeRange]:
    """Merge overlapping or adjacent ranges.

    Args:
        ranges: List of TimeRange dictionaries

    Returns:
        List of merged ranges
    """
    if not ranges:
        return []

    # Sort by start time
    sorted_ranges = sorted(ranges, key=lambda x: x["start"])

    merged: list[TimeRange] = [sorted_ranges[0]]

    for range_item in sorted_ranges[1:]:
        last_range = merged[-1]

        if range_item["start"] <= last_range["end"]:
            # Overlapping or adjacent, merge
            merged[-1] = {
                "start": last_range["start"],
                "end": max(last_range["end"], range_item["end"]),
            }
        else:
            # Non-overlapping, add as new range
            merged.append(range_item)

    return merged


def _compute_adaptive_threshold(rms_db: npt.NDArray[np.floating]) -> float:
    """Compute adaptive silence threshold based on RMS energy distribution.

    Strategy: Analyze the histogram of RMS values to find the "noise floor" vs "signal".
    Uses percentile-based approach: threshold set between noise floor and active signal.

    Args:
        rms_db: RMS energy in dB (relative to max)

    Returns:
        Threshold in dB for this stem
    """
    # Use 10th percentile as noise floor estimate
    # Use 50th percentile (median) as active signal estimate
    noise_floor = np.percentile(rms_db, 10)
    median_signal = np.percentile(rms_db, 50)

    # Set threshold midway between noise floor and median signal
    # This adapts to each stem's dynamic range
    adaptive_threshold = (noise_floor + median_signal) / 2.0

    # Clamp to reasonable range (don't go too aggressive or too lenient)
    adaptive_threshold = np.clip(adaptive_threshold, -60.0, -20.0)

    return float(adaptive_threshold)
