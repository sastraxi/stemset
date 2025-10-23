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

# Install only API dependencies (no processing group)
RUN uv sync --frozen --no-dev

# Copy source code
COPY src/ ./src/
COPY config.yaml ./

# Expose port
EXPOSE 8000

# Run uvicorn
CMD ["uv", "run", "uvicorn", "src.api.app:app", "--host", "0.0.0.0", "--port", "8000"]

# ============================================================================
# Processing Target - Full environment with ML dependencies
# ============================================================================
FROM base AS processing

# Install system dependencies for audio processing
RUN apt-get update && apt-get install -y \
    libsndfile1 \
    libopus0 \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Install all dependencies including processing group
RUN uv sync --frozen --no-dev --group processing

# Copy source code
COPY src/ ./src/
COPY config.yaml ./

# Set model cache directory
ENV STEMSET_MODEL_CACHE_DIR=/app/.models

# Create media directory
RUN mkdir -p /app/media

# Default command runs the CLI
ENTRYPOINT ["uv", "run", "stemset"]
CMD ["--help"]
