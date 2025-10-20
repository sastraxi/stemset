"""Utilities for audio metadata analysis and stem metadata creation."""

from pathlib import Path

import pyloudnorm as pyln
import soundfile as sf
from pydantic import BaseModel

from ..config import Profile


class StemMetadata(BaseModel):
    """Metadata for a single stem."""

    stem_type: str
    measured_lufs: float


class StemsMetadata(BaseModel):
    """Metadata for all stems in a separation."""

    stems: dict[str, StemMetadata]

    def to_file(self, file_path: Path) -> None:
        """Write metadata to a JSON file."""
        with open(file_path, "w") as f:
            f.write(self.model_dump_json(indent=2))

    @classmethod
    def from_file(cls, file_path: Path) -> "StemsMetadata":
        """Load metadata from a JSON file."""
        with open(file_path, "r") as f:
            return cls.model_validate_json(f.read())


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
    ) -> StemMetadata:
        """Create metadata for a single stem.

        Args:
            stem_name: Name of the stem (e.g., "vocals", "drums")
            audio_file: Path to the stem audio file
            profile: Profile configuration

        Returns:
            StemMetadata model
        """
        # Analyze loudness
        loudness_lufs = self.analyze_stem_loudness(audio_file)

        # Print loudness info
        print(f"  {stem_name}: {loudness_lufs:.1f} LUFS")

        return StemMetadata(
            stem_type=stem_name,
            measured_lufs=round(loudness_lufs, 2),
        )

    def create_stems_metadata(
        self,
        stem_paths: dict[str, Path],
        profile: Profile
    ) -> StemsMetadata:
        """Create metadata for multiple stems.

        Args:
            stem_paths: Dictionary mapping stem names to file paths
            profile: Profile configuration

        Returns:
            StemsMetadata model containing all stem metadata
        """
        stems_dict = {}

        for stem_name, audio_file in stem_paths.items():
            stems_dict[stem_name] = self.create_stem_metadata(stem_name, audio_file, profile)

        return StemsMetadata(stems=stems_dict)


# Global instance for convenience
_analyzer = None

def get_metadata_analyzer() -> AudioMetadataAnalyzer:
    """Get the global metadata analyzer instance."""
    global _analyzer
    if _analyzer is None:
        _analyzer = AudioMetadataAnalyzer()
    return _analyzer