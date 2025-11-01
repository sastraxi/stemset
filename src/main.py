"""Main entry point for Stemset backend."""

import uvicorn

from .api.app import app
from .config import load_config


def main():
    """Run the Stemset backend server."""
    _ = load_config()
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=8000,
        log_level="info",
    )


if __name__ == "__main__":
    main()
