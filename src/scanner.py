"""File scanning and duplicate detection using content-based hashing."""

import hashlib
import json
from pathlib import Path
from typing import Dict, Set

from .config import Profile


class FileScanner:
    """Scans directories for audio files and tracks processed files by content hash."""

    AUDIO_EXTENSIONS = {".wav", ".wave"}

    def __init__(self, profile: Profile):
        """Initialize scanner for a specific profile.

        Args:
            profile: The profile configuration to use
        """
        self.profile = profile
        self.hash_db_path = self.profile.get_media_path() / ".processed_hashes.json"
        self.processed_hashes = self._load_hash_db()

    def _load_hash_db(self) -> Dict[str, str]:
        """Load the database of processed file hashes.

        Returns:
            Dict mapping content hash to output folder name
        """
        if self.hash_db_path.exists():
            with open(self.hash_db_path, "r") as f:
                return json.load(f)
        return {}

    def _save_hash_db(self) -> None:
        """Save the database of processed file hashes."""
        self.hash_db_path.parent.mkdir(parents=True, exist_ok=True)
        with open(self.hash_db_path, "w") as f:
            json.dump(self.processed_hashes, f, indent=2)

    def _compute_file_hash(self, file_path: Path) -> str:
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

    def _derive_output_name(self, file_path: Path) -> str:
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

    def scan_for_new_files(self) -> list[tuple[Path, str]]:
        """Scan source folder for new audio files that haven't been processed.

        Returns:
            List of tuples (file_path, output_folder_name) for unprocessed files
        """
        source_path = self.profile.get_source_path()

        if not source_path.exists():
            print(f"Warning: Source folder does not exist: {source_path}")
            return []

        new_files = []

        # Recursively find all audio files
        for ext in self.AUDIO_EXTENSIONS:
            for file_path in source_path.rglob(f"*{ext}"):
                # Skip hidden files and system files
                if any(part.startswith(".") for part in file_path.parts):
                    continue

                # Compute hash of file contents
                try:
                    file_hash = self._compute_file_hash(file_path)
                except Exception as e:
                    print(f"Error hashing file {file_path}: {e}")
                    continue

                # Check if we've already processed this content
                if file_hash in self.processed_hashes:
                    continue

                # New file - derive output name
                output_name = self._derive_output_name(file_path)

                # Handle name collisions by appending hash suffix
                output_path = self.profile.get_media_path() / output_name
                if output_path.exists():
                    output_name = f"{output_name}_{file_hash[:8]}"

                new_files.append((file_path, output_name))

        return new_files

    def mark_as_processed(self, file_path: Path, output_name: str) -> None:
        """Mark a file as processed by storing its hash.

        Args:
            file_path: Path to the processed file
            output_name: Name of the output folder created
        """
        file_hash = self._compute_file_hash(file_path)
        self.processed_hashes[file_hash] = output_name
        self._save_hash_db()

    def get_all_processed_files(self) -> Dict[str, str]:
        """Get all processed files.

        Returns:
            Dict mapping content hash to output folder name
        """
        return self.processed_hashes.copy()
