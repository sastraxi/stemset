"""Demucs v4 model implementation for 4-stem separation."""

from pathlib import Path

from .base import BaseModelSeparator


class DemucsModelSeparator(BaseModelSeparator):
    """Demucs v4 model implementation for 4-stem separation."""
    
    STEM_NAMES = ["vocals", "drums", "bass", "other"]
    
    def _ensure_separator_loaded(self) -> None:
        """Lazy load the Demucs separator model."""
        if self.separator is None:
            self.separator = self._setup_separator()

            # Load Demucs v4 htdemucs_ft model (4-stem: vocals, drums, bass, other)
            # This model provides excellent separation quality:
            # vocals: 10.8 SDR, drums: 10.0 SDR, bass: 12.0 SDR, other: SDR
            self.separator.load_model("htdemucs_ft.yaml")
            
            output_format = self.profile.output_format.upper()
            output_bitrate = f"{self.profile.opus_bitrate}k" if output_format == "OPUS" else None
            print(f"Demucs v4 htdemucs_ft model loaded (output: {output_format}" +
                  (f" @ {output_bitrate})" if output_bitrate else ")"))

    def separate_and_normalize(self, input_file: Path, output_folder: Path) -> tuple[dict[str, Path], dict[str, dict]]:
        """Separate audio into stems using Demucs v4."""
        output_folder.mkdir(parents=True, exist_ok=True)

        # Ensure model is loaded
        self._ensure_separator_loaded()

        # Set output directory for this separation
        self.separator.model_instance.output_dir = str(output_folder.absolute())

        print(f"Separating {input_file.name} with Demucs v4...")

        # Build custom output names for each stem
        custom_output_names = {
            stem_name: stem_name
            for stem_name in self.STEM_NAMES
        }

        # Separate stems - the library handles everything
        output_files = self.separator.separate(str(input_file), custom_output_names=custom_output_names)

        # Build result mapping
        stem_paths = {}
        for output_file_str in output_files:
            output_file = output_folder / output_file_str
            stem_name = output_file.stem  # e.g., "vocals", "drums", "bass", "other"
            if stem_name in self.STEM_NAMES:
                stem_paths[stem_name] = output_file

        # Verify we got all expected stems
        missing = set(self.STEM_NAMES) - set(stem_paths.keys())
        if missing:
            raise RuntimeError(f"Separation incomplete: missing stems {missing}")

        # Analyze and collect metadata
        stem_metadata = self._analyze_and_collect_metadata(stem_paths)

        return stem_paths, stem_metadata