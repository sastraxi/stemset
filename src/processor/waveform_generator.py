from pathlib import Path
from typing import Any

from numpy.typing import NDArray


class WaveformGenerator:
    """Generates grayscale PNG waveform visualizations for audio stems.

    Waveforms are rendered in grayscale so the frontend can apply color via CSS filters
    or canvas compositing operations.

    Note: This class requires processing dependencies (numpy, soundfile, PIL).
    """

    DEFAULT_WIDTH: int = 1920
    DEFAULT_HEIGHT: int = 256
    AMPLITUDE_EPSILON: float = 0.001  # Threshold below which we treat amplitude as zero

    def _compute_waveform_data(self, audio_path: Path, target_width: int, max_peak: float = 1.0):
        """Compute min/max envelope for waveform visualization.

        Args:
            audio_path: Path to audio file (must be in wav format)
            target_width: Number of horizontal pixels (samples per pixel computed automatically)
            max_peak: Maximum peak amplitude across all stems for normalization

        Returns:
            Array of shape (target_width, 2) with (min, max) values per pixel
        """
        import numpy as np
        import soundfile as sf  # pyright: ignore[reportMissingTypeStubs]

        if not audio_path.is_file() or audio_path.suffix.lower() != ".wav":
            raise ValueError("Audio path must point to an existing WAV file")

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
        waveform_data = np.column_stack(
            [
                -rms_values,  # Negative side
                rms_values,  # Positive side
            ]
        )

        # Normalize to the max peak across all stems for consistent scaling
        if max_peak > 0:
            waveform_data = waveform_data / max_peak

        # Apply perceptual (logarithmic) filter for better visual representation
        # Human hearing is logarithmic, so this makes quiet details more visible
        # while preventing loud parts from dominating the display
        def apply_perceptual_filter(data, threshold=0.001) -> NDArray[Any]:
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
        VISUAL_SCALE_FACTOR = 2.0
        waveform_data = waveform_data * VISUAL_SCALE_FACTOR

        # Clamp to [-1, 1] to prevent overflow
        waveform_data = np.clip(waveform_data, -1.0, 1.0)

        # Apply epsilon threshold to eliminate noise floor (after scaling)
        waveform_data = np.where(np.abs(waveform_data) < self.AMPLITUDE_EPSILON, 0, waveform_data)

        return waveform_data

    def _render_grayscale_png(
        self, waveform_data, output_path: Path, width: int, height: int
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
        img = Image.new("RGBA", (width, height), (0, 0, 0, 0))
        draw = ImageDraw.Draw(img, "RGBA")

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
                draw.point(
                    [(x, center_y - int((min_val + max_val) / 2 * scale))],
                    fill=(255, 255, 255, 255),
                )

        # Save with PNG optimization
        img.save(output_path, "PNG", optimize=True)

    def generate_for_stem(
        self,
        audio_path: Path,
        output_path: Path,
        width: int = DEFAULT_WIDTH,
        height: int = DEFAULT_HEIGHT,
        max_peak: float = 1.0,
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
