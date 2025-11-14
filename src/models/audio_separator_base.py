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

    def get_output_slots(self) -> set[str]:
        """Get actual output slot names from audio-separator model registry.

        Returns:
            Set of output slot names this model produces

        Raises:
            ValueError: If model not found in registry
        """
        separator = self._get_separator()
        model_list = separator.get_simplified_model_list()

        if self.model_filename not in model_list:
            raise ValueError(
                f"Model '{self.model_filename}' not found in audio-separator model list"
            )

        return set(model_list[self.model_filename]["SDR"].keys())

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

    def _log_model_outputs(self, separator: Separator) -> None:
        """Log the model's output slots after loading.

        Args:
            separator: Loaded separator instance
        """
        model_list = separator.get_simplified_model_list()
        model_info = model_list[self.model_filename]
        actual_outputs = sorted(model_info["SDR"].keys())
        print(f"Model outputs: {actual_outputs}")

    def _get_separator(self) -> Separator:
        """Get or create audio separator instance with configured output format."""
        if self._separator is None:
            import os

            # Get model cache directory from env or use default
            model_cache = os.getenv("STEMSET_MODEL_CACHE_DIR")
            if model_cache:
                model_file_dir = Path(model_cache)
            else:
                model_file_dir = Path.home() / ".stemset" / "models"

            # Note: PyTorch thread limits are set in processor/core.py before this is called

            # Configure output format
            output_format = self.output_config.format.value.upper()
            output_bitrate = f"{self.output_config.bitrate}k" if output_format == "OPUS" else None

            self._separator = Separator(
                log_level=20,  # INFO level
                model_file_dir=str(model_file_dir),
                output_format=output_format,
                output_bitrate=output_bitrate,
                normalization_threshold=0.9,  # Prevent clipping
            )

        return self._separator


class NeuralAudioSeparator(AudioSeparator, ABC):
    """Base class for custom/neural separation models.

    Unlike AudioSeparatorLibraryModel which wraps the audio-separator library,
    this allows integration of arbitrary separation approaches: PyTorch models,
    classical DSP algorithms, external APIs, etc.

    Subclasses must implement:
    - model_filename: Identifier for this separator (may not be an actual file)
    - output_slots: Dict mapping output slot names to human descriptions
    - separate: Perform separation and return paths to output stems
    """

    def __init__(self, output_config: OutputConfig) -> None:
        """Initialize with output configuration.

        Args:
            output_config: Output format and bitrate settings
        """
        super().__init__(output_config)
        self.output_config = output_config

    @property
    @abstractmethod
    def model_filename(self) -> str:
        """Identifier for this separator (may not be an actual file).

        Returns:
            Model identifier string
        """
        ...

    @property
    @abstractmethod
    def output_slots(self) -> dict[str, str]:
        """Map of output slot names to human descriptions.

        Returns:
            Dict mapping slot_name -> description
        """
        ...

    def get_output_slots(self) -> set[str]:
        """Get output slot names from the model's output_slots property.

        Returns:
            Set of output slot names this model produces
        """
        return set(self.output_slots.keys())

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

            # Log model outputs for debugging
            self._log_model_outputs(separator)

            output_format = self.output_config.format.value.upper()
            output_bitrate = f"{self.output_config.bitrate}k" if output_format == "OPUS" else None
            print(
                f"Model '{self.model_filename}' loaded (output: {output_format}"
                + (f" @ {output_bitrate})" if output_bitrate else ")")
            )

        # Set output directory - model_instance can be None initially but set after load_model
        if separator.model_instance is not None:
            separator.model_instance.output_dir = str(output_dir.absolute())  # type: ignore[attr-defined]

        print(f"Separating {input_file.name} with {self.model_filename}...")

        # Get actual model outputs from audio-separator
        model_list = separator.get_simplified_model_list()
        actual_outputs = list(model_list[self.model_filename]["SDR"].keys())

        # Build custom output names - keep model output names as-is
        custom_output_names = {output_name: output_name for output_name in actual_outputs}

        # Perform separation
        output_files: list[str] = separator.separate(
            str(input_file), custom_output_names=custom_output_names
        )  # type: ignore[assignment]

        # Map output files to slots
        output_paths: dict[str, Path] = {}
        for output_file_str in output_files:
            output_file = output_dir / output_file_str
            slot_name = output_file.stem
            output_paths[slot_name] = output_file

        return output_paths
