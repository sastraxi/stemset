"""Litestar app configuration and lifecycle management."""

from __future__ import annotations

import os
from pathlib import Path

from litestar import Litestar
from litestar.config.cors import CORSConfig
from litestar.datastructures import State
from litestar.static_files import create_static_files_router  # pyright: ignore[reportUnknownVariableType]

from ..auth import auth_middleware
from ..config import get_config
from .auth_routes import auth_callback, auth_login, auth_logout, auth_status
from .profile_routes import (
    get_profile,
    get_profile_files,
    get_profiles,
)
from .job_routes import job_complete, job_status, upload_file


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

# Allow CORS from development origins and production frontend
allowed_origins = [
    "http://localhost:5173",  # Vite dev server
    "http://localhost:3000",  # Alternative dev port
]

# Add production frontend URL from environment if set
frontend_url = os.getenv("FRONTEND_URL")
if frontend_url and frontend_url not in ["/", ""]:
    allowed_origins.append(frontend_url)

cors_config = CORSConfig(
    allow_origins=allowed_origins,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
    allow_credentials=True,
)

# Load configuration and set up state
config = get_config()

# Get base URL for callbacks (defaults to localhost:8000 if not set)
base_url = os.getenv("BACKEND_URL", "http://localhost:8000")

app = Litestar(
    route_handlers=[
        auth_status,
        auth_login,
        auth_callback,
        auth_logout,
        get_profiles,
        get_profile,
        get_profile_files,
        job_complete,
        job_status,
        upload_file,
        *static_handlers,
    ],
    middleware=[auth_middleware],
    cors_config=cors_config,
    state=State({"config": config, "base_url": base_url}),
    request_max_body_size=1024 * 1024 * 150,  # 150MB max upload size
)
