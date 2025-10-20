"""Abstract base class for audio separation models."""

from __future__ import annotations
from pathlib import Path
from abc import ABC, abstractmethod
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from ..config import OutputConfig

from audio_separator.separator import Separator


class AudioSeparator(ABC):
    """Abstract base class for audio separation models.

    All separator models must implement:
    - output_slots: dict mapping slot names to descriptions
    - model_filename: the model file to load
    - separate: perform separation and return paths
    """

    output_config: OutputConfig
    _separator: Separator | None
    _model_loaded: bool

    def __init__(self, output_config: OutputConfig):
        """Initialize with output configuration.

        Args:
            output_config: Output format and bitrate settings
        """
        self.output_config = output_config
        self._separator = None
        self._model_loaded = False

    @property
    @abstractmethod
    def output_slots(self) -> dict[str, str]:
        """Get output slot names and descriptions.

        Returns:
            Dict mapping slot_name -> description

        Example:
            {"vocals": "Vocal track", "no_vocals": "Instrumental track"}
        """
        ...

    @property
    @abstractmethod
    def model_filename(self) -> str:
        """Get the model filename to load.

        Returns:
            Model filename (e.g., "htdemucs_ft.yaml", "kuielab_b_drums.onnx")
        """
        ...

    @abstractmethod
    def separate(self, input_file: Path, output_dir: Path) -> dict[str, Path]:
        """Perform audio separation.

        Args:
            input_file: Input audio file path
            output_dir: Directory to write output files

        Returns:
            Dict mapping slot_name -> output_file_path

        Raises:
            RuntimeError: If separation fails or outputs are missing
        """
        ...

    def _get_separator(self) -> Separator:
        """Get or create audio separator instance with configured output format."""
        if self._separator is None:
            import torch
            import os

            # Get model cache directory from env or use default
            model_cache = os.getenv("STEMSET_MODEL_CACHE_DIR")
            if model_cache:
                model_file_dir = Path(model_cache)
            else:
                model_file_dir = Path.home() / ".stemset" / "models"

            # Limit CPU threads to keep system responsive
            cpu_count = os.cpu_count() or 4
            thread_override = os.getenv("TORCH_NUM_THREADS")
            if thread_override:
                thread_count = int(thread_override)
            else:
                thread_count = max(1, cpu_count // 2)

            torch.set_num_threads(thread_count)
            torch.set_num_interop_threads(thread_count)
            print(f"Limited PyTorch to {thread_count} threads (of {cpu_count} available)")

            # Configure output format
            output_format = self.output_config.format.upper()
            output_bitrate = f"{self.output_config.bitrate}k" if output_format == "OPUS" else None

            self._separator = Separator(
                log_level=20,  # INFO level
                model_file_dir=str(model_file_dir),
                output_format=output_format,
                output_bitrate=output_bitrate,
                normalization_threshold=0.9,  # Prevent clipping
            )

        return self._separator


class AudioSeparatorLibraryModel(AudioSeparator, ABC):
    """Base implementation for models using audio-separator library directly.

    Subclasses only need to define output_slots and model_filename.
    """

    def separate(self, input_file: Path, output_dir: Path) -> dict[str, Path]:
        """Perform separation using audio-separator library."""
        output_dir.mkdir(parents=True, exist_ok=True)

        # Get separator and load model if needed
        separator = self._get_separator()
        if not self._model_loaded:
            separator.load_model(self.model_filename)
            self._model_loaded = True

            output_format = self.output_config.format.upper()
            output_bitrate = f"{self.output_config.bitrate}k" if output_format == "OPUS" else None
            print(f"Model '{self.model_filename}' loaded (output: {output_format}" +
                  (f" @ {output_bitrate})" if output_bitrate else ")"))

        # Set output directory - model_instance can be None initially but set after load_model
        if separator.model_instance is not None:
            separator.model_instance.output_dir = str(output_dir.absolute())  # type: ignore[attr-defined]

        print(f"Separating {input_file.name} with {self.model_filename}...")

        # Build custom output names matching our slot names
        custom_output_names = {slot_name: slot_name for slot_name in self.output_slots.keys()}

        # Perform separation
        output_files: list[str] = separator.separate(str(input_file), custom_output_names=custom_output_names)  # type: ignore[assignment]

        # Map output files to slots
        output_paths: dict[str, Path] = {}
        for output_file_str in output_files:
            output_file = output_dir / output_file_str
            slot_name = output_file.stem
            if slot_name in self.output_slots:
                output_paths[slot_name] = output_file

        # Verify we got all expected outputs
        expected_slots = set(self.output_slots.keys())
        missing = expected_slots - set(output_paths.keys())
        if missing:
            raise RuntimeError(
                f"Model '{self.model_filename}' separation incomplete: missing outputs {missing}"
            )

        return output_paths
