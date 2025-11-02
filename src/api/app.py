"""Litestar app configuration and lifecycle management."""

from __future__ import annotations

import os
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from pathlib import Path

from litestar import Litestar
from litestar.config.cors import CORSConfig
from litestar.middleware import DefineMiddleware
from litestar.static_files import (
    create_static_files_router,  # pyright: ignore[reportUnknownVariableType]
)

from ..auth import JWTAuthenticationMiddleware
from ..config import get_config
from ..db.config import get_engine
from .auth_routes import auth_callback, auth_login, auth_logout, auth_status
from .config_routes import update_recording_config
from .profile_routes import (
    delete_recording_endpoint,
    get_profile,
    get_profile_files,
    get_profiles,
    update_display_name,
)
from .state import AppState
from .upload_routes import (
    get_recording_status,
    process_local,
    recording_complete,
    upload_file,
)


@asynccontextmanager
async def database_lifespan(_app: Litestar) -> AsyncGenerator[None, None]:
    """Manage database engine lifecycle.

    Initializes the database engine on startup and disposes it on shutdown.
    """
    # Initialize engine on startup
    engine = get_engine()
    print("Database engine initialized")

    try:
        yield
    finally:
        # Dispose engine on shutdown
        await engine.dispose()
        print("Database engine disposed")


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

# Get frontend URL (defaults to localhost:5173 for development)
frontend_url = os.getenv("FRONTEND_URL", "http://localhost:5173")
if frontend_url not in ["/", ""]:
    allowed_origins.append(frontend_url)

cors_config = CORSConfig(
    allow_origins=allowed_origins,
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["*"],
    allow_credentials=True,
)

# Load configuration and set up state
config = get_config()

# Get backend URL for callbacks (defaults to localhost:8000 if not set)
backend_url = os.getenv("BACKEND_URL", "http://localhost:8000")

# Create type-safe state (State subclass with dict-based attributes)
app_state = AppState()
app_state.config = config
app_state.backend_url = backend_url
app_state.frontend_url = frontend_url

# Authentication configuration - exclude certain routes from auth requirement
auth_middleware = DefineMiddleware(
    JWTAuthenticationMiddleware,
    exclude=[
        "/auth",  # Auth routes (login, callback, etc.)
        "/schema",  # OpenAPI schema
        "/api/process",  # Internal worker endpoint (local processing)
        r"/api/recordings/.*/complete/.*",  # Worker callback endpoint (regex pattern)
    ],
)

worker_routes = [process_local] if not config.gpu_worker_url else []

app = Litestar(
    route_handlers=[
        auth_status,
        auth_login,
        auth_callback,
        auth_logout,
        get_profiles,
        get_profile,
        get_profile_files,
        update_display_name,
        delete_recording_endpoint,
        update_recording_config,
        upload_file,
        recording_complete,
        get_recording_status,
        *worker_routes,
        *static_handlers,
    ],
    middleware=[auth_middleware],
    cors_config=cors_config,
    state=app_state,  # Pass the State subclass directly
    request_max_body_size=1024 * 1024 * 150,  # 150MB max upload size
    lifespan=[database_lifespan],
)
