"""Type-safe application state for Litestar."""

from __future__ import annotations

from litestar.datastructures import State

from ..config import Config


class AppState(State):
    """Type-safe application state.

    Subclassing State allows proper type checking when injected into handlers.

    Note: Attributes are set directly on the State dict, not as class attributes.
    This avoids deserialization issues with Litestar's signature model.
    """

    config: Config
    backend_url: str
    frontend_url: str
