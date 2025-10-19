"""Stem separation using Demucs v4 and loudness normalization."""

from pathlib import Path

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
            import torch

            # Limit CPU threads to be nice to interactive processes
            # This is more effective than os.nice() for PyTorch workloads
            # Use half of available CPU cores, minimum 1
            import os
            cpu_count = os.cpu_count() or 4
            thread_count = max(1, cpu_count // 2)
            torch.set_num_threads(thread_count)
            torch.set_num_interop_threads(thread_count)
            print(f"Limited PyTorch to {thread_count} threads (of {cpu_count} available)")

            # Determine output format and bitrate
            output_format = self.profile.output_format.upper()
            output_bitrate = f"{self.profile.opus_bitrate}k" if output_format == "OPUS" else None

            self.separator = Separator(
                log_level=20,  # INFO level
                model_file_dir=str(Path.home() / ".stemset" / "models"),
                output_format=output_format,
                output_bitrate=output_bitrate,
                normalization_threshold=0.9,  # Prevent clipping
            )

            # Load Demucs v4 htdemucs_ft model (4-stem: vocals, drums, bass, other)
            # This model provides excellent separation quality:
            # vocals: 10.8 SDR, drums: 10.0 SDR, bass: 12.0 SDR, other: SDR
            self.separator.load_model("htdemucs_ft.yaml")
            print(f"Demucs v4 htdemucs_ft model loaded (output: {output_format}" +
                  (f" @ {output_bitrate})" if output_bitrate else ")"))

    def separate_and_normalize(self, input_file: Path, output_folder: Path) -> tuple[dict[str, Path], dict[str, dict]]:
        """Separate audio into stems and normalize loudness.

        Args:
            input_file: Path to input WAV file
            output_folder: Path to output folder for stems

        Returns:
            Tuple of (stem_paths, metadata) where:
            - stem_paths: Dict mapping stem name to output file path
            - metadata: Dict mapping stem name to metadata dict with LUFS info
        """
        output_folder.mkdir(parents=True, exist_ok=True)

        # Ensure model is loaded
        self._ensure_separator_loaded()

        # Set output directory for this separation on the model instance
        # (setting it on separator won't work as it's already been passed to model_instance)
        self.separator.model_instance.output_dir = str(output_folder.absolute())

        print(f"Separating {input_file.name}...")

        # Build custom output names for each stem (just the stem name, not full path)
        # The library will place them in output_dir
        custom_output_names = {
            stem_name: stem_name
            for stem_name in self.STEM_NAMES
        }

        # Separate stems - the library handles everything
        output_files = self.separator.separate(str(input_file), custom_output_names=custom_output_names)

        # Build result mapping and collect metadata
        stem_paths = {}
        stem_metadata = {}

        for output_file_str in output_files:
            output_file = Path(output_file_str)

            # Determine stem name from filename
            stem_name = output_file.stem  # e.g., "vocals", "drums", "bass", "other"
            if stem_name in self.STEM_NAMES:
                stem_paths[stem_name] = output_file

                # Load and analyze loudness for metadata
                try:
                    audio_data, _rate = sf.read(str(output_file))
                    loudness_lufs = self.loudness_meter.integrated_loudness(audio_data)
                    print(f"  {stem_name}: {loudness_lufs:.1f} LUFS")

                    # Calculate gain adjustment from profile
                    stem_gain_db = getattr(self.profile.stem_gains, stem_name, 0.0)

                    # Store metadata
                    stem_metadata[stem_name] = {
                        "stem_type": stem_name,
                        "measured_lufs": round(loudness_lufs, 2),
                        "target_lufs": self.profile.target_lufs,
                        "stem_gain_adjustment_db": stem_gain_db,
                    }

                except Exception as e:
                    print(f"  {stem_name}: Could not analyze loudness: {e}")
                    # Provide default metadata if analysis fails
                    stem_metadata[stem_name] = {
                        "stem_type": stem_name,
                        "measured_lufs": None,
                        "target_lufs": self.profile.target_lufs,
                        "stem_gain_adjustment_db": getattr(self.profile.stem_gains, stem_name, 0.0),
                    }

        # Verify we got all expected stems
        missing = set(self.STEM_NAMES) - set(stem_paths.keys())
        if missing:
            raise RuntimeError(f"Separation incomplete: missing stems {missing}")

        return stem_paths, stem_metadata
