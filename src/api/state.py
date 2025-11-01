"""Type-safe application state for Litestar."""

from __future__ import annotations

from litestar.datastructures import State

from ..config import Config


class AppState(State):
    """Type-safe application state.

    Subclassing State allows proper type checking when injected into handlers.
    """

    config: Config
    backend_url: str
    frontend_url: str

    def __init__(self, config: Config, backend_url: str, frontend_url: str) -> None:
        super().__init__()
        self.config = config
        self.backend_url = backend_url
        self.frontend_url = frontend_url
