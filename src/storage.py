"""Storage abstraction for media files (local or Cloudflare R2).

Storage backend is determined by environment variables:
- GPU_WORKER_URL set → R2Storage (production, remote GPU processing)
- GPU_WORKER_URL unset → LocalStorage (development, local processing)

R2Config in config.yaml is required only if GPU_WORKER_URL is set.
"""

from __future__ import annotations

import os
import shutil
from pathlib import Path
from typing import Protocol

import boto3

from .config import Config, R2Config


class StorageBackend(Protocol):
    """Protocol for storage backends."""

    def get_file_url(self, profile_name: str, file_name: str, stem_name: str, ext: str) -> str:
        """Get URL for accessing a stem file."""
        ...

    def get_waveform_url(self, profile_name: str, file_name: str, stem_name: str) -> str:
        """Get URL for accessing a waveform PNG."""
        ...

    def list_files(self, profile_name: str) -> list[str]:
        """List all processed files for a profile."""
        ...

    def upload_input_file(self, local_path: Path, profile_name: str, filename: str) -> str:
        """Upload an input file and return its URL/key."""
        ...

    def get_input_url(self, profile_name: str, filename: str) -> str:
        """Get URL for accessing an input file."""
        ...

    def delete_file(self, profile_name: str, file_name: str, stem_name: str, ext: str) -> None:
        """Delete a file from storage."""
        ...


