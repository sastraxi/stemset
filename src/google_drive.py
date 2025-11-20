"Google Drive API client for accessing user files."

from __future__ import annotations

from aiogoogle.auth.creds import ClientCreds, UserCreds
from aiogoogle.client import Aiogoogle
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
    sha256Checksum: str | None = None  # SHA256 hash for binary files


class DriveFileList(BaseModel):
    """Response from Drive files.list API."""

    files: list[DriveFile]
    nextPageToken: str | None = None


class GoogleDriveClient:
    """Client for Google Drive API v3.

    Handles OAuth token refresh and file operations using aiogoogle.
    """

    def __init__(self, config: Config, refresh_token: str):
        """Initialize Drive client with user's refresh token.

        Args:
            config: Application config with Google OAuth credentials
            refresh_token: User's Google OAuth refresh token
        """
        if config.auth is None:
            raise ValueError("Auth configuration required for Drive API")

        self.client_creds = ClientCreds(
            client_id=config.auth.google_client_id,
            client_secret=config.auth.google_client_secret,
        )
        self.user_creds = UserCreds(refresh_token=refresh_token)
        self.aiogoogle = Aiogoogle(client_creds=self.client_creds)

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
            Exception: If API request fails
        """
        drive_v3 = await self.aiogoogle.discover("drive", "v3")

        audio_mimetypes = [
            "audio/wav",
            "audio/x-wav",
            "audio/flac",
            "audio/mpeg",
            "audio/mp4",
            "audio/aac",
            "audio/opus",
            "audio/ogg",
        ]
        query_parts = [
            f"'{folder_id}' in parents",
            "trashed = false",
            f"(mimeType = 'application/vnd.google-apps.folder' or {' or '.join([f'mimeType = "{mt}"' for mt in audio_mimetypes])})",
        ]
        query = " and ".join(query_parts)

        params = {
            "q": query,
            "fields": "files(id,name,mimeType,modifiedTime,size,parents,sha256Checksum),nextPageToken",
            "orderBy": "folder,name",
            "pageSize": 100,
        }
        if page_token:
            params["pageToken"] = page_token

        req = drive_v3.files.list(**params)
        data = await self.aiogoogle.as_user(req, user_creds=self.user_creds)
        return DriveFileList(**data)

    async def get_file_metadata(self, file_id: str) -> DriveFile:
        """Get metadata for a specific Drive file.

        Args:
            file_id: Google Drive file ID

        Returns:
            File metadata

        Raises:
            Exception: If API request fails
        """
        drive_v3 = await self.aiogoogle.discover("drive", "v3")
        params = {
            "fileId": file_id,
            "fields": "id,name,mimeType,modifiedTime,size,parents,sha256Checksum",
        }
        req = drive_v3.files.get(**params)
        data = await self.aiogoogle.as_user(req, user_creds=self.user_creds)
        return DriveFile(**data)

    async def download_file(self, file_id: str, local_path: str) -> None:
        """Download a Drive file to local filesystem.

        Args:
            file_id: Google Drive file ID
            local_path: Local path to save file

        Raises:
            Exception: If download fails
        """
        drive_v3 = await self.aiogoogle.discover("drive", "v3")
        params = {"fileId": file_id, "alt": "media"}
        req = drive_v3.files.get(**params)
        response = await self.aiogoogle.as_user(req, user_creds=self.user_creds)

        with open(local_path, "wb") as f:
            _ = f.write(response)
