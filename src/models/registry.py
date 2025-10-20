"""Model registry mapping model identifiers to separator classes."""

from __future__ import annotations
from typing import Literal
from types import MappingProxyType

# Import all atomic model classes
from .atomic_models import (
    HTDemucsModel,
    HDDemucsMMIModel,
    VocalsMelBandRoformerModel,
    KuielabDrumsModel,
    KuielabBassModel,
)
from .audio_separator_base import AudioSeparator

# Frozen registry mapping model names to separator classes
_MODEL_REGISTRY_DICT: dict[str, type[AudioSeparator]] = {
    "htdemucs_ft": HTDemucsModel,
    "hdemucs_mmi": HDDemucsMMIModel,
    "vocals_mel_band_roformer.ckpt": VocalsMelBandRoformerModel,
    "kuielab_b_drums.onnx": KuielabDrumsModel,
    "kuielab_a_bass.onnx": KuielabBassModel,
}

# Frozen mapping for immutability and type safety
MODEL_REGISTRY: MappingProxyType[str, type[AudioSeparator]] = MappingProxyType(
    _MODEL_REGISTRY_DICT  # type: ignore[arg-type]
)

# Type alias for valid model names (enables type checking)
ModelName = Literal[
    "htdemucs_ft",
    "hdemucs_mmi",
    "vocals_mel_band_roformer.ckpt",
    "kuielab_b_drums.onnx",
    "kuielab_a_bass.onnx",
]


def get_model_class(model_name: str) -> type[AudioSeparator]:
    """Get model class by name with validation.

    Args:
        model_name: Model identifier from config

    Returns:
        Model class

    Raises:
        ValueError: If model_name not in registry
    """
    if model_name not in MODEL_REGISTRY:
        available = ", ".join(MODEL_REGISTRY.keys())
        raise ValueError(
            f"Unknown model '{model_name}'. Available models: {available}"
        )
    return MODEL_REGISTRY[model_name]  # type: ignore[return-value]


def get_available_models() -> list[str]:
    """Get list of all registered model names."""
    return list(MODEL_REGISTRY.keys())
