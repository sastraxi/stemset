"""Utilities for audio metadata analysis and stem metadata creation.

This module is split into two parts:
1. Pydantic models (StemMetadata, StemsMetadata) - lightweight, no processing deps
2. Processing utilities (imported lazily) - require numpy, pyloudnorm, etc.
"""

from __future__ import annotations

from pathlib import Path
from pydantic import BaseModel

from ..config import Profile


class StemMetadata(BaseModel):
    """Metadata for a single stem."""

    stem_type: str
    measured_lufs: float
    peak_amplitude: float
    stem_gain_adjustment_db: float
    stem_url: str  # Relative path to audio file (e.g., "vocals.opus")
    waveform_url: str  # Relative path to waveform PNG (e.g., "vocals_waveform.png")


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

    Note: This class requires processing dependencies (numpy, soundfile, PIL).
    """

    DEFAULT_WIDTH: int = 1920
    DEFAULT_HEIGHT: int = 256
    AMPLITUDE_EPSILON: float = 0.001  # Threshold below which we treat amplitude as zero

    def _compute_waveform_data(
        self, audio_path: Path, target_width: int, max_peak: float = 1.0
    ):
        """Compute min/max envelope for waveform visualization.

        Args:
            audio_path: Path to audio file
            target_width: Number of horizontal pixels (samples per pixel computed automatically)
            max_peak: Maximum peak amplitude across all stems for normalization

        Returns:
            Array of shape (target_width, 2) with (min, max) values per pixel
        """
        import numpy as np
        import soundfile as sf

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

        # Use RMS (Root Mean Square) for smoother, anti-aliased waveforms
        # This captures the energy/loudness of each block rather than harsh min/max
        rms_values = np.sqrt(np.mean(blocks**2, axis=1))
        
        # Create symmetric waveform data (positive and negative RMS)
        waveform_data = np.column_stack([
            -rms_values,  # Negative side
            rms_values    # Positive side
        ])

        # Normalize to the max peak across all stems for consistent scaling
        if max_peak > 0:
            waveform_data = waveform_data / max_peak

        # Apply perceptual (logarithmic) filter for better visual representation
        # Human hearing is logarithmic, so this makes quiet details more visible
        # while preventing loud parts from dominating the display
        def apply_perceptual_filter(data, threshold=0.001):
            """Apply logarithmic scaling to match human audio perception"""
            # Use sign-preserving logarithmic scaling
            sign = np.sign(data)
            abs_data = np.abs(data)
            
            # Avoid log(0) by using threshold for very quiet signals
            abs_data = np.maximum(abs_data, threshold)
            
            # Apply logarithmic scaling: log10(1 + 9*x) gives smooth curve from 0 to 1
            log_data = np.log10(1 + 9 * abs_data) / np.log10(10)  # Normalize to [0, 1]
            
            return sign * log_data
        
        waveform_data = apply_perceptual_filter(waveform_data)

        # Apply visual scaling fudge factor to make waveforms more prominent
        # This compensates for anti-aliasing reducing apparent peaks
        VISUAL_SCALE_FACTOR = 2.5  # Reduced from 3.0 since log scaling helps visibility
        waveform_data = waveform_data * VISUAL_SCALE_FACTOR

        # Clamp to [-1, 1] to prevent overflow
        waveform_data = np.clip(waveform_data, -1.0, 1.0)

        # Apply epsilon threshold to eliminate noise floor (after scaling)
        waveform_data = np.where(
            np.abs(waveform_data) < self.AMPLITUDE_EPSILON, 0, waveform_data
        )

        return waveform_data

    def _render_grayscale_png(
        self,
        waveform_data,
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
        from PIL import Image, ImageDraw

        # Create transparent image
        img = Image.new('RGBA', (width, height), (0, 0, 0, 0))
        draw = ImageDraw.Draw(img, 'RGBA')

        # Normalize to pixel coordinates
        center_y = height // 2
        scale = height / 2

        # Draw waveform in white (frontend will apply color)
        for x in range(width):
            min_val, max_val = waveform_data[x]

            # Skip drawing if both values are zero (below EPSILON threshold)
            if min_val == 0 and max_val == 0:
                continue

            # Convert to pixel coordinates
            y_min = int(center_y - (min_val * scale))
            y_max = int(center_y - (max_val * scale))

            # Only draw if there's actual amplitude difference
            if y_min != y_max:
                draw.line([(x, y_min), (x, y_max)], fill=(255, 255, 255, 255), width=1)
            elif min_val != 0 or max_val != 0:  # Single pixel for very small but non-zero values
                draw.point([(x, center_y - int((min_val + max_val) / 2 * scale))], fill=(255, 255, 255, 255))

        # Save with PNG optimization
        img.save(output_path, 'PNG', optimize=True)

    def generate_for_stem(
        self,
        audio_path: Path,
        output_path: Path,
        width: int = DEFAULT_WIDTH,
        height: int = DEFAULT_HEIGHT,
        max_peak: float = 1.0
    ) -> None:
        """Generate grayscale waveform PNG for a single stem.

        Args:
            audio_path: Path to stem audio file
            output_path: Path where PNG will be saved
            width: Image width in pixels (default: 1920)
            height: Image height in pixels (default: 256)
            max_peak: Maximum peak across all stems for normalization
        """
        waveform_data = self._compute_waveform_data(audio_path, width, max_peak)
        self._render_grayscale_png(waveform_data, output_path, width, height)


class AudioMetadataAnalyzer:
    """Utility class for analyzing audio metadata and creating stem metadata.

    Note: This class requires processing dependencies (numpy, pyloudnorm, soundfile).
    """

    SAMPLE_RATE: int = 44100

    def __init__(self):
        """Initialize the metadata analyzer."""
        import pyloudnorm as pyln

        self.loudness_meter = pyln.Meter(self.SAMPLE_RATE)
        self.waveform_generator = WaveformGenerator()
    
    def analyze_stem_loudness(self, audio_file: Path) -> tuple[float, float]:
        """Analyze the loudness (LUFS) and peak amplitude of an audio file.

        Args:
            audio_file: Path to the audio file to analyze

        Returns:
            Tuple of (loudness_lufs, peak_amplitude)
        """
        import numpy as np
        import soundfile as sf

        audio_data, _rate = sf.read(str(audio_file))
        loudness_lufs = self.loudness_meter.integrated_loudness(audio_data)

        # Calculate peak amplitude (absolute max value)
        if len(audio_data.shape) > 1:
            # Stereo/multi-channel: take max across all channels
            peak_amplitude = float(np.max(np.abs(audio_data)))
        else:
            # Mono
            peak_amplitude = float(np.max(np.abs(audio_data)))
            
        return float(loudness_lufs), peak_amplitude
    
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
        # Analyze loudness and peak
        loudness_lufs, peak_amplitude = self.analyze_stem_loudness(audio_file)

        # Calculate gain adjustment to normalize LUFS to -23 LUFS (broadcast standard)
        # Quiet stems get boosted, loud stems get attenuated
        target_lufs = -23.0
        if loudness_lufs > -60:  # Only adjust if we have meaningful loudness measurement
            stem_gain_adjustment_db = target_lufs - loudness_lufs
        else:
            # Very quiet stem, use 0 dB adjustment to avoid extreme boosts
            stem_gain_adjustment_db = 0.0

        # Clamp to reasonable range to avoid extreme adjustments
        stem_gain_adjustment_db = max(-12, min(12, stem_gain_adjustment_db))

        # Print loudness info
        print(f"  {stem_name}: {loudness_lufs:.1f} LUFS, peak: {peak_amplitude:.3f}, gain: {stem_gain_adjustment_db:+.1f} dB")

        # Use relative paths (metadata.json sits next to the audio files)
        stem_url = audio_file.name  # e.g., "vocals.opus"
        waveform_url = f"{stem_name}_waveform.png"

        return StemMetadata(
            stem_type=stem_name,
            measured_lufs=round(loudness_lufs, 2),
            peak_amplitude=round(peak_amplitude, 4),
            stem_gain_adjustment_db=round(stem_gain_adjustment_db, 2),
            stem_url=stem_url,
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

        # First pass: collect peak amplitudes for normalization
        print("Analyzing peaks for normalization...")
        peak_amplitudes = {}
        for stem_name, audio_file in stem_paths.items():
            _, peak_amplitude = self.analyze_stem_loudness(audio_file)
            peak_amplitudes[stem_name] = peak_amplitude
        
        # Find the maximum peak across all stems for normalization
        max_peak = max(peak_amplitudes.values()) if peak_amplitudes else 1.0
        print(f"  Max peak across all stems: {max_peak:.4f}")

        # Second pass: collect LUFS measurements for relative gain calculation
        print("Analyzing LUFS for relative gain calculation...")
        lufs_measurements = {}
        for stem_name, audio_file in stem_paths.items():
            loudness_lufs, _ = self.analyze_stem_loudness(audio_file)
            lufs_measurements[stem_name] = loudness_lufs

        # Calculate relative gains while capping max gain at 2x (6.02 dB)
        max_gain_db = 6.02  # 2x linear gain
        target_lufs = -23.0
        
        # Calculate initial target gains
        target_gains_db = {}
        for stem_name, loudness_lufs in lufs_measurements.items():
            if loudness_lufs > -60:  # Only adjust if we have meaningful measurement
                target_gains_db[stem_name] = target_lufs - loudness_lufs
            else:
                target_gains_db[stem_name] = 0.0
        
        # Find the stem that needs the most gain
        max_needed_gain = max(target_gains_db.values()) if target_gains_db else 0.0
        
        # If any stem would exceed our max gain, shift all gains down proportionally
        # to maintain relative relationships while staying within limits
        gain_offset = 0.0
        if max_needed_gain > max_gain_db:
            gain_offset = max_needed_gain - max_gain_db
            print(f"  Applying gain offset of {gain_offset:.1f} dB to maintain 2x cap")
        
        # Apply the offset and clamp to reasonable range
        final_gains_db = {}
        for stem_name, target_gain in target_gains_db.items():
            adjusted_gain = target_gain - gain_offset
            final_gains_db[stem_name] = max(-12, min(max_gain_db, adjusted_gain))

        print("Generating waveforms...")
        for stem_name, audio_file in stem_paths.items():
            # Generate waveform PNG with normalized peak scaling
            waveform_path = output_folder / f"{stem_name}_waveform.png"
            self.waveform_generator.generate_for_stem(
                audio_file, waveform_path, max_peak=max_peak
            )
            print(f"  ✓ {stem_name}: {waveform_path.name}")

            # Create metadata with calculated relative gain
            loudness_lufs = lufs_measurements[stem_name]
            peak_amplitude = peak_amplitudes[stem_name]
            stem_gain_adjustment_db = final_gains_db[stem_name]
            
            # Print loudness info
            print(f"  {stem_name}: {loudness_lufs:.1f} LUFS, peak: {peak_amplitude:.3f}, gain: {stem_gain_adjustment_db:+.1f} dB")

            # Use relative paths (metadata.json sits next to the audio files)
            stem_url = audio_file.name  # e.g., "vocals.opus"
            waveform_url = f"{stem_name}_waveform.png"

            stems_dict[stem_name] = StemMetadata(
                stem_type=stem_name,
                measured_lufs=round(loudness_lufs, 2),
                peak_amplitude=round(peak_amplitude, 4),
                stem_gain_adjustment_db=round(stem_gain_adjustment_db, 2),
                stem_url=stem_url,
                waveform_url=waveform_url,
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