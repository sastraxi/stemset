"""Strategy tree execution engine for successive separation workflows."""

from __future__ import annotations
from pathlib import Path
import tempfile
import shutil

from ..config import AudioFormat, Strategy, StrategyNode, OutputConfig
from .registry import get_model_class
from .audio_separator_base import AudioSeparator


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
                node=self.strategy.root,
                input_file=input_file,
                current_step=0
            )

            # Move final outputs to destination with correct format
            final_paths: dict[str, Path] = {}
            for stem_name, temp_path in final_outputs.items():
                # Use configured output format extension
                dest_path = output_dir / f"{stem_name}.{self.output_config.format.value}"
                _ = shutil.move(str(temp_path), str(dest_path))
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
        self,
        node: StrategyNode,
        input_file: Path,
        current_step: int
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
        model = self._get_model_instance(node.model)

        # Validate output slots match config
        expected_slots = set(model.output_slots.keys())
        actual_slots = set(node.outputs.keys())
        if expected_slots != actual_slots:
            raise ValueError(
                f"Model '{node.model}' output mismatch. " +
                f"Expected slots: {expected_slots}, " +
                f"Config specifies: {actual_slots}"
            )

        # Create step-specific temp directory
        assert self._temp_dir is not None
        step_dir = self._temp_dir / f"step_{step_num}"
        step_dir.mkdir(parents=True, exist_ok=True)

        # For intermediate steps, always use WAV format (lossless)
        # Only final outputs use the configured format
        # We'll temporarily override output_config for intermediate separators
        is_root = current_step == 0
        if not is_root:
            # Create a temporary WAV config for intermediates
            from ..config import OutputConfig
            temp_output_config = OutputConfig(format=AudioFormat.WAV, bitrate=self.output_config.bitrate)
            # Re-instantiate model with WAV output for intermediates
            model = self._create_model_instance(node.model, temp_output_config)

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
                    node=child_node,
                    input_file=slot_path,
                    current_step=step_num
                )

                # Merge child outputs into final outputs
                final_outputs.update(child_outputs)

        return final_outputs

    def _get_model_instance(self, model_name: str) -> AudioSeparator:
        """Get or create cached model instance."""
        if model_name not in self._model_instances:
            self._model_instances[model_name] = self._create_model_instance(
                model_name, self.output_config
            )
        return self._model_instances[model_name]

    def _create_model_instance(self, model_name: str, output_config: OutputConfig) -> AudioSeparator:
        """Create a new model instance with given output config."""
        model_class = get_model_class(model_name)
        return model_class(output_config)
