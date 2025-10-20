"""Stem separation using configurable models and loudness normalization."""

from pathlib import Path

from .config import Profile, ModelType
from .models import DemucsModelSeparator, SeparatorModel


class StemSeparator:
    """Factory for creating appropriate separator model based on profile configuration."""

    def __init__(self, profile: Profile):
        """Initialize separator for a specific profile.

        Args:
            profile: The profile configuration to use
        """
        self.profile = profile
        self._model_instance: SeparatorModel | None = None

    def _get_model_instance(self) -> SeparatorModel:
        """Get or create the appropriate separator model instance."""
        if self._model_instance is None:
            match self.profile.model:
                case ModelType.DEMUCS:
                    self._model_instance = DemucsModelSeparator(self.profile)
                case ModelType.BSMAMBA2:
                    # Will implement this next
                    from .models.bsmamba2 import BSMamba2ModelSeparator
                    self._model_instance = BSMamba2ModelSeparator(self.profile)
        
        return self._model_instance

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
        model = self._get_model_instance()
        return model.separate_and_normalize(input_file, output_folder)
