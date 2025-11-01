# pyright: reportUnreachable=false
"""Authentication module for Google OAuth and JWT."""

from __future__ import annotations

import os
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING

import jwt
from litestar.connection import ASGIConnection
from litestar.exceptions import NotAuthorizedException
from litestar.middleware.authentication import AbstractAuthenticationMiddleware, AuthenticationResult
from pydantic import BaseModel

if TYPE_CHECKING:
    from .config import Config


class TokenData(BaseModel):
    """JWT token payload data."""

    email: str
    name: str | None = None
    picture: str | None = None
    exp: datetime


class UserInfo(BaseModel):
    """User information from Google OAuth."""

    email: str
    name: str
    picture: str


class AuthenticatedUser(BaseModel):
    """Authenticated user model for request.user."""

    email: str
    name: str | None = None
    picture: str | None = None


def is_auth_bypassed() -> bool:
    """Check if auth is bypassed via environment variable."""
    return os.getenv("STEMSET_BYPASS_AUTH", "false").lower() in ("true", "1", "yes")


def is_email_allowed(email: str, config: Config) -> bool:
    """Check if email is in the allowed list."""
    if config.auth is None:
        return False
    return email.lower() in [e.lower() for e in config.auth.allowed_emails]


def create_jwt_token(email: str, secret: str, name: str | None = None, picture: str | None = None, expires_delta: timedelta | None = None) -> str:
    """Create a JWT token for the user.

    Args:
        email: User's email address
        secret: JWT secret key
        name: User's display name
        picture: User's profile picture URL
        expires_delta: Token expiration time (default: 30 days)

    Returns:
        Encoded JWT token string
    """
    if expires_delta is None:
        expires_delta = timedelta(days=30)
    expire = datetime.now(UTC) + expires_delta
    payload = {"email": email, "name": name, "picture": picture, "exp": expire}
    return jwt.encode(payload, secret, algorithm="HS256")


def decode_jwt_token(token: str, secret: str) -> TokenData:
    """Decode and validate a JWT token.

    Args:
        token: JWT token string
        secret: JWT secret key

    Returns:
        TokenData with email and expiration

    Raises:
        NotAuthorizedException: If token is invalid or expired
    """
    try:
        payload = jwt.decode(token, secret, algorithms=["HS256"])
        return TokenData(
            email=payload["email"],
            name=payload.get("name"),
            picture=payload.get("picture"),
            exp=datetime.fromtimestamp(payload["exp"])
        )
    except jwt.ExpiredSignatureError as e:
        raise NotAuthorizedException(detail="Token has expired") from e
    except jwt.InvalidTokenError as e:
        raise NotAuthorizedException(detail="Invalid token") from e


def extract_token_from_request(connection: ASGIConnection) -> str | None:
    """Extract JWT token from request cookies or Authorization header.

    Args:
        connection: Litestar ASGI connection

    Returns:
        JWT token string or None if not found
    """
    # Try cookie first
    token = connection.cookies.get("stemset_token")
    if token:
        return token

    # Try Authorization header
    auth_header = connection.headers.get("Authorization")
    if auth_header and auth_header.startswith("Bearer "):
        return auth_header[7:]  # Remove "Bearer " prefix

    return None


class JWTAuthenticationMiddleware(AbstractAuthenticationMiddleware):
    """Litestar authentication middleware using JWT tokens.

    This middleware:
    1. Bypasses auth if STEMSET_BYPASS_AUTH=true
    2. Extracts JWT from cookie or Authorization header
    3. Validates JWT and checks email against allowlist
    4. Populates request.user with AuthenticatedUser
    """

    async def authenticate_request(self, connection: ASGIConnection) -> AuthenticationResult:
        """Authenticate request and return user.

        Args:
            connection: ASGI connection

        Returns:
            AuthenticationResult with authenticated user

        Raises:
            NotAuthorizedException: If authentication fails
        """
        # Bypass auth if environment variable is set (development mode)
        if is_auth_bypassed():
            # Return anonymous user for dev mode
            return AuthenticationResult(
                user=AuthenticatedUser(email="dev@localhost"),
                auth=None,
            )

        # Extract and validate token
        token = extract_token_from_request(connection)
        if not token:
            raise NotAuthorizedException(detail="No authentication token provided")

        from .config import get_config
        config = get_config()

        # Decode token
        if config.auth is None:
            raise NotAuthorizedException(detail="Authentication not configured")

        token_data = decode_jwt_token(token, config.auth.jwt_secret)

        # Check if email is allowed
        if not is_email_allowed(token_data.email, config):
            raise NotAuthorizedException(detail="Email not authorized")

        # Return authenticated user
        return AuthenticationResult(
            user=AuthenticatedUser(
                email=token_data.email,
                name=token_data.name,
                picture=token_data.picture,
            ),
            auth=token,
        )
