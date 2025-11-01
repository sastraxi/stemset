"""Modern separation interface using strategy-based architecture."""

from __future__ import annotations
from pathlib import Path

from .config import get_config, OutputConfig
from .models.strategy_executor import StrategyExecutor
from .models.metadata import StemMetadata, StemsMetadata
from .processor.audio_metadata_analyzer import get_metadata_analyzer


class StemSeparator:
    """High-level interface for audio stem separation using strategies."""

    executor: StrategyExecutor

    def __init__(self, profile_name: str, strategy_name: str):
        """Initialize separator for a specific profile.

        Args:
            profile: Profile containing strategy and output configuration
        """
        # Get strategy from config
        config = get_config()
        strategy = config.get_strategy(strategy_name)
        if strategy is None:
            raise ValueError(
                f"Profile '{profile_name}' references unknown strategy '{strategy_name}'"
            )

        # Create executor with strategy and output config
        self.executor = StrategyExecutor(strategy, OutputConfig())

    def separate_and_normalize(
        self, input_file: Path, output_folder: Path
    ) -> tuple[dict[str, Path], dict[str, StemMetadata]]:
        """Separate audio into stems with metadata.

        Args:
            input_file: Path to input WAV file
            output_folder: Path to output folder for stems

        Returns:
            Tuple of (stem_paths, metadata) where:
            - stem_paths: Dict mapping stem name to output file path
            - metadata: Dict mapping stem name to metadata dict with LUFS info

        Raises:
            RuntimeError: If separation fails
        """
        # Execute strategy tree
        stem_paths = self.executor.execute(input_file, output_folder)

        # Generate waveforms and compute LUFS metadata for final stems
        print("Analyzing stem loudness...")
        analyzer = get_metadata_analyzer()
        stems_metadata: StemsMetadata = analyzer.create_stems_metadata(stem_paths, output_folder)

        # Write metadata to JSON file using Pydantic
        metadata_file = output_folder / "metadata.json"
        _ = stems_metadata.to_file(metadata_file)
        print(f"  ✓ Metadata saved to {metadata_file.name}")

        return stem_paths, stems_metadata.stems
