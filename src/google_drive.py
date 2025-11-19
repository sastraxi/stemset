"""Google Drive API client for accessing user files."""

from __future__ import annotations

import httpx
from pydantic import BaseModel

from .config import Config


class DriveFile(BaseModel):
    """Google Drive file metadata."""

    id: str
    name: str
    mimeType: str
    modifiedTime: str  # ISO 8601 format
    size: int | None = None  # Folders don't have size
    parents: list[str] | None = None


class DriveFileList(BaseModel):
    """Response from Drive files.list API."""

    files: list[DriveFile]
    nextPageToken: str | None = None


class GoogleDriveClient:
    """Client for Google Drive API v3.

    Handles OAuth token refresh and file operations.
    """

    def __init__(self, config: Config, refresh_token: str):
        """Initialize Drive client with user's refresh token.

        Args:
            config: Application config with Google OAuth credentials
            refresh_token: User's Google OAuth refresh token
        """
        if config.auth is None:
            raise ValueError("Auth configuration required for Drive API")

        self.config = config
        self.refresh_token = refresh_token
        self._access_token: str | None = None

    async def _ensure_access_token(self) -> str:
        """Get valid access token, refreshing if necessary.

        Returns:
            Valid Google OAuth access token

        Raises:
            httpx.HTTPError: If token refresh fails
        """
        if self._access_token:
            # TODO: Check expiration and refresh if needed
            # For now, we refresh on every request (simpler but less efficient)
            pass

        # Refresh access token using refresh token
        async with httpx.AsyncClient() as client:
            response = await client.post(
                "https://oauth2.googleapis.com/token",
                data={
                    "client_id": self.config.auth.google_client_id,
                    "client_secret": self.config.auth.google_client_secret,
                    "refresh_token": self.refresh_token,
                    "grant_type": "refresh_token",
                },
            )
            response.raise_for_status()
            tokens = response.json()
            self._access_token = tokens["access_token"]

        return self._access_token

    async def list_folder_contents(
        self, folder_id: str, page_token: str | None = None
    ) -> DriveFileList:
        """List contents of a Google Drive folder.

        Args:
            folder_id: Google Drive folder ID
            page_token: Pagination token for next page

        Returns:
            List of files/folders with metadata

        Raises:
            httpx.HTTPError: If API request fails
        """
        access_token = await self._ensure_access_token()

        # Audio file MIME types to filter
        audio_mimetypes = [
            "audio/wav",
            "audio/x-wav",
            "audio/flac",
            "audio/mpeg",  # MP3
            "audio/mp4",  # M4A
            "audio/aac",
            "audio/opus",
            "audio/ogg",
        ]

        # Query: files in this folder that are either folders or audio files
        query_parts = [
            f"'{folder_id}' in parents",
            "trashed = false",
            f"(mimeType = 'application/vnd.google-apps.folder' or {' or '.join(f'mimeType = \"{mt}\"' for mt in audio_mimetypes)})",
        ]
        query = " and ".join(query_parts)

        params = {
            "q": query,
            "fields": "files(id,name,mimeType,modifiedTime,size,parents),nextPageToken",
            "orderBy": "folder,name",  # Folders first, then alphabetical
            "pageSize": 100,
        }

        if page_token:
            params["pageToken"] = page_token

        async with httpx.AsyncClient() as client:
            response = await client.get(
                "https://www.googleapis.com/drive/v3/files",
                headers={"Authorization": f"Bearer {access_token}"},
                params=params,
            )
            response.raise_for_status()
            data = response.json()

        return DriveFileList(**data)

    async def get_file_metadata(self, file_id: str) -> DriveFile:
        """Get metadata for a specific Drive file.

        Args:
            file_id: Google Drive file ID

        Returns:
            File metadata

        Raises:
            httpx.HTTPError: If API request fails
        """
        access_token = await self._ensure_access_token()

        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"https://www.googleapis.com/drive/v3/files/{file_id}",
                headers={"Authorization": f"Bearer {access_token}"},
                params={"fields": "id,name,mimeType,modifiedTime,size,parents"},
            )
            response.raise_for_status()
            data = response.json()

        return DriveFile(**data)

    async def download_file(self, file_id: str, local_path: str) -> None:
        """Download a Drive file to local filesystem.

        Args:
            file_id: Google Drive file ID
            local_path: Local path to save file

        Raises:
            httpx.HTTPError: If download fails
        """
        access_token = await self._ensure_access_token()

        async with httpx.AsyncClient(timeout=300.0) as client:  # 5min timeout for large files
            response = await client.get(
                f"https://www.googleapis.com/drive/v3/files/{file_id}",
                headers={"Authorization": f"Bearer {access_token}"},
                params={"alt": "media"},  # Download actual file content
                follow_redirects=True,
            )
            response.raise_for_status()

            # Write to file
            with open(local_path, "wb") as f:
                f.write(response.content)
