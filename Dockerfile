# Multi-stage Dockerfile for Stemset
# Target 'api': Lightweight Litestar API (for Koyeb deployment)
# Target 'processing': Full processing environment with ML dependencies (for local Docker processing)

FROM python:3.13-slim AS base

# Install uv for fast dependency management
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

# Set working directory
WORKDIR /app

# Copy dependency files
COPY pyproject.toml uv.lock ./

# ============================================================================
# API Target - Lightweight backend for production deployment (Koyeb)
# ============================================================================
FROM base AS api

# Install API dependencies + shared dependencies
RUN uv sync --frozen --no-dev --group shared

# Copy source code
COPY src/ ./src/
COPY config.yaml ./

# Expose port
EXPOSE 8000

# Run uvicorn directly from the venv (don't use `uv run` which re-syncs)
CMD [".venv/bin/uvicorn", "src.api.app:app", "--host", "0.0.0.0", "--port", "8000"]
