"""OAuth and authentication endpoints."""

from __future__ import annotations

import os
import secrets
from urllib.parse import urlencode

import httpx

from typing import Annotated, Any

from litestar import get
from litestar.connection import Request
from litestar.exceptions import NotAuthorizedException
from litestar.params import Parameter
from litestar.response import Redirect, Response

from ..auth import (
    UserInfo,
    create_jwt_token,
    decode_jwt_token,
    extract_token_from_request,
    is_auth_bypassed,
    is_email_allowed,
)
from ..config import get_config
from .models import AuthStatusResponse, LogoutResponse

_oauth_states: dict[str, str] = {}


@get("/auth/status")
async def auth_status(request: Request[Any, Any, Any]) -> AuthStatusResponse:  # pyright: ignore[reportExplicitAny]
    """Get current auth status and user info"""
    config = get_config()

    if is_auth_bypassed():
        return AuthStatusResponse(
            authenticated=True,
            user={
                "id": "dev-user",
                "name": "Development User",
                "email": "dev@localhost",
                "picture": None,
            },
        )

    token = extract_token_from_request(request)
    if not token:
        return AuthStatusResponse(authenticated=False)

    try:
        user_info = decode_jwt_token(token, config.auth.jwt_secret if config.auth else "")
        return AuthStatusResponse(
            authenticated=True,
            user={
                "id": user_info.email,
                "name": user_info.name
                or user_info.email.split("@")[
                    0
                ],  # Use real name from Google, fallback to email prefix
                "email": user_info.email,
                "picture": user_info.picture,
            },
        )
    except Exception:
        return AuthStatusResponse(authenticated=False)


@get("/auth/login")
async def auth_login() -> Redirect:
    """Redirect to Google OAuth login page."""
    config = get_config()
    if config.auth is None:
        raise NotAuthorizedException(detail="Authentication not configured")

    state = secrets.token_urlsafe(32)
    _oauth_states[state] = state

    params = {
        "client_id": config.auth.google_client_id,
        "redirect_uri": config.auth.redirect_uri,
        "response_type": "code",
        "scope": "openid email profile",
        "state": state,
    }
    auth_url = f"https://accounts.google.com/o/oauth2/v2/auth?{urlencode(params)}"

    return Redirect(path=auth_url)


@get("/auth/callback")
async def auth_callback(
    code: str, callback_state: Annotated[str, Parameter(query="state")]
) -> Redirect:
    """Handle Google OAuth callback."""
    config = get_config()
    if config.auth is None:
        raise NotAuthorizedException(detail="Authentication not configured")

    if callback_state not in _oauth_states:
        raise NotAuthorizedException(detail="Invalid state parameter")
    _ = _oauth_states.pop(callback_state)

    async with httpx.AsyncClient() as client:
        token_response = await client.post(
            "https://oauth2.googleapis.com/token",
            data={
                "code": code,
                "client_id": config.auth.google_client_id,
                "client_secret": config.auth.google_client_secret,
                "redirect_uri": config.auth.redirect_uri,
                "grant_type": "authorization_code",
            },
        )
        token_response.raise_for_status()
        tokens = token_response.json()

        userinfo_response = await client.get(
            "https://www.googleapis.com/oauth2/v2/userinfo",
            headers={"Authorization": f"Bearer {tokens['access_token']}"},
        )
        userinfo_response.raise_for_status()
        userinfo = UserInfo(**userinfo_response.json())

    if not is_email_allowed(userinfo.email, config):
        raise NotAuthorizedException(detail=f"Email {userinfo.email} is not authorized")

    jwt_token = create_jwt_token(
        userinfo.email, config.auth.jwt_secret, userinfo.name, userinfo.picture
    )

    frontend_url = os.getenv("FRONTEND_URL", "http://localhost:5173")
    is_dev = frontend_url.startswith("http://localhost")

    # For production cross-site cookies, we need:
    # 1. secure=True (HTTPS only)
    # 2. samesite="none" (allow cross-origin)
    # 3. httponly=True (security)
    # 4. Partitioned attribute (Chrome requirement for CHIPS)

    # Build cookie value manually to include Partitioned attribute
    # Litestar's Cookie class doesn't support Partitioned, so we set it via raw header
    max_age = 30 * 24 * 60 * 60  # 30 days

    if is_dev:
        # Development: standard cookie with domain=localhost
        cookie_parts = [
            f"stemset_token={jwt_token}",
            "Path=/",
            f"Max-Age={max_age}",
            "Domain=localhost",
            "HttpOnly",
            "SameSite=Lax",
        ]
    else:
        # Production: cross-site cookie with Partitioned attribute
        cookie_parts = [
            f"stemset_token={jwt_token}",
            "Path=/",
            f"Max-Age={max_age}",
            "Secure",
            "HttpOnly",
            "SameSite=None",
            "Partitioned",  # Chrome CHIPS requirement
        ]

    cookie_header = "; ".join(cookie_parts)

    response = Redirect(path=frontend_url)
    # Set cookie via raw header instead of set_cookie() to support Partitioned
    response.headers["set-cookie"] = cookie_header

    return response


@get("/auth/logout")
async def auth_logout() -> Response[LogoutResponse]:
    """Logout user by clearing token cookie.

    Returns a JSON response instead of redirecting to avoid CORS issues
    with redirect chains when credentials are included.
    """
    frontend_url = os.getenv("FRONTEND_URL", "http://localhost:5173")
    is_dev = frontend_url.startswith("http://localhost")

    # To delete a cookie, we need to set it with Max-Age=0 and the same attributes
    # that were used when setting it (especially Path, Domain, Secure, SameSite, Partitioned)
    if is_dev:
        cookie_parts = [
            "stemset_token=",
            "Path=/",
            "Max-Age=0",
            "Domain=localhost",
            "HttpOnly",
            "SameSite=Lax",
        ]
    else:
        cookie_parts = [
            "stemset_token=",
            "Path=/",
            "Max-Age=0",
            "Secure",
            "HttpOnly",
            "SameSite=None",
            "Partitioned",
        ]

    cookie_header = "; ".join(cookie_parts)

    # Create response with cookie deletion
    response = Response(content=LogoutResponse(success=True))
    response.headers["set-cookie"] = cookie_header

    return response
