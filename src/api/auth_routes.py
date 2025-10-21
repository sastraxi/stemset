"""OAuth and authentication endpoints."""

from __future__ import annotations

import os
import secrets
from urllib.parse import urlencode

import httpx
from typing import Any

from litestar import get
from litestar.connection import Request
from litestar.exceptions import NotAuthorizedException
from litestar.params import Parameter
from litestar.response import Redirect

from ..auth import (
    UserInfo,
    create_jwt_token,
    decode_jwt_token,
    extract_token_from_request,
    is_auth_bypassed,
    is_email_allowed,
)
from ..config import get_config
from .models import AuthStatusResponse

_oauth_states: dict[str, str] = {}


@get("/auth/status")
async def get_auth_status(request: Request[Any, Any, Any]) -> AuthStatusResponse:
    """Get current authentication status."""
    if is_auth_bypassed():
        return AuthStatusResponse(authenticated=True, email="dev@localhost")

    token = extract_token_from_request(request)
    if not token:
        return AuthStatusResponse(authenticated=False)

    try:
        config = get_config()
        if config.auth is None:
            return AuthStatusResponse(authenticated=False)

        token_data = decode_jwt_token(token, config.auth.jwt_secret)

        if not is_email_allowed(token_data.email, config):
            return AuthStatusResponse(authenticated=False)

        return AuthStatusResponse(authenticated=True, email=token_data.email)
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
async def auth_callback(code: str, callback_state: str = Parameter(query="state")) -> Redirect:
    """Handle Google OAuth callback."""
    config = get_config()
    if config.auth is None:
        raise NotAuthorizedException(detail="Authentication not configured")

    if callback_state not in _oauth_states:
        raise NotAuthorizedException(detail="Invalid state parameter")
    _oauth_states.pop(callback_state)

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

    jwt_token = create_jwt_token(userinfo.email, config.auth.jwt_secret)

    frontend_url = os.getenv("FRONTEND_URL", "http://localhost:5173")
    is_dev = frontend_url.startswith("http://localhost")

    response = Redirect(path=frontend_url)
    response.set_cookie(
        key="stemset_token",
        value=jwt_token,
        httponly=True,
        secure=False if is_dev else True,
        samesite="lax",
        max_age=30 * 24 * 60 * 60,
        domain="localhost" if is_dev else None,
    )
    return response


@get("/auth/logout")
async def auth_logout() -> Redirect:
    """Logout user by clearing token cookie."""
    frontend_url = os.getenv("FRONTEND_URL", "http://localhost:5173")
    response = Redirect(path=frontend_url)
    response.delete_cookie(key="stemset_token")
    return response
