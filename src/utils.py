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
