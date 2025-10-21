# pyright: reportUnreachable=false
"""Authentication module for Google OAuth and JWT."""

from __future__ import annotations

import os
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, Any

import jwt
from litestar.connection import ASGIConnection
from litestar.exceptions import NotAuthorizedException
from litestar.middleware import DefineMiddleware
from litestar.types import ASGIApp, Receive, Scope, Send
from pydantic import BaseModel

if TYPE_CHECKING:
    from .config import Config


class TokenData(BaseModel):
    """JWT token payload data."""

    email: str
    picture: str | None = None
    exp: datetime


class UserInfo(BaseModel):
    """User information from Google OAuth."""

    email: str
    name: str
    picture: str


def is_auth_bypassed() -> bool:
    """Check if auth is bypassed via environment variable."""
    return os.getenv("STEMSET_BYPASS_AUTH", "false").lower() in ("true", "1", "yes")


def is_email_allowed(email: str, config: Config) -> bool:
    """Check if email is in the allowed list."""
    if config.auth is None:
        return False
    return email.lower() in [e.lower() for e in config.auth.allowed_emails]


def create_jwt_token(email: str, secret: str, picture: str | None = None, expires_delta: timedelta | None = None) -> str:
    """Create a JWT token for the user.

    Args:
        email: User's email address
        secret: JWT secret key
        picture: User's profile picture URL
        expires_delta: Token expiration time (default: 30 days)

    Returns:
        Encoded JWT token string
    """
    if expires_delta is None:
        expires_delta = timedelta(days=30)
    expire = datetime.now(UTC) + expires_delta
    payload = {"email": email, "picture": picture, "exp": expire}
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
            picture=payload.get("picture"),
            exp=datetime.fromtimestamp(payload["exp"])
        )
    except jwt.ExpiredSignatureError as e:
        raise NotAuthorizedException(detail="Token has expired") from e
    except jwt.InvalidTokenError as e:
        raise NotAuthorizedException(detail="Invalid token") from e


def extract_token_from_request(request: ASGIConnection[Any, Any, Any, Any]) -> str | None:
    """Extract JWT token from request cookies or Authorization header.

    Args:
        request: Litestar request object

    Returns:
        JWT token string or None if not found
    """
    # Try cookie first
    token = request.cookies.get("stemset_token")
    if token:
        return token

    # Try Authorization header
    auth_header = request.headers.get("Authorization")
    if auth_header and auth_header.startswith("Bearer "):
        return auth_header[7:]  # Remove "Bearer " prefix

    return None


class AuthMiddleware:
    """Middleware to protect routes with JWT authentication."""

    app: ASGIApp

    def __init__(self, app: ASGIApp) -> None:
        """Initialize middleware.

        Args:
            app: Next ASGI app in chain
        """
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        """Process request through auth middleware.

        This middleware:
        1. Bypasses auth if STEMSET_BYPASS_AUTH=true
        2. Allows unauthenticated access to /auth/* routes
        3. Requires valid JWT for all other routes
        4. Validates JWT and checks email against allowlist

        Args:
            scope: ASGI scope
            receive: ASGI receive callable
            send: ASGI send callable

        Raises:
            NotAuthorizedException: If authentication fails
        """
        # Only process HTTP requests (skip websockets, lifespan, etc.)
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        # Create a connection to access request details
        connection = ASGIConnection[str, str, str, str](scope=scope, receive=receive)

        # Bypass auth if environment variable is set
        if is_auth_bypassed():
            await self.app(scope, receive, send)
            return

        # Allow unauthenticated access to auth routes
        path = scope.get("path", "")
        if path.startswith("/auth/"):
            await self.app(scope, receive, send)
            return

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

        # Store user info in scope state for use in route handlers
        if "state" not in scope:
            scope["state"] = {}
        scope["state"]["user_email"] = token_data.email

        await self.app(scope, receive, send)


# Middleware definition for Litestar
auth_middleware = DefineMiddleware(AuthMiddleware)
