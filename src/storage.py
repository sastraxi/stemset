"""Storage abstraction for media files (local or Cloudflare R2)."""

from __future__ import annotations

import os
import shutil
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

    def upload_input_file(self, local_path: Path, profile_name: str, filename: str) -> str:
        """Upload an input file and return its URL/key."""
        ...

    def get_input_url(self, profile_name: str, filename: str) -> str:
        """Get URL for accessing an input file."""
        ...

    def download_input_file(self, profile_name: str, filename: str, dest_path: Path) -> None:
        """Download an input file to local destination."""
        ...

    def update_metadata(self, profile_name: str, file_name: str, metadata_content: str) -> None:
        """Update metadata.json file."""
        ...

    def download_metadata(self, profile_name: str, output_name: str, dest_path: Path) -> None:
        """Download metadata.json for a recording."""
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

    def upload_input_file(self, local_path: Path, profile_name: str, filename: str) -> str:
        """Copy input file to local inputs directory and return path."""
        inputs_dir = Path("inputs") / profile_name
        inputs_dir.mkdir(parents=True, exist_ok=True)

        dest_path = inputs_dir / filename
        shutil.copy2(local_path, dest_path)

        return str(dest_path)

    def get_input_url(self, profile_name: str, filename: str) -> str:
        """Get path for accessing an input file (local filesystem)."""
        return str(Path("inputs") / profile_name / filename)

    def download_input_file(self, profile_name: str, filename: str, dest_path: Path) -> None:
        """Copy input file from inputs directory to destination."""
        source_path = Path("inputs") / profile_name / filename
        shutil.copy2(source_path, dest_path)

    def update_metadata(self, profile_name: str, file_name: str, metadata_content: str) -> None:
        """Update metadata.json file."""
        metadata_path = Path("media") / profile_name / file_name / "metadata.json"
        metadata_path.parent.mkdir(parents=True, exist_ok=True)
        with open(metadata_path, "w") as f:
            f.write(metadata_content)

    def download_metadata(self, profile_name: str, output_name: str, dest_path: Path) -> None:
        """Download metadata.json for a recording (copy from local)."""
        source_path = Path("media") / profile_name / output_name / "metadata.json"
        shutil.copy2(source_path, dest_path)


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

    def upload_file(
        self,
        local_path: Path,
        profile_name: str,
        file_name: str,
        object_name: str,
        extra_metadata: dict[str, str] | None = None
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
            str(local_path),
            self.config.bucket_name,
            key,
            ExtraArgs={"Metadata": metadata}
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
            ExtraArgs={
                "Metadata": {
                    "sha256": file_sha256
                }
            }
        )
        return key

    def get_input_url(self, profile_name: str, filename: str) -> str:
        """Get presigned URL or public URL for accessing an input file."""
        key = f"inputs/{profile_name}/{filename}"

        # If public URL is configured, use it directly
        if self.config.public_url:
            return f"{self.config.public_url}/{key}"

        # Otherwise generate presigned URL (valid for 1 hour)
        return self.s3_client.generate_presigned_url(
            "get_object",
            Params={"Bucket": self.config.bucket_name, "Key": key},
            ExpiresIn=3600,
        )

    def download_input_file(self, profile_name: str, filename: str, dest_path: Path) -> None:
        """Download an input file from R2 to local destination."""
        key = f"inputs/{profile_name}/{filename}"
        self.s3_client.download_file(
            self.config.bucket_name,
            key,
            str(dest_path),
        )

    def update_metadata(self, profile_name: str, file_name: str, metadata_content: str) -> None:
        """Update metadata.json file in R2."""
        key = f"{profile_name}/{file_name}/metadata.json"
        self.s3_client.put_object(
            Bucket=self.config.bucket_name,
            Key=key,
            Body=metadata_content.encode("utf-8"),
            ContentType="application/json",
        )

    def download_metadata(self, profile_name: str, output_name: str, dest_path: Path) -> None:
        """Download metadata.json for a recording from R2."""
        key = f"{profile_name}/{output_name}/metadata.json"
        self.s3_client.download_file(
            self.config.bucket_name,
            key,
            str(dest_path),
        )


# Global storage instance
_storage: StorageBackend | None = None


def get_storage(config: Config | None = None) -> StorageBackend:
    """Get the configured storage backend.

    For API routes: Always uses R2 if configured, otherwise LocalStorage.
    For CLI: Not used directly - CLI manages local files and syncs with R2.
    """
    global _storage

    if _storage is not None:
        return _storage

    # Load config if not provided
    if config is None:
        from .config import get_config
        config = get_config()

    # Use R2 if configured, otherwise local storage
    if config.r2 is not None:
        _storage = R2Storage(config.r2)
    else:
        _storage = LocalStorage()

    return _storage
