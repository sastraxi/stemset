#!/usr/bin/env python3
"""Preload audio separation models into cache directory.

This script is used during Modal image builds to download all models
ahead of time, so they don't need to be downloaded on first invocation.
"""

from __future__ import annotations

import os
from audio_separator.separator import Separator

# Models used in config.yaml strategies
MODELS = [
    "htdemucs_ft.yaml",
    "hdemucs_mmi.yaml",
    "vocals_mel_band_roformer.ckpt",
    "kuielab_b_drums.onnx",
    "kuielab_a_bass.onnx",
]


def main() -> None:
    """Download all models to cache directory."""
    cache_dir = os.getenv("STEMSET_MODEL_CACHE_DIR", "/root/.models")
    print(f"Preloading models to: {cache_dir}")

    sep = Separator(model_file_dir=cache_dir)

    for model in MODELS:
        print(f"  Loading {model}...")
        sep.load_model(model)

    print(f"✓ Successfully preloaded {len(MODELS)} models")


if __name__ == "__main__":
    main()
