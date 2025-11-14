"""Modern separation interface using strategy-based architecture."""

from __future__ import annotations

import asyncio
from pathlib import Path

from .config import AudioFormat, OutputConfig, get_config
from .models.metadata import StemsMetadata
from .models.strategy_executor import StrategyExecutor
from .processor.audio_metadata_analyzer import get_metadata_analyzer

LOSSLESS_OUTPUT_CONFIG = OutputConfig(format=AudioFormat.WAV)


class StemSeparator:
    """High-level interface for audio stem separation using strategies."""

    executor: StrategyExecutor
    output_config: OutputConfig

    def __init__(self, profile_name: str, strategy_name: str, output_config: OutputConfig):
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

        # StrategyExecutor uses an intermediate WAV format for separation so that we can
        # analyze LUFS and generate waveforms with soundfile no matter the output format
        self.executor = StrategyExecutor(strategy, LOSSLESS_OUTPUT_CONFIG)
        self.output_config = output_config

    async def separate_and_normalize(
        self,
        input_file: Path,
        output_folder: Path,
        delete_intermediates: bool = True,
        duration: float | None = None,
    ) -> StemsMetadata:
        """Separate audio into stems with metadata asynchronously.

        Args:
            input_file: Path to input WAV file
            output_folder: Path to output folder for stems

        Returns:
            StemsMetadata object containing all stem information (LUFS, paths, etc.)
            Caller is responsible for saving to database - no JSON files written.

        Raises:
            RuntimeError: If separation fails
        """
        return await asyncio.to_thread(
            self._separate_and_normalize_sync,
            input_file,
            output_folder,
            delete_intermediates,
            duration,
        )

    def _separate_and_normalize_sync(
        self,
        input_file: Path,
        output_folder: Path,
        delete_intermediates: bool = True,
        duration: float | None = None,
    ) -> StemsMetadata:
        """Synchronous core logic for audio separation.

        This method contains the CPU-bound operations and is intended to be run
        in a separate thread via asyncio.to_thread.
        """
        # Execute strategy tree
        stem_paths = self.executor.execute(input_file, output_folder)

        # Generate waveforms and compute LUFS metadata for final stems
        print("Analyzing stem loudness...")
        analyzer = get_metadata_analyzer()
        stems_metadata: StemsMetadata = analyzer.create_stems_metadata(
            stem_paths, output_folder, duration=duration
        )

        print(f"  ✓ Metadata analysis complete ({len(stems_metadata.stems)} stems)")

        # Now convert to the desired output format if needed
        if self.output_config.format != LOSSLESS_OUTPUT_CONFIG.format:
            print(f"Converting stems to {self.output_config.format.value} format...")
            for stem_name, stem_meta in stems_metadata.stems.items():
                source_path = output_folder / stem_meta.stem_url
                dest_path = output_folder / f"{stem_name}.{self.output_config.format.value.lower()}"

                _ = self.output_config.convert(source_path, dest_path)

                # Update metadata to point to new file
                stem_meta.stem_url = dest_path.name
                if delete_intermediates:
                    source_path.unlink(missing_ok=True)

            print("  ✓ Format conversion complete.")

        return stems_metadata
