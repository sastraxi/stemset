"""Shared base implementation for audio-separator based models."""

from __future__ import annotations
from pathlib import Path
from abc import abstractmethod

from audio_separator.separator import Separator

from .protocols import AtomicSeparatorModel, SeparationResult, StemType
from .metadata import get_metadata_analyzer
from ..config import Profile


class AudioSeparatorBase:
    """Base class for models using the audio-separator library."""
    
    def __init__(self, profile: Profile):
        """Initialize with profile configuration."""
        self.profile = profile
        self._separator: Separator | None = None
    
    def _get_separator(self) -> Separator:
        """Get or create audio separator instance."""
        if self._separator is None:
            import torch
            import os

            # Limit CPU threads to be nice to interactive processes
            cpu_count = os.cpu_count() or 4
            thread_count = max(1, cpu_count - 2)
            torch.set_num_threads(thread_count)
            torch.set_num_interop_threads(thread_count)
            print(f"Limited PyTorch to {thread_count} threads (of {cpu_count} available)")

            # Determine output format and bitrate
            output_format = self.profile.output_format.upper()
            output_bitrate = f"{self.profile.opus_bitrate}k" if output_format == "OPUS" else None

            self._separator = Separator(
                log_level=20,  # INFO level
                model_file_dir=str(Path.home() / ".stemset" / "models"),
                output_format=output_format,
                output_bitrate=output_bitrate,
                normalization_threshold=0.9,  # Prevent clipping
            )
        
        return self._separator
    
    @abstractmethod
    def _get_model_filename(self) -> str:
        """Get the model filename to load."""
        ...
    
    @abstractmethod 
    def _get_output_stem_mapping(self) -> dict[str, StemType]:
        """Get mapping from audio-separator output names to StemType."""
        ...
    
    def separate(self, input_file: Path, output_folder: Path) -> SeparationResult:
        """Perform separation using audio-separator."""
        output_folder.mkdir(parents=True, exist_ok=True)
        
        # Get separator and load model
        separator = self._get_separator()
        if not hasattr(separator, '_model_loaded') or not separator._model_loaded:
            separator.load_model(self._get_model_filename())
            separator._model_loaded = True
            
            output_format = self.profile.output_format.upper()
            output_bitrate = f"{self.profile.opus_bitrate}k" if output_format == "OPUS" else None
            print(f"{self.model_name} model loaded (output: {output_format}" +
                  (f" @ {output_bitrate})" if output_bitrate else ")"))
        
        # Set output directory
        separator.model_instance.output_dir = str(output_folder.absolute())
        
        print(f"Separating {input_file.name} with {self.model_name}...")
        
        # Build custom output names to avoid underscores
        stem_mapping = self._get_output_stem_mapping()
        custom_output_names = {
            stem_name: stem_name 
            for stem_name in stem_mapping.keys()
        }
        
        # Perform separation
        output_files = separator.separate(str(input_file), custom_output_names=custom_output_names)
        
        # Map output files to stem types
        output_stems: dict[StemType, Path] = {}
        for output_file_str in output_files:
            output_file = output_folder / output_file_str
            stem_name = output_file.stem
            if stem_name in stem_mapping:
                stem_type = stem_mapping[stem_name]
                output_stems[stem_type] = output_file
        
        # Verify we got expected outputs
        expected_stems = set(stem_mapping.values())
        missing = expected_stems - set(output_stems.keys())
        if missing:
            raise RuntimeError(f"{self.model_name} separation incomplete: missing stems {missing}")
        
        # Analyze metadata
        analyzer = get_metadata_analyzer()
        stem_paths_for_analysis = {stem.value: path for stem, path in output_stems.items()}
        raw_metadata = analyzer.create_stems_metadata(stem_paths_for_analysis, self.profile)
        
        # Convert metadata keys to StemType
        metadata: dict[StemType, dict[str, float]] = {}
        for stem_name, stem_meta in raw_metadata.items():
            stem_type = StemType(stem_name)
            metadata[stem_type] = stem_meta
        
        return SeparationResult(
            input_file=input_file,
            output_stems=output_stems,
            metadata=metadata,
            model_used=self.model_name
        )