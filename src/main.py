"""Main entry point for Stemset backend."""

import uvicorn

from .api.app import app
from .config import load_config


def main():
    """Run the Stemset backend server."""
    # Load configuration on startup
    config = load_config()
    print(f"Loaded {len(config.profiles)} profile(s)")
    for profile in config.profiles:
        print(f"  - {profile.name}: {profile.source_folder}")

    # Run server
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=8000,
        log_level="info",
    )


if __name__ == "__main__":
    main()
