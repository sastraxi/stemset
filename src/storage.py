"""Storage abstraction for media files (local or Cloudflare R2)."""

from __future__ import annotations

import os
import boto3
from pathlib import Path
from typing import Protocol
from .config import Config, R2Config



class StorageBackend(Protocol):
    """Protocol for storage backends."""

    def get_file_url(self, profile_name: str, file_name: str, stem_name: str, ext: str) -> str:
        """Get URL for accessing a stem file."""
        ...

    def get_waveform_url(self, profile_name: str, file_name: str, stem_name: str) -> str:
        """Get URL for accessing a waveform PNG."""
        ...

    def get_metadata_url(self, profile_name: str, file_name: str) -> str:
        """Get URL for accessing metadata JSON."""
        ...

    def list_files(self, profile_name: str) -> list[str]:
        """List all processed files for a profile."""
        ...


class LocalStorage:
    """Local filesystem storage backend."""

    def get_file_url(self, profile_name: str, file_name: str, stem_name: str, ext: str) -> str:
        """Get URL for accessing a stem file."""
        return f"/media/{profile_name}/{file_name}/{stem_name}{ext}"

    def get_waveform_url(self, profile_name: str, file_name: str, stem_name: str) -> str:
        """Get URL for accessing a waveform PNG."""
        return f"/media/{profile_name}/{file_name}/{stem_name}_waveform.png"

    def get_metadata_url(self, profile_name: str, file_name: str) -> str:
        """Get URL for accessing metadata JSON."""
        return f"/media/{profile_name}/{file_name}/metadata.json"

    def list_files(self, profile_name: str) -> list[str]:
        """List all processed files for a profile."""
        media_path = Path("media") / profile_name
        if not media_path.exists():
            return []

        files = []
        for folder in media_path.iterdir():
            if folder.is_dir() and not folder.name.startswith("."):
                files.append(folder.name)
        return files


class R2Storage:
    """Cloudflare R2 storage backend."""

    def __init__(self, r2_config: R2Config):
        """Initialize R2 storage with configuration."""
        self.config = r2_config
        self.s3_client = boto3.client(
            "s3",
            endpoint_url=f"https://{r2_config.account_id}.r2.cloudflarestorage.com",
            aws_access_key_id=r2_config.access_key_id,
            aws_secret_access_key=r2_config.secret_access_key,
            region_name="auto",
        )

    def get_file_url(self, profile_name: str, file_name: str, stem_name: str, ext: str) -> str:
        """Get presigned URL for accessing a stem file."""
        key = f"{profile_name}/{file_name}/{stem_name}{ext}"

        # If public URL is configured, use it directly
        if self.config.public_url:
            return f"{self.config.public_url}/{key}"

        # Otherwise generate presigned URL (valid for 1 hour)
        return self.s3_client.generate_presigned_url(
            "get_object",
            Params={"Bucket": self.config.bucket_name, "Key": key},
            ExpiresIn=3600,
        )

    def get_waveform_url(self, profile_name: str, file_name: str, stem_name: str) -> str:
        """Get presigned URL for accessing a waveform PNG."""
        key = f"{profile_name}/{file_name}/{stem_name}_waveform.png"

        if self.config.public_url:
            return f"{self.config.public_url}/{key}"

        return self.s3_client.generate_presigned_url(
            "get_object",
            Params={"Bucket": self.config.bucket_name, "Key": key},
            ExpiresIn=3600,
        )

    def get_metadata_url(self, profile_name: str, file_name: str) -> str:
        """Get presigned URL for accessing metadata JSON."""
        key = f"{profile_name}/{file_name}/metadata.json"

        if self.config.public_url:
            return f"{self.config.public_url}/{key}"

        return self.s3_client.generate_presigned_url(
            "get_object",
            Params={"Bucket": self.config.bucket_name, "Key": key},
            ExpiresIn=3600,
        )

    def list_files(self, profile_name: str) -> list[str]:
        """List all processed files for a profile."""
        prefix = f"{profile_name}/"
        response = self.s3_client.list_objects_v2(
            Bucket=self.config.bucket_name,
            Prefix=prefix,
            Delimiter="/",
        )

        # Extract folder names (common prefixes)
        files = []
        for common_prefix in response.get("CommonPrefixes", []):
            folder_path = common_prefix["Prefix"]
            # Remove profile prefix and trailing slash
            folder_name = folder_path[len(prefix):].rstrip("/")
            if folder_name and not folder_name.startswith("."):
                files.append(folder_name)

        return files

    def upload_file(self, local_path: Path, profile_name: str, file_name: str, object_name: str) -> None:
        """Upload a file to R2."""
        key = f"{profile_name}/{file_name}/{object_name}"
        self.s3_client.upload_file(
            str(local_path),
            self.config.bucket_name,
            key,
        )


# Global storage instance
_storage: StorageBackend | None = None


def get_storage(config: Config | None = None) -> StorageBackend:
    """Get the configured storage backend.

    Storage selection:
    - If STEMSET_LOCAL_STORAGE=true, use local storage
    - If STEMSET_LOCAL_STORAGE=false, require R2 config and use R2 storage
    - If STEMSET_LOCAL_STORAGE not set, use R2 if configured, otherwise local
    """
    global _storage

    if _storage is not None:
        return _storage

    # Load config if not provided
    if config is None:
        from .config import get_config
        config = get_config()

    # Check for explicit storage backend selection
    local_storage_env = os.getenv("STEMSET_LOCAL_STORAGE", "").lower()

    if local_storage_env == "true":
        # Explicitly use local storage
        _storage = LocalStorage()
    elif local_storage_env == "false":
        # Explicitly use R2 storage (require config)
        if config.r2 is None:
            raise ValueError(
                "STEMSET_LOCAL_STORAGE=false but R2 is not configured in config.yaml. "
                "Either set STEMSET_LOCAL_STORAGE=true or uncomment the r2 section in config.yaml."
            )
        _storage = R2Storage(config.r2)
    else:
        # No explicit preference - use R2 if configured, otherwise local
        if config.r2 is not None:
            _storage = R2Storage(config.r2)
        else:
            _storage = LocalStorage()

    return _storage
