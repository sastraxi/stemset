"""Shared utility functions."""

from __future__ import annotations

import hashlib
from pathlib import Path


def compute_file_hash(file_path: Path) -> str:
    """Compute SHA256 hash of a file for deduplication.

    Args:
        file_path: Path to the file to hash

    Returns:
        Hex digest of SHA256 hash
    """
    sha256 = hashlib.sha256()
    with open(file_path, 'rb') as f:
        for chunk in iter(lambda: f.read(8192), b''):
            sha256.update(chunk)
    return sha256.hexdigest()


def derive_output_name(file_path: Path) -> str:
    """Derive output folder name from original filename.

    Removes extension and sanitizes the name for use as a folder name.

    Args:
        file_path: Path to the original audio file

    Returns:
        Sanitized folder name
    """
    # Get stem (filename without extension)
    name = file_path.stem

    # Replace spaces and special characters with underscores
    name = "".join(c if c.isalnum() or c in "-_" else "_" for c in name)

    # Remove duplicate underscores
    while "__" in name:
        name = name.replace("__", "_")

    # Strip leading/trailing underscores
    name = name.strip("_")

    return name or "unnamed"
