"""File scanning and hash tracking utilities."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

AUDIO_EXTENSIONS = {".wav", ".wave"}


def compute_file_hash(file_path: Path) -> str:
    """Compute SHA256 hash of file contents.

    Args:
        file_path: Path to the file

    Returns:
        Hex digest of the file hash
    """
    sha256 = hashlib.sha256()
    with open(file_path, "rb") as f:
        # Read in chunks to handle large files
        for chunk in iter(lambda: f.read(8192), b""):
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


def scan_for_new_files(profile_name: str, source_path: Path, media_path: Path) -> list[tuple[Path, str]]:
    """Scan source folder for new audio files that haven't been processed.

    Args:
        profile_name: Name of the profile
        source_path: Source folder to scan
        media_path: Media output folder

    Returns:
        List of tuples (file_path, output_folder_name) for unprocessed files
    """
    hash_db_path = media_path / ".processed_hashes.json"

    # Load processed hashes
    processed_hashes = {}
    if hash_db_path.exists():
        with open(hash_db_path, "r") as f:
            processed_hashes = json.load(f)

    if not source_path.exists():
        print(f"Warning: Source folder does not exist: {source_path}")
        return []

    new_files = []

    # Recursively find all audio files
    for ext in AUDIO_EXTENSIONS:
        for file_path in source_path.rglob(f"*{ext}"):
            # Skip hidden files and system files
            if any(part.startswith(".") for part in file_path.parts):
                continue

            # Compute hash of file contents
            try:
                file_hash = compute_file_hash(file_path)
            except Exception as e:
                print(f"Error hashing file {file_path}: {e}")
                continue

            # Check if we've already processed this content
            if file_hash in processed_hashes:
                print(f"Skipping already processed file: {file_path.name} (hash: {file_hash[:8]})")
                continue

            # New file - derive output name with hash suffix for uniqueness
            base_output_name = derive_output_name(file_path)
            output_name = f"{base_output_name}_{file_hash[:8]}"

            new_files.append((file_path, output_name))

            # Mark as processed immediately
            processed_hashes[file_hash] = output_name

    # Save updated hash database
    if new_files:
        hash_db_path.parent.mkdir(parents=True, exist_ok=True)
        with open(hash_db_path, "w") as f:
            json.dump(processed_hashes, f, indent=2)

    return new_files
