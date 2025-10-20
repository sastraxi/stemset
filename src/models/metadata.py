"""Utilities for audio metadata analysis and stem metadata creation."""

from pathlib import Path
from typing import Any

import pyloudnorm as pyln
import soundfile as sf


from ..config import Profile


class AudioMetadataAnalyzer:
    """Utility class for analyzing audio metadata and creating stem metadata."""
    
    SAMPLE_RATE: int = 44100
    
    def __init__(self):
        """Initialize the metadata analyzer."""
        self.loudness_meter = pyln.Meter(self.SAMPLE_RATE)
    
    def analyze_stem_loudness(self, audio_file: Path) -> float:
        """Analyze the loudness (LUFS) of an audio file.
        
        Args:
            audio_file: Path to the audio file to analyze
            
        Returns:
            Loudness in LUFS
        """
        audio_data, _rate = sf.read(str(audio_file))
        loudness_lufs = self.loudness_meter.integrated_loudness(audio_data)
        return float(loudness_lufs)
    
    def create_stem_metadata(
        self, 
        stem_name: str, 
        audio_file: Path, 
        profile: Profile
    ) -> dict[str, Any]:
        """Create metadata dictionary for a single stem.
        
        Args:
            stem_name: Name of the stem (e.g., "vocals", "drums")
            audio_file: Path to the stem audio file
            profile: Profile configuration
            
        Returns:
            Dictionary containing stem metadata
        """
        # Analyze loudness
        loudness_lufs = self.analyze_stem_loudness(audio_file)
        
        
        # Print loudness info
        print(f"  {stem_name}: {loudness_lufs:.1f} LUFS")
        
        return {
            "stem_type": stem_name,
            "measured_lufs": round(loudness_lufs, 2),
        }
    
    def create_stems_metadata(
        self, 
        stem_paths: dict[str, Path], 
        profile: Profile
    ) -> dict[str, dict[str, Any]]:
        """Create metadata for multiple stems.
        
        Args:
            stem_paths: Dictionary mapping stem names to file paths
            profile: Profile configuration
            
        Returns:
            Dictionary mapping stem names to their metadata
        """
        metadata = {}
        
        for stem_name, audio_file in stem_paths.items():
            metadata[stem_name] = self.create_stem_metadata(stem_name, audio_file, profile)
            
        return metadata


# Global instance for convenience
_analyzer = None

def get_metadata_analyzer() -> AudioMetadataAnalyzer:
    """Get the global metadata analyzer instance."""
    global _analyzer
    if _analyzer is None:
        _analyzer = AudioMetadataAnalyzer()
    return _analyzer