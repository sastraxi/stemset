"""Successive splitting workflow implementation."""

from __future__ import annotations
from pathlib import Path
from dataclasses import dataclass

from .protocols import WorkflowSeparator, SeparationResult, StemType
from .atomic_models import VocalsMelBandRoformerModel, KuielabDrumsModel, KuielabBassModel
from ..config import Profile


@dataclass
class SplitStep:
    """Configuration for a single step in successive splitting."""
    model_class: type
    input_stem: StemType | None  # None means use original input
    description: str


class SuccessiveWorkflow:
    """Workflow for successive splitting: vocals → drums → bass → other."""
    
    WORKFLOW_STEPS = [
        SplitStep(
            model_class=VocalsMelBandRoformerModel,
            input_stem=None,  # Use original input
            description="Extract vocals from mix"
        ),
        SplitStep(
            model_class=KuielabDrumsModel,
            input_stem=StemType.NO_VOCALS,
            description="Extract drums from no-vocals"
        ),
        SplitStep(
            model_class=KuielabBassModel, 
            input_stem=StemType.NO_DRUMS,
            description="Extract bass from remaining audio"
        ),
    ]
    
    def __init__(self, profile: Profile):
        self.profile = profile
        self._models: dict[type, object] = {}
    
    @property
    def workflow_name(self) -> str:
        return "successive"
    
    @property
    def final_stem_types(self) -> list[StemType]:
        return [StemType.VOCALS, StemType.DRUMS, StemType.BASS, StemType.OTHER]
    
    def _get_model(self, model_class: type) -> object:
        """Get or create model instance."""
        if model_class not in self._models:
            self._models[model_class] = model_class(self.profile)
        return self._models[model_class]
    
    def separate_workflow(self, input_file: Path, output_folder: Path) -> SeparationResult:
        """Execute successive splitting workflow."""
        output_folder.mkdir(parents=True, exist_ok=True)
        
        print(f"Starting successive separation of {input_file.name}...")
        
        # Track intermediate files and final stems
        intermediate_stems: dict[StemType, Path] = {}
        final_stems: dict[StemType, Path] = {}
        all_metadata: dict[StemType, dict[str, float]] = {}
        
        current_input = input_file
        
        for step_idx, step in enumerate(self.WORKFLOW_STEPS, 1):
            print(f"  Step {step_idx}: {step.description}")
            
            # Determine input for this step
            if step.input_stem is not None:
                if step.input_stem not in intermediate_stems:
                    raise RuntimeError(f"Missing intermediate stem: {step.input_stem}")
                current_input = intermediate_stems[step.input_stem]
            
            # Create step output directory
            step_output_dir = output_folder / f"step_{step_idx}"
            
            # Get model and run separation
            model = self._get_model(step.model_class)
            step_result = model.separate(current_input, step_output_dir)
            
            # Process step outputs
            for stem_type, stem_path in step_result.output_stems.items():
                if stem_type in self.final_stem_types:
                    # This is a final stem - move to main output folder
                    final_path = output_folder / f"{stem_type.value}.{self.profile.output_format}"
                    stem_path.rename(final_path)
                    final_stems[stem_type] = final_path
                    all_metadata[stem_type] = step_result.metadata[stem_type]
                    print(f"    → Final stem: {stem_type.value}")
                else:
                    # This is an intermediate stem for next step
                    intermediate_stems[stem_type] = stem_path
                    print(f"    → Intermediate: {stem_type.value}")
            
            # Clean up empty step directory
            if step_output_dir.exists() and not any(step_output_dir.iterdir()):
                step_output_dir.rmdir()
        
        # Verify we got all expected final stems
        missing = set(self.final_stem_types) - set(final_stems.keys())
        if missing:
            raise RuntimeError(f"Successive workflow incomplete: missing final stems {missing}")
        
        print(f"  ✓ Success! Created {len(final_stems)} stems via successive splitting")
        
        return SeparationResult(
            input_file=input_file,
            output_stems=final_stems,
            metadata=all_metadata,
            model_used=self.workflow_name
        )