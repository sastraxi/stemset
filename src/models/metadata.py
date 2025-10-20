"""Utilities for audio metadata analysis and stem metadata creation."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pyloudnorm as pyln
import soundfile as sf
from PIL import Image, ImageDraw
from pydantic import BaseModel

from ..config import Profile


class StemMetadata(BaseModel):
    """Metadata for a single stem."""

    stem_type: str
    measured_lufs: float
    waveform_url: str


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


class WaveformGenerator:
    """Generates grayscale PNG waveform visualizations for audio stems.

    Waveforms are rendered in grayscale so the frontend can apply color via CSS filters
    or canvas compositing operations.
    """

    DEFAULT_WIDTH: int = 1920
    DEFAULT_HEIGHT: int = 256

    def _compute_waveform_data(self, audio_path: Path, target_width: int) -> np.ndarray:
        """Compute min/max envelope for waveform visualization.

        Args:
            audio_path: Path to audio file
            target_width: Number of horizontal pixels (samples per pixel computed automatically)

        Returns:
            Array of shape (target_width, 2) with (min, max) values per pixel
        """
        audio, _sr = sf.read(str(audio_path))

        # Convert to mono if stereo
        if len(audio.shape) > 1:
            audio = np.mean(audio, axis=1)

        # Compute samples per pixel
        total_samples = len(audio)
        samples_per_pixel = max(1, total_samples // target_width)

        # Truncate to exact multiple
        truncated_length = samples_per_pixel * target_width
        audio = audio[:truncated_length]

        # Reshape into blocks
        blocks = audio.reshape(target_width, samples_per_pixel)

        # Compute min/max for each block (captures peaks for smooth waveform)
        waveform_data = np.column_stack([
            np.min(blocks, axis=1),
            np.max(blocks, axis=1)
        ])

        return waveform_data

    def _render_grayscale_png(
        self,
        waveform_data: np.ndarray,
        output_path: Path,
        width: int,
        height: int
    ) -> None:
        """Render waveform as grayscale PNG with transparency.

        The waveform is rendered as white on transparent background.
        Frontend can apply color via CSS filters or canvas operations.

        Args:
            waveform_data: Array of (min, max) values per pixel
            output_path: Where to save the PNG
            width: Image width in pixels
            height: Image height in pixels
        """
        # Create transparent image
        img = Image.new('RGBA', (width, height), (0, 0, 0, 0))
        draw = ImageDraw.Draw(img, 'RGBA')

        # Normalize to pixel coordinates
        center_y = height // 2
        scale = height / 2

        # Draw waveform in white (frontend will apply color)
        for x in range(width):
            min_val, max_val = waveform_data[x]

            # Convert to pixel coordinates
            y_min = int(center_y - (min_val * scale))
            y_max = int(center_y - (max_val * scale))

            # Draw vertical line for this pixel column
            # White with full opacity - frontend applies color
            draw.line([(x, y_min), (x, y_max)], fill=(255, 255, 255, 255), width=1)

        # Save with PNG optimization
        img.save(output_path, 'PNG', optimize=True)

    def generate_for_stem(
        self,
        audio_path: Path,
        output_path: Path,
        width: int = DEFAULT_WIDTH,
        height: int = DEFAULT_HEIGHT
    ) -> None:
        """Generate grayscale waveform PNG for a single stem.

        Args:
            audio_path: Path to stem audio file
            output_path: Path where PNG will be saved
            width: Image width in pixels (default: 1920)
            height: Image height in pixels (default: 256)
        """
        waveform_data = self._compute_waveform_data(audio_path, width)
        self._render_grayscale_png(waveform_data, output_path, width, height)


class AudioMetadataAnalyzer:
    """Utility class for analyzing audio metadata and creating stem metadata."""

    SAMPLE_RATE: int = 44100

    def __init__(self):
        """Initialize the metadata analyzer."""
        self.loudness_meter = pyln.Meter(self.SAMPLE_RATE)
        self.waveform_generator = WaveformGenerator()
    
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
        profile: Profile,
        song_name: str
    ) -> StemMetadata:
        """Create metadata for a single stem.

        Args:
            stem_name: Name of the stem (e.g., "vocals", "drums")
            audio_file: Path to the stem audio file
            profile: Profile configuration
            song_name: Name of the song/output folder

        Returns:
            StemMetadata model
        """
        # Analyze loudness
        loudness_lufs = self.analyze_stem_loudness(audio_file)

        # Print loudness info
        print(f"  {stem_name}: {loudness_lufs:.1f} LUFS")

        # Generate waveform URL
        waveform_url = f"/api/profiles/{profile.name}/songs/{song_name}/stems/{stem_name}/waveform"

        return StemMetadata(
            stem_type=stem_name,
            measured_lufs=round(loudness_lufs, 2),
            waveform_url=waveform_url,
        )

    def create_stems_metadata(
        self,
        stem_paths: dict[str, Path],
        profile: Profile,
        output_folder: Path
    ) -> StemsMetadata:
        """Create metadata for multiple stems and generate waveforms.

        Args:
            stem_paths: Dictionary mapping stem names to file paths
            profile: Profile configuration
            output_folder: Output folder where waveforms will be saved

        Returns:
            StemsMetadata model containing all stem metadata
        """
        stems_dict = {}
        song_name = output_folder.name

        print("Generating waveforms...")
        for stem_name, audio_file in stem_paths.items():
            # Generate waveform PNG
            waveform_path = output_folder / f"{stem_name}_waveform.png"
            self.waveform_generator.generate_for_stem(audio_file, waveform_path)
            print(f"  ✓ {stem_name}: {waveform_path.name}")

            # Create metadata
            stems_dict[stem_name] = self.create_stem_metadata(
                stem_name, audio_file, profile, song_name
            )

        return StemsMetadata(stems=stems_dict)


# Global instance for convenience
_analyzer = None

def get_metadata_analyzer() -> AudioMetadataAnalyzer:
    """Get the global metadata analyzer instance."""
    global _analyzer
    if _analyzer is None:
        _analyzer = AudioMetadataAnalyzer()
    return _analyzer