from typing import Any
from litestar.connection import ASGIConnection
from litestar.connection.request import Request
from pydantic import BaseModel


class AuthenticatedUser(BaseModel):
    """Authenticated user model for request.user."""

    email: str
    name: str | None = None
    picture: str | None = None


type AppRequest = Request[AuthenticatedUser, str, Any]  # pyright: ignore[reportExplicitAny]

type AuthConnection = ASGIConnection[Any, AuthenticatedUser, str, Any]  # pyright: ignore[reportExplicitAny]