class LocalStorage:
    """Local filesystem storage backend."""

    def get_file_url(self, profile_name: str, file_name: str, stem_name: str, ext: str) -> str:
        """Get URL for accessing a stem file."""
        return f"/media/{profile_name}/{file_name}/{stem_name}{ext}"

    def get_waveform_url(self, profile_name: str, file_name: str, stem_name: str) -> str:
        """Get URL for accessing a waveform PNG."""
        return f"/media/{profile_name}/{file_name}/{stem_name}_waveform.png"

    def list_files(self, profile_name: str) -> list[str]:
        """List all processed files for a profile."""
        media_path = Path("media") / profile_name
        if not media_path.exists():
            return []

        files: list[str] = []
        for folder in media_path.iterdir():
            if folder.is_dir() and not folder.name.startswith("."):
                files.append(folder.name)
        return files

    def upload_input_file(self, local_path: Path, profile_name: str, filename: str) -> str:
        """Copy input file to local inputs directory and return path."""
        inputs_dir = Path("inputs") / profile_name
        inputs_dir.mkdir(parents=True, exist_ok=True)

        dest_path = inputs_dir / filename
        _ = shutil.copy2(local_path, dest_path)

        return str(dest_path)

    def get_input_url(self, profile_name: str, filename: str) -> str:
        """Get path for accessing an input file (local filesystem)."""
        return str(Path("inputs") / profile_name / filename)

    def delete_file(self, profile_name: str, file_name: str, stem_name: str, ext: str) -> None:
        """Delete a file from local storage."""
        if stem_name and ext:
            # Regular stem file
            file_path = Path("media") / profile_name / file_name / f"{stem_name}{ext}"
        else:
            # Directory
            file_path = Path("media") / profile_name / file_name

        if file_path.exists():
            if file_path.is_file():
                file_path.unlink()
            elif file_path.is_dir():
                shutil.rmtree(file_path)


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
        """Get presigned URL for accessing a stem file (valid for 24 hours)."""
        key = f"{profile_name}/{file_name}/{stem_name}{ext}"
        return self.s3_client.generate_presigned_url(
            "get_object",
            Params={"Bucket": self.config.bucket_name, "Key": key},
            ExpiresIn=86400,  # 24 hours
        )

    def get_waveform_url(self, profile_name: str, file_name: str, stem_name: str) -> str:
        """Get presigned URL for accessing a waveform PNG (valid for 24 hours)."""
        key = f"{profile_name}/{file_name}/{stem_name}_waveform.png"
        return self.s3_client.generate_presigned_url(
            "get_object",
            Params={"Bucket": self.config.bucket_name, "Key": key},
            ExpiresIn=86400,  # 24 hours
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
        files: list[str] = []
        for common_prefix in response.get("CommonPrefixes", []):
            folder_path = common_prefix.get("Prefix", "")
            # Remove profile prefix and trailing slash
            folder_name = folder_path[len(prefix) :].rstrip("/")
            if folder_name and not folder_name.startswith("."):
                files.append(folder_name)

        return files

    def upload_file(
        self,
        local_path: Path,
        profile_name: str,
        file_name: str,
        object_name: str,
        extra_metadata: dict[str, str] | None = None,
    ) -> None:
        """Upload a file to R2, preserving local mtime in metadata."""
        key = f"{profile_name}/{file_name}/{object_name}"

        # Get local file mtime and store in metadata
        local_mtime = local_path.stat().st_mtime

        metadata = {"original-mtime": str(local_mtime)}

        # Add any extra metadata
        if extra_metadata:
            metadata.update(extra_metadata)

        self.s3_client.upload_file(
            str(local_path), self.config.bucket_name, key, ExtraArgs={"Metadata": metadata}
        )

    def upload_input_file(self, local_path: Path, profile_name: str, filename: str) -> str:
        """Upload an input file to R2 and return its key, preserving SHA256 hash in metadata."""
        key = f"inputs/{profile_name}/{filename}"

        # Compute SHA256 hash for deduplication
        import hashlib

        sha256_hash = hashlib.sha256()
        with open(local_path, "rb") as f:
            for chunk in iter(lambda: f.read(8192), b""):
                sha256_hash.update(chunk)
        file_sha256 = sha256_hash.hexdigest()

        self.s3_client.upload_file(
            str(local_path),
            self.config.bucket_name,
            key,
            ExtraArgs={"Metadata": {"sha256": file_sha256}},
        )
        return key

    def get_input_url(self, profile_name: str, filename: str) -> str:
        """Get presigned URL for accessing an input file (valid for 24 hours)."""
        key = f"inputs/{profile_name}/{filename}"
        return self.s3_client.generate_presigned_url(
            "get_object",
            Params={"Bucket": self.config.bucket_name, "Key": key},
            ExpiresIn=86400,  # 24 hours
        )

    def delete_file(self, profile_name: str, file_name: str, stem_name: str, ext: str) -> None:
        """Delete a file from R2 storage."""
        if stem_name and ext:
            # Regular stem file
            key = f"{profile_name}/{file_name}/{stem_name}{ext}"
            _ = self.s3_client.delete_object(Bucket=self.config.bucket_name, Key=key)
        else:
            # Directory - delete all objects with this prefix one by one
            prefix = f"{profile_name}/{file_name}/"
            response = self.s3_client.list_objects_v2(Bucket=self.config.bucket_name, Prefix=prefix)

            if "Contents" in response:
                for obj in response["Contents"]:
                    if "Key" in obj and obj["Key"]:
                        _ = self.s3_client.delete_object(
                            Bucket=self.config.bucket_name, Key=obj["Key"]
                        )


# Global storage instance
_storage: StorageBackend | None = None


def get_storage(config: Config | None = None) -> StorageBackend:
    """Get the configured storage backend.

    Determined by GPU_WORKER_URL environment variable:
    - If set: Use R2Storage (production, remote GPU processing)
    - If unset: Use LocalStorage (development, local processing)

    R2Config must be present in config.yaml if GPU_WORKER_URL is set.
    """
    global _storage

    if _storage is not None:
        return _storage

    # Load config if not provided
    if config is None:
        from .config import get_config

        config = get_config()

    # Determine storage backend based on GPU_WORKER_URL
    gpu_worker_url = os.getenv("GPU_WORKER_URL")

    if gpu_worker_url:
        # Production: Remote GPU processing requires R2
        if config.r2 is None:
            msg = "GPU_WORKER_URL is set but R2 config is missing in config.yaml"
            raise ValueError(msg)
        _storage = R2Storage(config.r2)
    else:
        # Development: Local processing uses local filesystem
        _storage = LocalStorage()

    return _storage
