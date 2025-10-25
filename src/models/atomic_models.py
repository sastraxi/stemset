"""Atomic separator models using audio-separator library."""

from __future__ import annotations

from .audio_separator_base import AudioSeparatorLibraryModel


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
