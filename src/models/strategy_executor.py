"""Strategy tree execution engine for successive separation workflows."""

from __future__ import annotations

import shutil
import tempfile
from pathlib import Path
from typing import Any

from ..config import AudioFormat, OutputConfig, Strategy, StrategyNode
from .audio_separator_base import AudioSeparator
from .registry import get_model_class


class StrategyExecutor:
    """Executes a separation strategy tree to produce final outputs."""

    strategy: Strategy
    output_config: OutputConfig
    _temp_dir: Path | None
    _model_instances: dict[str, AudioSeparator]

    def __init__(self, strategy: Strategy, output_config: OutputConfig):
        """Initialize executor with strategy and output configuration.

        Args:
            strategy: The separation strategy to execute
            output_config: Output format and bitrate for final stems
        """
        self.strategy = strategy
        self.output_config = output_config
        self._temp_dir = None
        self._model_instances = {}

    def execute(self, input_file: Path, output_dir: Path) -> dict[str, Path]:
        """Execute the strategy tree and return final output paths.

        Args:
            input_file: Input audio file to separate
            output_dir: Directory for final output files

        Returns:
            Dict mapping final stem names to output file paths

        Raises:
            RuntimeError: If separation fails or expected outputs missing
        """
        output_dir.mkdir(parents=True, exist_ok=True)

        # Create temporary directory for intermediates
        self._temp_dir = Path(tempfile.mkdtemp(prefix="stemset_"))

        try:
            print(f"Executing strategy '{self.strategy.name}' on {input_file.name}...")

            # Execute tree starting from root with original input
            final_outputs = self._execute_node(
                node=self.strategy.root, input_file=input_file, current_step=0
            )

            # Convert and move final outputs to destination with correct format
            final_paths: dict[str, Path] = {}
            for stem_name, temp_path in final_outputs.items():
                dest_path = output_dir / f"{stem_name}.{self.output_config.format.value}"

                # If the temp file is already in the target format, just move it
                if temp_path.suffix == f".{self.output_config.format.value}":
                    _ = shutil.move(str(temp_path), str(dest_path))
                else:
                    # Convert from WAV to target format using audio-separator
                    _ = self.output_config.convert(temp_path, dest_path)
                    temp_path.unlink()  # Clean up temp WAV file

                final_paths[stem_name] = dest_path
                print(f"  → Final stem: {stem_name} ({dest_path.name})")

            print(f"  ✓ Strategy complete! Produced {len(final_paths)} stems")

            return final_paths

        finally:
            # Clean up temporary directory
            if self._temp_dir and self._temp_dir.exists():
                shutil.rmtree(self._temp_dir)
                self._temp_dir = None

    def _execute_node(
        self, node: StrategyNode, input_file: Path, current_step: int
    ) -> dict[str, Path]:
        """Recursively execute a strategy node.

        Args:
            node: Strategy node to execute
            input_file: Input file for this node
            current_step: Current step number for logging

        Returns:
            Dict mapping final stem names to their paths (may include intermediates)
        """
        step_num = current_step + 1
        print(f"  Step {step_num}: Model '{node.model}' on {input_file.name}")

        # Get or create model instance
        model = self._get_model_instance(node.model, node.params)

        # Validate config keys match actual model output slots
        model_output_slots = model.get_output_slots()
        configured_slots = set(node.outputs.keys())
        if model_output_slots < configured_slots:
            raise ValueError(
                f"Model '{node.model}' output mismatch. "
                + f"Model produces: {sorted(model_output_slots)}, "
                + f"Config maps: {sorted(configured_slots)}"
            )

        # Create step-specific temp directory
        assert self._temp_dir is not None
        step_dir = self._temp_dir / f"step_{step_num}"
        step_dir.mkdir(parents=True, exist_ok=True)

        # Always use WAV format for all intermediate processing to maintain quality
        # Format conversion to the configured format (e.g., opus) happens at the very end
        temp_output_config = OutputConfig(
            format=AudioFormat.WAV, bitrate=self.output_config.bitrate
        )
        # Always use WAV for separation to ensure lossless intermediates
        model = self._create_model_instance(node.model, temp_output_config, node.params)

        # Execute separation
        slot_outputs = model.separate(input_file, step_dir)

        # Process outputs: either final stems or inputs for child nodes
        final_outputs: dict[str, Path] = {}

        for slot_name, slot_value in node.outputs.items():
            slot_path = slot_outputs[slot_name]

            if isinstance(slot_value, str):
                # Leaf node: this is a final output with the given name
                final_outputs[slot_value] = slot_path
                print(f"    → Final: {slot_name} → {slot_value}")

            else:
                # Subtree: recursively process child node
                child_node = slot_value
                print(f"    → Intermediate: {slot_name} → continue to '{child_node.model}'")

                # Recursively execute child node
                child_outputs = self._execute_node(
                    node=child_node, input_file=slot_path, current_step=step_num
                )

                # Merge child outputs into final outputs
                final_outputs.update(child_outputs)

        return final_outputs

    def _get_model_instance(
        self, model_name: str, params: dict[str, Any] | None = None
    ) -> AudioSeparator:
        """Get or create cached model instance."""
        if params is None:
            params = {}
        # Create a cache key that includes params to avoid conflicts
        cache_key = f"{model_name}:{hash(frozenset(params.items()))}"
        if cache_key not in self._model_instances:
            self._model_instances[cache_key] = self._create_model_instance(
                model_name, self.output_config, params
            )
        return self._model_instances[cache_key]

    def _create_model_instance(
        self, model_name: str, output_config: OutputConfig, params: dict[str, Any] | None = None
    ) -> AudioSeparator:
        """Create a new model instance with given output config and parameters."""
        if params is None:
            params = {}
        model_class = get_model_class(model_name)
        return model_class(output_config, **params)
