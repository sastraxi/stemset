"""Modern separation factory using layered architecture."""

from __future__ import annotations
from pathlib import Path

from .config import Profile, ModelType
from .models.protocols import AnySeparator, SeparationResult
from .models.atomic_models import HTDemucsModel, HDDemucsMMIModel
from .models.workflows import SuccessiveWorkflow


class SeparationFactory:
    """Factory for creating appropriate separator based on profile configuration."""

    def __init__(self, profile: Profile):
        """Initialize factory for a specific profile."""
        self.profile = profile
        self._separator_instance: AnySeparator | None = None

    def _get_separator_instance(self) -> AnySeparator:
        """Get or create the appropriate separator instance."""
        if self._separator_instance is None:
            match self.profile.model:
                case ModelType.HTDEMUCS_FT:
                    self._separator_instance = HTDemucsModel(self.profile)
                case ModelType.HDEMUCS_MMI:
                    self._separator_instance = HDDemucsMMIModel(self.profile)
                case ModelType.SUCCESSIVE:
                    self._separator_instance = SuccessiveWorkflow(self.profile)
                case _:
                    raise ValueError(f"Unknown model type: {self.profile.model}")
        
        return self._separator_instance

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
        separator = self._get_separator_instance()
        
        # Execute separation (atomic model or workflow)
        if hasattr(separator, 'separate'):
            # Atomic model
            result = separator.separate(input_file, output_folder)
        elif hasattr(separator, 'separate_workflow'):
            # Workflow
            result = separator.separate_workflow(input_file, output_folder)
        else:
            raise RuntimeError(f"Separator {separator} has no separation method")
        
        # Convert result to legacy format for compatibility
        stem_paths = {stem_type.value: path for stem_type, path in result.output_stems.items()}
        metadata = {stem_type.value: meta for stem_type, meta in result.metadata.items()}
        
        return stem_paths, metadata