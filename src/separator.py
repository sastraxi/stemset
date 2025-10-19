"""Stem separation using BS-RoFormer and loudness normalization."""

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

            # Load BS-RoFormer model (state-of-the-art)
            self.separator.load_model("model_bs_roformer_ep_317_sdr_12.9755.ckpt")
            print(f"BS-RoFormer model loaded (output: {output_format}" +
                  (f" @ {output_bitrate})" if output_bitrate else ")"))

    def separate_and_normalize(self, input_file: Path, output_folder: Path) -> dict[str, Path]:
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

        # Build custom output names for each stem (library adds extension automatically)
        custom_output_names = {
            stem_name: str(output_folder / stem_name)
            for stem_name in self.STEM_NAMES
        }

        # Separate stems - the library handles everything
        output_files = self.separator.separate(str(input_file), custom_output_names=custom_output_names)

        # Build result mapping - library returns list of paths
        stem_paths = {}
        for output_file_str in output_files:
            output_file = Path(output_file_str)

            # Determine stem name from filename
            stem_name = output_file.stem  # e.g., "vocals", "drums", "bass", "other"
            if stem_name in self.STEM_NAMES:
                stem_paths[stem_name] = output_file

                # Load and analyze loudness for reporting
                try:
                    audio_data, _rate = sf.read(str(output_file))
                    loudness_lufs = self.loudness_meter.integrated_loudness(audio_data)
                    print(f"  {stem_name}: {loudness_lufs:.1f} LUFS")
                except Exception as e:
                    print(f"  {stem_name}: Could not analyze loudness: {e}")

        # Verify we got all expected stems
        missing = set(self.STEM_NAMES) - set(stem_paths.keys())
        if missing:
            raise RuntimeError(f"Separation incomplete: missing stems {missing}")

        return stem_paths
