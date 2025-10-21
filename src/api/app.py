"""Litestar app configuration and lifecycle management."""

from __future__ import annotations

from pathlib import Path

from litestar import Litestar
from litestar.config.cors import CORSConfig
from litestar.static_files import create_static_files_router

from ..auth import auth_middleware
from .auth_routes import auth_callback, auth_login, auth_logout, get_auth_status
from .profile_routes import (
    get_file_metadata,
    get_profile,
    get_profile_files,
    get_profiles,
    get_stem_waveform,
)


media_router = create_static_files_router(
    path="/media",
    directories=["media"],
)

frontend_dist = Path("frontend/dist")
if frontend_dist.exists():
    frontend_router = create_static_files_router(
        path="/",
        directories=[str(frontend_dist)],
        html_mode=True,
    )
    static_handlers = [media_router, frontend_router]
else:
    static_handlers = [media_router]

cors_config = CORSConfig(
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
    allow_credentials=True,
)

app = Litestar(
    route_handlers=[
        get_auth_status,
        auth_login,
        auth_callback,
        auth_logout,
        get_profiles,
        get_profile,
        get_profile_files,
        get_file_metadata,
        get_stem_waveform,
        *static_handlers,
    ],
    middleware=[auth_middleware],
    cors_config=cors_config,
)
