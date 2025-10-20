"""Redesigned separation protocols for flexible workflow support."""

from __future__ import annotations
from abc import abstractmethod
from pathlib import Path
from typing import Protocol, runtime_checkable
from dataclasses import dataclass
from enum import Enum


class StemType(str, Enum):
    """Standardized stem types for separation."""
    VOCALS = "vocals"
    DRUMS = "drums" 
    BASS = "bass"
    OTHER = "other"
    # Intermediate types for successive splitting
    NO_VOCALS = "no_vocals"
    NO_DRUMS = "no_drums"
    INSTRUMENTAL = "instrumental"


@dataclass(frozen=True)
class SeparationResult:
    """Result of a single separation operation."""
    input_file: Path
    output_stems: dict[StemType, Path]
    metadata: dict[StemType, dict[str, float]]
    model_used: str
    
    def get_stem_path(self, stem_type: StemType) -> Path | None:
        """Get path for a specific stem type."""
        return self.output_stems.get(stem_type)
    
    def has_stem(self, stem_type: StemType) -> bool:
        """Check if result contains a specific stem."""
        return stem_type in self.output_stems


@runtime_checkable
class AtomicSeparatorModel(Protocol):
    """Protocol for atomic separation models (single operation)."""
    
    @property
    @abstractmethod
    def model_name(self) -> str:
        """Get the model identifier."""
        ...
    
    @property 
    @abstractmethod
    def output_stem_types(self) -> list[StemType]:
        """Get the stem types this model outputs."""
        ...
    
    @abstractmethod
    def separate(self, input_file: Path, output_folder: Path) -> SeparationResult:
        """Perform atomic separation operation.
        
        Args:
            input_file: Input audio file
            output_folder: Directory for output files
            
        Returns:
            SeparationResult with stem paths and metadata
        """
        ...


@runtime_checkable  
class WorkflowSeparator(Protocol):
    """Protocol for multi-step separation workflows."""
    
    @property
    @abstractmethod
    def workflow_name(self) -> str:
        """Get the workflow identifier."""
        ...
    
    @property
    @abstractmethod 
    def final_stem_types(self) -> list[StemType]:
        """Get the final stem types this workflow produces."""
        ...
    
    @abstractmethod
    def separate_workflow(self, input_file: Path, output_folder: Path) -> SeparationResult:
        """Execute complete separation workflow.
        
        Args:
            input_file: Input audio file
            output_folder: Directory for output files
            
        Returns:
            SeparationResult with final stems and aggregated metadata
        """
        ...


# Type alias for any separator
AnySeparator = AtomicSeparatorModel | WorkflowSeparator