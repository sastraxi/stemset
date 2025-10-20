"""Stem separation using configurable models and loudness normalization."""

from pathlib import Path

from .config import Profile, ModelType
from .modern_separator import SeparationFactory


class StemSeparator:
    """Legacy wrapper for the new separation factory."""

    def __init__(self, profile: Profile):
        """Initialize separator for a specific profile."""
        self.profile = profile
        self.factory = SeparationFactory(profile)

    def separate_and_normalize(self, input_file: Path, output_folder: Path) -> tuple[dict[str, Path], dict[str, dict]]:
        """Separate audio into stems and normalize loudness."""
        return self.factory.separate_and_normalize(input_file, output_folder)
