"""Base protocol and common utilities for separator models."""

from abc import abstractmethod
from pathlib import Path
from typing import Protocol, runtime_checkable

from audio_separator.separator import Separator

from ..config import Profile


@runtime_checkable
class SeparatorModel(Protocol):
    """Protocol for stem separation models."""
    
    @abstractmethod
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
        ...


class BaseModelSeparator:
    """Base class with common functionality for all separator models."""
    
    SAMPLE_RATE: int = 44100
    
    def __init__(self, profile: Profile):
        """Initialize separator for a specific profile.

        Args:
            profile: The profile configuration to use
        """
        self.profile = profile
        self.separator = None

    def _setup_separator(self) -> Separator:
        """Create and configure the audio separator with common settings."""
        import torch
        import os

        # Limit CPU threads to be nice to interactive processes
        cpu_count = os.cpu_count() or 4
        thread_count = max(1, cpu_count // 2)
        torch.set_num_threads(thread_count)
        torch.set_num_interop_threads(thread_count)
        print(f"Limited PyTorch to {thread_count} threads (of {cpu_count} available)")

        # Determine output format and bitrate
        output_format = self.profile.output_format.upper()
        output_bitrate = f"{self.profile.opus_bitrate}k" if output_format == "OPUS" else None

        return Separator(
            log_level=20,  # INFO level
            model_file_dir=str(Path.home() / ".stemset" / "models"),
            output_format=output_format,
            output_bitrate=output_bitrate,
            normalization_threshold=0.9,  # Prevent clipping
        )

    def _analyze_and_collect_metadata(self, stem_paths: dict[str, Path]) -> dict[str, dict]:
        """Analyze loudness and collect metadata for stems."""
        from .metadata import get_metadata_analyzer
        
        analyzer = get_metadata_analyzer()
        return analyzer.create_stems_metadata(stem_paths, self.profile)