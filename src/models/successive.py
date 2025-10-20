"""Successive splitting model implementation for experimental 4-stem separation."""

from pathlib import Path
from typing import Any

from .base import BaseModelSeparator


class SuccessiveModelSeparator(BaseModelSeparator):
    """Successive splitting using multiple specialized models."""
    
    STEM_NAMES = ["vocals", "drums", "bass", "other"]
    
    # Model sequence for successive splitting
    SPLIT_SEQUENCE = [
        {
            "model": "vocals_mel_band_roformer.ckpt",
            "splits": ["vocals", "no_vocals"],
            "description": "Extract vocals from mix"
        },
        {
            "model": "kuielab_b_drums.onnx", 
            "input_stem": "no_vocals",
            "splits": ["drums", "no_drums"],
            "description": "Extract drums from no-vocals"
        },
        {
            "model": "kuielab_a_bass.onnx",
            "input_stem": "no_drums", 
            "splits": ["bass", "other"],
            "description": "Extract bass from remaining audio"
        }
    ]
    
    def __init__(self, profile: "Profile"):
        """Initialize successive separator."""
        super().__init__(profile)
        self.separators: dict[str, Any] = {}
        
    def _ensure_separator_loaded(self, model_name: str) -> Any:
        """Lazy load a specific separator model."""
        if model_name not in self.separators:
            separator = self._setup_separator()
            separator.load_model(model_filename=model_name)
            self.separators[model_name] = separator
            print(f"Loaded model: {model_name}")
        return self.separators[model_name]

    def separate_and_normalize(self, input_file: Path, output_folder: Path) -> tuple[dict[str, Path], dict[str, dict]]:
        """Separate audio using successive splitting approach."""
        output_folder.mkdir(parents=True, exist_ok=True)
        
        print(f"Starting successive separation of {input_file.name}...")
        
        # Track intermediate files and final stems
        intermediate_files: dict[str, Path] = {"original": input_file}
        final_stems: dict[str, Path] = {}
        
        # Process each step in the sequence
        for step_idx, step in enumerate(self.SPLIT_SEQUENCE, 1):
            model_name = step["model"]
            splits = step["splits"]
            description = step["description"]
            
            print(f"  Step {step_idx}: {description} using {model_name}")
            
            # Determine input file for this step
            if step_idx == 1:
                # First step uses original input
                input_for_step = input_file
            else:
                # Subsequent steps use intermediate file
                input_stem_name = step["input_stem"]
                if input_stem_name not in intermediate_files:
                    raise RuntimeError(f"Missing intermediate file: {input_stem_name}")
                input_for_step = intermediate_files[input_stem_name]
            
            # Create temporary output directory for this step
            step_output_dir = output_folder / f"step_{step_idx}"
            step_output_dir.mkdir(exist_ok=True)
            
            # Load and run separator for this step
            separator = self._ensure_separator_loaded(model_name)
            separator_output = separator.separate(str(input_for_step))
            
            # Find and organize the output files from this step
            step_files = self._collect_step_outputs(input_for_step, step_output_dir, splits)
            
            # Categorize outputs as final stems or intermediate files
            for split_name, file_path in step_files.items():
                if split_name in self.STEM_NAMES:
                    # This is a final stem
                    final_stem_path = output_folder / f"{split_name}.{self.profile.output_format}"
                    file_path.rename(final_stem_path)
                    final_stems[split_name] = final_stem_path
                    print(f"    → Final stem: {split_name}")
                else:
                    # This is an intermediate file for next step
                    intermediate_files[split_name] = file_path
                    print(f"    → Intermediate: {split_name}")
            
            # Clean up step directory if it's empty
            if not any(step_output_dir.iterdir()):
                step_output_dir.rmdir()
        
        # Verify we got all expected stems
        missing = set(self.STEM_NAMES) - set(final_stems.keys())
        if missing:
            raise RuntimeError(f"Successive separation incomplete: missing stems {missing}")
            
        print(f"  ✓ Success! Created {len(final_stems)} stems via successive splitting")

        # Analyze and collect metadata
        stem_metadata = self._analyze_and_collect_metadata(final_stems)

        return final_stems, stem_metadata
    
    def _collect_step_outputs(
        self, 
        input_file: Path, 
        step_output_dir: Path, 
        expected_splits: list[str]
    ) -> dict[str, Path]:
        """Collect and organize output files from a separation step."""
        step_files = {}
        
        # Look for files in the step output directory and current working directory
        search_dirs = [step_output_dir, Path.cwd()]
        
        for split_name in expected_splits:
            found = False
            
            for search_dir in search_dirs:
                # Try different naming patterns that audio-separator might use
                patterns = [
                    f"{input_file.stem}_{split_name}.{self.profile.output_format}",
                    f"{input_file.stem}_{split_name}.wav",  # Fallback to WAV
                    f"{split_name}.{self.profile.output_format}",
                ]
                
                for pattern in patterns:
                    candidate_file = search_dir / pattern
                    if candidate_file.exists():
                        # Move to step directory with standardized name
                        target_path = step_output_dir / f"{split_name}.{self.profile.output_format}"
                        if candidate_file != target_path:
                            candidate_file.rename(target_path)
                        step_files[split_name] = target_path
                        found = True
                        break
                
                if found:
                    break
            
            if not found:
                raise RuntimeError(f"Could not find output file for split: {split_name}")
        
        return step_files