#!/usr/bin/env python
import argparse
import os
import random

import soundfile as sf


def extract_random_clip(input_path, duration_s):
    """
    Extracts a random clip of a specified duration from an audio file.

    Args:
        input_path (str): Path to the input audio file.
        duration_s (int): Desired duration of the clip in seconds.
    """
    try:
        audio_data, sample_rate = sf.read(input_path)
    except Exception as e:
        print(f"Error reading audio file: {e}")
        return

    total_frames = len(audio_data)
    clip_frames = int(duration_s * sample_rate)

    if clip_frames > total_frames:
        print(
            f"Error: Requested duration ({duration_s}s) is longer than the audio file ({total_frames / sample_rate:.2f}s)."
        )
        return

    max_start_frame = total_frames - clip_frames
    start_frame = random.randint(0, max_start_frame)

    clip_data = audio_data[start_frame : start_frame + clip_frames]

    # Calculate start time for filename
    start_time_s = start_frame / sample_rate
    minutes = int(start_time_s // 60)
    seconds = int(start_time_s % 60)
    mmss = f"{minutes:01d}{seconds:02d}"

    # Create output path
    directory, filename = os.path.split(input_path)
    basename, ext = os.path.splitext(filename)
    output_filename = f"{basename}.{mmss}.{duration_s}.wav"
    output_path = os.path.join(directory, output_filename)

    try:
        sf.write(output_path, clip_data, sample_rate)
        print(f"Successfully extracted clip to: {output_path}")
    except Exception as e:
        print(f"Error writing output file: {e}")


def main():
    parser = argparse.ArgumentParser(
        description="Extract a random N-second clip from an audio file."
    )
    parser.add_argument("audio_file", help="The path to the audio file (e.g., /path/to/my.wav)")
    parser.add_argument("duration", type=int, help="The duration of the clip in seconds.")
    args = parser.parse_args()

    extract_random_clip(args.audio_file, args.duration)


if __name__ == "__main__":
    main()
