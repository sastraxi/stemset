"""Stem separation using BS-RoFormer and loudness normalization."""

import json
import struct
import subprocess
from pathlib import Path
from typing import Dict

import numpy as np
import pyloudnorm as pyln
import soundfile as sf
from audio_separator.separator import Separator

from .config import Profile


class StemSeparator:
    """Handles stem separation and loudness normalization."""

    STEM_NAMES = ["vocals", "drums", "bass", "other"]
    SAMPLE_RATE = 44100

    def __init__(self, profile: Profile):
        """Initialize separator for a specific profile.

        Args:
            profile: The profile configuration to use
        """
        self.profile = profile
        self.separator = None
        self.loudness_meter = pyln.Meter(self.SAMPLE_RATE)

    def _ensure_separator_loaded(self) -> None:
        """Lazy load the separator model (downloads model on first use)."""
        if self.separator is None:
            # Create a temporary output directory for the separator
            temp_output_dir = Path.home() / ".stemset" / "temp_output"
            temp_output_dir.mkdir(parents=True, exist_ok=True)

            self.separator = Separator(
                log_level=20,  # INFO level
                model_file_dir=str(Path.home() / ".stemset" / "models"),
                output_dir=str(temp_output_dir),  # Configure output directory
            )
            # Load BS-RoFormer model (state-of-the-art)
            # This will download the model on first use
            self.separator.load_model("model_bs_roformer_ep_317_sdr_12.9755.ckpt")
            print("BS-RoFormer model loaded successfully")

    def _write_wav_with_metadata(
        self, output_path: Path, audio_data, sample_rate: int, metadata: Dict[str, float]
    ) -> None:
        """Write WAV file with loudness metadata embedded in INFO chunk.

        Args:
            output_path: Path to write the WAV file
            audio_data: Audio samples (numpy array)
            sample_rate: Sample rate in Hz
            metadata: Dictionary of metadata to embed
        """
        # First write the audio file
        sf.write(str(output_path), audio_data, sample_rate, subtype="PCM_24")

        # Now append INFO chunk with metadata
        # We'll use the LIST-INFO chunk format which is part of the RIFF standard
        with open(output_path, "r+b") as f:
            # Read the entire file
            f.seek(0, 2)  # Seek to end
            file_size = f.tell()

            # Read RIFF header to find where to insert LIST chunk
            f.seek(0)
            riff_header = f.read(12)

            if riff_header[:4] != b"RIFF" or riff_header[8:12] != b"WAVE":
                raise ValueError("Not a valid WAV file")

            # Read all existing chunks
            f.seek(12)
            chunks = []
            while f.tell() < file_size:
                chunk_id = f.read(4)
                if len(chunk_id) < 4:
                    break
                chunk_size = struct.unpack("<I", f.read(4))[0]
                chunk_data = f.read(chunk_size)
                chunks.append((chunk_id, chunk_data))
                # Chunks are word-aligned
                if chunk_size % 2 == 1:
                    f.read(1)

            # Build INFO chunk data
            info_data = b""
            for key, value in metadata.items():
                # Convert metadata key to 4-char RIFF chunk identifier
                # We'll use ICMT (comment) for JSON-encoded metadata
                pass

            # For simplicity, we'll encode all metadata as JSON in ICMT (comment) chunk
            import json

            comment_text = json.dumps(metadata).encode("utf-8")
            if len(comment_text) % 2 == 1:
                comment_text += b"\x00"  # Pad to word boundary

            info_chunk_data = b"INFO" + b"ICMT" + struct.pack("<I", len(comment_text)) + comment_text

            # Calculate LIST chunk size
            list_chunk_size = len(info_chunk_data)

            # Rebuild the file
            f.seek(0)
            f.write(b"RIFF")

            # New file size (excluding RIFF header)
            new_data_size = sum(8 + len(data) + (len(data) % 2) for _, data in chunks) + 4 + 4 + list_chunk_size
            f.write(struct.pack("<I", new_data_size + 4))  # +4 for "WAVE"

            f.write(b"WAVE")

            # Write original chunks
            for chunk_id, chunk_data in chunks:
                f.write(chunk_id)
                f.write(struct.pack("<I", len(chunk_data)))
                f.write(chunk_data)
                if len(chunk_data) % 2 == 1:
                    f.write(b"\x00")

            # Write LIST-INFO chunk
            f.write(b"LIST")
            f.write(struct.pack("<I", list_chunk_size))
            f.write(info_chunk_data)

            f.truncate()

    def separate_and_normalize(self, input_file: Path, output_folder: Path) -> Dict[str, Path]:
        """Separate audio into stems and normalize loudness.

        Args:
            input_file: Path to input WAV file
            output_folder: Path to output folder for stems

        Returns:
            Dict mapping stem name to output file path
        """
        output_folder.mkdir(parents=True, exist_ok=True)

        # Ensure model is loaded
        self._ensure_separator_loaded()

        print(f"Separating {input_file.name}...")

        # Separate stems using BS-RoFormer
        # audio-separator outputs to a folder and returns list of output files
        output_files = self.separator.separate(str(input_file))

        # The separator creates files with names like:
        # "filename_(Vocals)_BS-Roformer.wav"
        # "filename_(Drums)_BS-Roformer.wav"
        # etc.

        stem_paths = {}
        stem_metadata = {}

        for output_file_str in output_files:
            output_file = Path(output_file_str)

            # Determine which stem this is
            stem_name = None
            for name in self.STEM_NAMES:
                if f"({name.title()})" in output_file.name or f"({name.upper()})" in output_file.name:
                    stem_name = name
                    break

            if stem_name is None:
                # Check for "other" / "instrumental" / "accompaniment"
                if any(x in output_file.name.lower() for x in ["other", "instrumental", "accompaniment"]):
                    stem_name = "other"
                else:
                    print(f"Warning: Could not determine stem type for {output_file.name}, skipping")
                    continue

            # Load the separated stem
            audio_data, rate = sf.read(str(output_file))

            # Measure integrated loudness (LUFS)
            try:
                loudness_lufs = self.loudness_meter.integrated_loudness(audio_data)
            except ValueError as e:
                # Handle case where audio is too quiet or silent
                print(f"Warning: Could not measure loudness for {stem_name}: {e}")
                loudness_lufs = -70.0  # Very quiet

            # Calculate gain needed to reach target LUFS
            target_lufs = self.profile.target_lufs
            gain_db = target_lufs - loudness_lufs

            # Add profile-specific stem gain adjustment
            stem_gain_adjustment = self.profile.get_stem_gain(stem_name)
            total_gain_db = gain_db + stem_gain_adjustment

            # Convert to linear gain
            linear_gain = 10 ** (total_gain_db / 20)

            # Apply gain
            normalized_audio = audio_data * linear_gain

            # Prepare metadata to embed
            metadata = {
                "original_lufs": float(loudness_lufs),
                "target_lufs": float(target_lufs),
                "normalization_gain_db": float(gain_db),
                "stem_gain_adjustment_db": float(stem_gain_adjustment),
                "total_gain_db": float(total_gain_db),
                "stem_type": stem_name,
            }

            # Determine output format and file extension
            if self.profile.output_format == "opus":
                output_path = output_folder / f"{stem_name}.opus"
                self._write_opus_with_metadata(output_path, normalized_audio, rate, metadata)
            else:  # wav
                output_path = output_folder / f"{stem_name}.wav"
                self._write_wav_with_metadata(output_path, normalized_audio, rate, metadata)

            stem_paths[stem_name] = output_path
            stem_metadata[stem_name] = metadata

            # Clean up original separator output
            output_file.unlink()

            print(f"  {stem_name}: {loudness_lufs:.1f} LUFS -> {target_lufs:.1f} LUFS (gain: {total_gain_db:+.1f} dB)")

        # Clean up ALL temporary separator output files (not just processed ones)
        temp_output_dir = Path.home() / ".stemset" / "temp_output"
        if temp_output_dir.exists():
            for temp_file in temp_output_dir.glob("*"):
                try:
                    if temp_file.is_file():
                        temp_file.unlink()
                except Exception as e:
                    print(f"Warning: Could not delete temporary file {temp_file}: {e}")

        return stem_paths

    def _write_opus_with_metadata(
        self, output_path: Path, audio_data, sample_rate: int, metadata: Dict[str, float]
    ) -> None:
        """Write Opus file with metadata using ffmpeg.

        Args:
            output_path: Path to write the Opus file
            audio_data: Audio samples (numpy array)
            sample_rate: Sample rate in Hz
            metadata: Dictionary of metadata to embed as JSON in comment tag
        """
        # First write to temporary WAV file
        temp_wav = output_path.with_suffix(".temp.wav")
        sf.write(str(temp_wav), audio_data, sample_rate, subtype="PCM_16")

        # Encode metadata as JSON for Opus comment tag
        metadata_json = json.dumps(metadata)

        # Use ffmpeg to encode to Opus with metadata
        # Opus is excellent for music: 128-256 kbps gives transparent quality
        bitrate = f"{self.profile.opus_bitrate}k"

        try:
            subprocess.run(
                [
                    "ffmpeg",
                    "-i", str(temp_wav),
                    "-c:a", "libopus",
                    "-b:a", bitrate,
                    "-vbr", "on",  # Variable bitrate for better quality
                    "-compression_level", "10",  # Maximum compression efficiency
                    "-application", "audio",  # Optimize for music/audio (not voip)
                    "-metadata", f"comment={metadata_json}",
                    "-y",  # Overwrite output file
                    str(output_path),
                ],
                check=True,
                capture_output=True,
                text=True,
            )
        except subprocess.CalledProcessError as e:
            raise RuntimeError(f"Failed to encode Opus file: {e.stderr}") from e
        finally:
            # Clean up temp file
            if temp_wav.exists():
                temp_wav.unlink()
