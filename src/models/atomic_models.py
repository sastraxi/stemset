"""Atomic separator models using audio-separator library."""

from __future__ import annotations
from pathlib import Path

from .audio_separator_base import AudioSeparatorBase
from .protocols import AtomicSeparatorModel, StemType
from ..config import Profile


class HTDemucsModel(AudioSeparatorBase):
    """HD-Demucs model for 4-stem separation."""
    
    def __init__(self, profile: Profile):
        super().__init__(profile)
    
    @property
    def model_name(self) -> str:
        return "htdemucs_ft"
    
    @property 
    def output_stem_types(self) -> list[StemType]:
        return [StemType.VOCALS, StemType.DRUMS, StemType.BASS, StemType.OTHER]
    
    def _get_model_filename(self) -> str:
        return "htdemucs_ft.yaml"
    
    def _get_output_stem_mapping(self) -> dict[str, StemType]:
        return {
            "vocals": StemType.VOCALS,
            "drums": StemType.DRUMS, 
            "bass": StemType.BASS,
            "other": StemType.OTHER
        }


class HDDemucsMMIModel(AudioSeparatorBase):
    """HD-Demucs MMI model for 4-stem separation."""
    
    def __init__(self, profile: Profile):
        super().__init__(profile)
    
    @property
    def model_name(self) -> str:
        return "hdemucs_mmi"
    
    @property
    def output_stem_types(self) -> list[StemType]:
        return [StemType.VOCALS, StemType.DRUMS, StemType.BASS, StemType.OTHER]
    
    def _get_model_filename(self) -> str:
        return "hdemucs_mmi.yaml"
    
    def _get_output_stem_mapping(self) -> dict[str, StemType]:
        return {
            "vocals": StemType.VOCALS,
            "drums": StemType.DRUMS,
            "bass": StemType.BASS, 
            "other": StemType.OTHER
        }


class VocalsMelBandRoformerModel(AudioSeparatorBase):
    """Vocals extraction model for successive splitting."""
    
    def __init__(self, profile: Profile):
        super().__init__(profile)
    
    @property
    def model_name(self) -> str:
        return "vocals_mel_band_roformer"
    
    @property
    def output_stem_types(self) -> list[StemType]:
        return [StemType.VOCALS, StemType.NO_VOCALS]
    
    def _get_model_filename(self) -> str:
        return "vocals_mel_band_roformer.ckpt"
    
    def _get_output_stem_mapping(self) -> dict[str, StemType]:
        return {
            "vocals": StemType.VOCALS,
            "no_vocals": StemType.NO_VOCALS
        }


class KuielabDrumsModel(AudioSeparatorBase):
    """Drums extraction model for successive splitting."""
    
    def __init__(self, profile: Profile):
        super().__init__(profile)
    
    @property
    def model_name(self) -> str:
        return "kuielab_b_drums"
    
    @property
    def output_stem_types(self) -> list[StemType]:
        return [StemType.DRUMS, StemType.NO_DRUMS]
    
    def _get_model_filename(self) -> str:
        return "kuielab_b_drums.onnx"
    
    def _get_output_stem_mapping(self) -> dict[str, StemType]:
        return {
            "drums": StemType.DRUMS,
            "no_drums": StemType.NO_DRUMS
        }


class KuielabBassModel(AudioSeparatorBase):
    """Bass extraction model for successive splitting."""
    
    def __init__(self, profile: Profile):
        super().__init__(profile)
    
    @property
    def model_name(self) -> str:
        return "kuielab_a_bass"
    
    @property
    def output_stem_types(self) -> list[StemType]:
        return [StemType.BASS, StemType.OTHER]
    
    def _get_model_filename(self) -> str:
        return "kuielab_a_bass.onnx"
    
    def _get_output_stem_mapping(self) -> dict[str, StemType]:
        return {
            "bass": StemType.BASS,
            "other": StemType.OTHER
        }