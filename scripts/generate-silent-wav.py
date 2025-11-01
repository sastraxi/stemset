#!/usr/bin/env python3
import pathlib
import wave

duration_seconds = 5  # Duration of silence
sample_rate = 44100  # 44.1 kHz
n_channels = 1  # Mono
sampwidth = 2  # 2 bytes (16-bit PCM)
n_frames = duration_seconds * sample_rate

output_path = pathlib.Path(__file__).resolve().parent.parent / "frontend/public/silence.wav"

with wave.open(str(output_path), "w") as wav_file:
    wav_file.setnchannels(n_channels)
    wav_file.setsampwidth(sampwidth)
    wav_file.setframerate(sample_rate)
    wav_file.writeframes(b"\x00\x00" * n_frames)
