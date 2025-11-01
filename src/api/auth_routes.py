"""OAuth and authentication endpoints."""

import os
import secrets
from urllib.parse import urlencode

import httpx

from datetime import datetime, timezone
from typing import Annotated

from litestar import get
from litestar.exceptions import NotAuthorizedException
from litestar.params import Parameter
from litestar.response import Redirect
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.api.types import AppRequest

from ..auth import (
    UserInfo,
    create_jwt_token,
    decode_jwt_token,
    extract_token_from_request,
    is_auth_bypassed,
    is_email_allowed,
)
from ..config import get_config
from ..db.config import get_engine
from ..db.models import User
from .models import AuthStatusResponse, LogoutResponse

_oauth_states: dict[str, str] = {}


@get("/auth/status")
async def auth_status(request: AppRequest) -> AuthStatusResponse:
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
    """Handle Google OAuth callback.

    This endpoint redirects to the frontend with the token in the URL fragment.
    The frontend will extract the token and store it in localStorage.
    """
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
        _ = token_response.raise_for_status()
        tokens = token_response.json()

        userinfo_response = await client.get(
            "https://www.googleapis.com/oauth2/v2/userinfo",
            headers={"Authorization": f"Bearer {tokens['access_token']}"},
        )
        _ = userinfo_response.raise_for_status()
        userinfo = UserInfo(**userinfo_response.json())

    if not is_email_allowed(userinfo.email, config):
        raise NotAuthorizedException(detail=f"Email {userinfo.email} is not authorized")

    # Upsert User record in database
    engine = get_engine()
    async with AsyncSession(engine, expire_on_commit=False) as session:
        # Check if user exists
        result = await session.exec(select(User).where(User.email == userinfo.email))
        user = result.first()

        if user:
            # Update existing user
            user.name = userinfo.name
            user.picture_url = userinfo.picture
            user.last_login_at = datetime.now(timezone.utc)
        else:
            # Create new user
            user = User(
                email=userinfo.email,
                name=userinfo.name,
                picture_url=userinfo.picture,
            )
            session.add(user)

        await session.commit()

    jwt_token = create_jwt_token(
        userinfo.email, config.auth.jwt_secret, userinfo.name, userinfo.picture
    )

    # Redirect to frontend with token in URL fragment (not query string for security)
    # Fragment is not sent to server, only accessible to JavaScript
    frontend_url = os.getenv("FRONTEND_URL", "http://localhost:5173")
    redirect_url = f"{frontend_url}#token={jwt_token}"

    return Redirect(path=redirect_url)


@get("/auth/logout")
async def auth_logout() -> LogoutResponse:
    """Logout user.

    With localStorage-based JWT, logout is handled client-side by removing
    the token from localStorage. This endpoint exists for API consistency.
    """
    return LogoutResponse(success=True)
