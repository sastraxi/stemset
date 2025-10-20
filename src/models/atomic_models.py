"""Atomic separator models using audio-separator library."""

from __future__ import annotations

from .audio_separator_base import AudioSeparatorLibraryModel


class HTDemucsModel(AudioSeparatorLibraryModel):
    """HD-Demucs model for 4-stem separation."""

    @property
    def output_slots(self) -> dict[str, str]:
        return {
            "vocals": "Vocal track",
            "drums": "Drum track",
            "bass": "Bass track",
            "other": "Other instruments (guitars, keys, etc.)",
        }

    @property
    def model_filename(self) -> str:
        return "htdemucs_ft.yaml"


class HDDemucsMMIModel(AudioSeparatorLibraryModel):
    """HD-Demucs MMI model for 4-stem separation."""

    @property
    def output_slots(self) -> dict[str, str]:
        return {
            "vocals": "Vocal track",
            "drums": "Drum track",
            "bass": "Bass track",
            "other": "Other instruments (guitars, keys, etc.)",
        }

    @property
    def model_filename(self) -> str:
        return "hdemucs_mmi.yaml"


class VocalsMelBandRoformerModel(AudioSeparatorLibraryModel):
    """Vocals extraction model for successive splitting."""

    @property
    def output_slots(self) -> dict[str, str]:
        return {
            "vocals": "Vocal track",
            "not_vocals": "Instrumental (no vocals)",
        }

    @property
    def model_filename(self) -> str:
        return "vocals_mel_band_roformer.ckpt"


class KuielabDrumsModel(AudioSeparatorLibraryModel):
    """Drums extraction model for successive splitting."""

    @property
    def output_slots(self) -> dict[str, str]:
        return {
            "drums": "Drum track",
            "not_drums": "Audio without drums",
        }

    @property
    def model_filename(self) -> str:
        return "kuielab_b_drums.onnx"


class KuielabBassModel(AudioSeparatorLibraryModel):
    """Bass extraction model for successive splitting."""

    @property
    def output_slots(self) -> dict[str, str]:
        return {
            "bass": "Bass track",
            "not_bass": "Audio without bass (other instruments)",
        }

    @property
    def model_filename(self) -> str:
        return "kuielab_a_bass.onnx"
