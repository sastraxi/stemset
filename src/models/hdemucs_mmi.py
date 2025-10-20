"""HD-Demucs MMI model implementation for 4-stem separation."""

from pathlib import Path

from .base import BaseModelSeparator


class HDemucsMMIModelSeparator(BaseModelSeparator):
    """HD-Demucs MMI model implementation using audio-separator library."""
    
    STEM_NAMES = ["vocals", "drums", "bass", "other"]
    
    def __init__(self, profile):
        """Initialize HD-Demucs MMI separator."""
        super().__init__(profile)
        self.separator = None
        
    def _ensure_separator_loaded(self) -> None:
        """Lazy load the HD-Demucs MMI separator."""
        if self.separator is None:
            self.separator = self._setup_separator()
            
            # Load the HD-Demucs MMI model
            self.separator.load_model(model_filename="hdemucs_mmi.yaml")
            print(f"HD-Demucs MMI model loaded (output: {self.profile.output_format.upper()}")
            if self.profile.output_format.upper() == "OPUS":
                print(f" @ {self.profile.opus_bitrate}k)")
            else:
                print(")")

    def separate_and_normalize(self, input_file: Path, output_folder: Path) -> tuple[dict[str, Path], dict[str, dict]]:
        """Separate audio into stems using HD-Demucs MMI."""
        output_folder.mkdir(parents=True, exist_ok=True)

        # Ensure separator is loaded
        self._ensure_separator_loaded()

        # Set output directory for this separation (same as original Demucs implementation)
        self.separator.model_instance.output_dir = str(output_folder.absolute())

        print(f"Separating {input_file.name} with HD-Demucs MMI...")

        # Build custom output names for each stem (avoids underscores in filenames)
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
            raise RuntimeError(f"HD-Demucs MMI separation incomplete: missing stems {missing}")

        # Analyze and collect metadata
        stem_metadata = self._analyze_and_collect_metadata(stem_paths)

        return stem_paths, stem_metadata