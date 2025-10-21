#!/bin/bash
# Development server script for Stemset

uv run litestar --app src.api.app:app run --reload --host 0.0.0.0 --port 8000 --debug
