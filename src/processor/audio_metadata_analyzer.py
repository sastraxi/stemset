from pathlib import Path

from src.models.metadata import StemMetadata, StemsMetadata
from src.processor.waveform_generator import WaveformGenerator


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
        import soundfile as sf  # pyright: ignore[reportMissingTypeStubs]

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

    def create_stem_metadata(self, stem_name: str, audio_file: Path) -> StemMetadata:
        """Create metadata for a single stem.

        Args:
            stem_name: Name of the stem (e.g., "vocals", "drums")
            audio_file: Path to the stem audio file

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
        print(
            f"  {stem_name}: {loudness_lufs:.1f} LUFS, peak: {peak_amplitude:.3f}, gain: {stem_gain_adjustment_db:+.1f} dB"
        )

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
        output_folder: Path,
    ) -> StemsMetadata:
        """Create metadata for multiple stems and generate waveforms.

        Args:
            stem_paths: Dictionary mapping stem names to file paths
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
            self.waveform_generator.generate_for_stem(audio_file, waveform_path, max_peak=max_peak)
            print(f"  ✓ {stem_name}: {waveform_path.name}")

            # Create metadata with calculated relative gain
            loudness_lufs = lufs_measurements[stem_name]
            peak_amplitude = peak_amplitudes[stem_name]
            stem_gain_adjustment_db = final_gains_db[stem_name]

            # Print loudness info
            print(
                f"  {stem_name}: {loudness_lufs:.1f} LUFS, peak: {peak_amplitude:.3f}, gain: {stem_gain_adjustment_db:+.1f} dB"
            )

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
