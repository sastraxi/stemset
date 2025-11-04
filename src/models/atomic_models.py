"""Atomic separator models using audio-separator library."""

from __future__ import annotations

from pathlib import Path

import librosa
import numpy as np
import soundfile

from .audio_separator_base import AudioSeparatorLibraryModel, NeuralAudioSeparator
from ..processor.audio_utils import read_audio

if False:
    from ..config import OutputConfig


class HTDemucsModel(AudioSeparatorLibraryModel):
    """HD-Demucs model for 4-stem separation."""

    @property
    def model_filename(self) -> str:
        return "htdemucs_ft.yaml"


class HDDemucsMMIModel(AudioSeparatorLibraryModel):
    """HD-Demucs MMI model for 4-stem separation."""

    @property
    def model_filename(self) -> str:
        return "hdemucs_mmi.yaml"


class VocalsMelBandRoformerModel(AudioSeparatorLibraryModel):
    """Vocals extraction model for successive splitting."""

    @property
    def model_filename(self) -> str:
        return "vocals_mel_band_roformer.ckpt"


class KuielabDrumsModel(AudioSeparatorLibraryModel):
    """Drums extraction model for successive splitting."""

    @property
    def model_filename(self) -> str:
        return "kuielab_b_drums.onnx"


class KuielabBassModel(AudioSeparatorLibraryModel):
    """Bass extraction model for successive splitting."""

    @property
    def model_filename(self) -> str:
        return "kuielab_a_bass.onnx"


class SimpleStereoSeparator(NeuralAudioSeparator):
    """ILD-based spatial separator for stereo audio.

    Separates based on Inter-Level Difference (dB difference between L/R channels).
    Works best with panned sources; adjustable threshold for partial panning.

    Args:
        output_config: Output format and bitrate settings
        ild_threshold_db: Threshold in dB for left/right panning detection (default: 6.0)
                          - Higher values (e.g., 9) require harder panning
                          - Lower values (e.g., 3) for more aggressive separation
    """

    def __init__(self, output_config: OutputConfig, ild_threshold_db: float = 6.0) -> None:
        super().__init__(output_config)
        self.ild_threshold_db = ild_threshold_db

    @property
    def model_filename(self) -> str:
        return "stereo_spatial"

    @property
    def output_slots(self) -> dict[str, str]:
        return {
            "left": "Left-panned content",
            "right": "Right-panned content",
            "center": "Center-panned content",
        }

    def separate(self, input_file: Path, output_dir: Path) -> dict[str, Path]:
        """Separate stereo audio by panning position using ILD.

        Args:
            input_file: Stereo audio file to separate
            output_dir: Directory to write output stems

        Returns:
            Dict mapping slot names to output file paths

        Raises:
            ValueError: If input is not stereo
        """
        output_dir.mkdir(parents=True, exist_ok=True)

        # 1. Load audio using ffmpeg-based utilities
        audio, sr = read_audio(input_file)
        self._validate_stereo(audio)

        # audio_utils returns shape (samples, channels) for stereo
        # We need shape (channels, samples) for librosa
        audio = audio.T  # Transpose to (2, samples)

        # 2. Compute STFT for each channel
        stft_left = librosa.stft(audio[0])
        stft_right = librosa.stft(audio[1])

        # 3. Calculate ILD (Inter-Level Difference)
        eps = 1e-10  # Avoid division by zero
        ild = 20 * np.log10((np.abs(stft_left) + eps) / (np.abs(stft_right) + eps))

        # 4. Create binary masks based on ILD thresholds
        left_mask = ild > self.ild_threshold_db
        right_mask = ild < -self.ild_threshold_db
        center_mask = ~(left_mask | right_mask)

        # 5. Apply masks and reconstruct
        left_stem = librosa.istft(stft_left * left_mask)
        right_stem = librosa.istft(stft_right * right_mask)

        # Center: average of both channels with center mask
        center_stft = (stft_left + stft_right) / 2 * center_mask
        center_stem = librosa.istft(center_stft)

        # 6. Save outputs as WAV (intermediates use lossless format)
        left_path = output_dir / "left.wav"
        right_path = output_dir / "right.wav"
        center_path = output_dir / "center.wav"

        soundfile.write(left_path, left_stem, sr)
        soundfile.write(right_path, right_stem, sr)
        soundfile.write(center_path, center_stem, sr)

        print(
            f"Spatial separation complete (ILD threshold: {self.ild_threshold_db} dB)"
        )

        return {
            "left": left_path,
            "right": right_path,
            "center": center_path,
        }

    def _validate_stereo(self, audio: np.ndarray) -> None:
        """Ensure input is stereo (2 channels).

        Args:
            audio: Audio array from read_audio (shape: samples, channels)

        Raises:
            ValueError: If input is not stereo
        """
        if audio.ndim != 2 or audio.shape[1] != 2:
            raise ValueError(
                f"SimpleStereoSeparator requires stereo input. "
                f"Got shape: {audio.shape} (expected: (samples, 2))"
            )
