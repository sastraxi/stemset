# Multi-stage Dockerfile for Stemset
# Target 'api': Lightweight Litestar API (for Koyeb deployment)
# Target 'processing': Full processing environment with ML dependencies (for local Docker processing)
# Target 'gpu-worker': GPU processing worker with CUDA support (for Koyeb GPU instances)

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

# Install only API dependencies (no processing group, no dev group)
RUN uv sync --frozen --no-dev

# Copy source code
COPY src/ ./src/
COPY config.yaml ./

# Expose port
EXPOSE 8000

# Run uvicorn directly from the venv (don't use `uv run` which re-syncs)
CMD [".venv/bin/uvicorn", "src.api.app:app", "--host", "0.0.0.0", "--port", "8000"]

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

# ============================================================================
# GPU Worker Target - GPU processing worker with CUDA support
# ============================================================================
FROM nvidia/cuda:12.4.0-base-ubuntu22.04 AS gpu-worker

# Install Python 3.13 and system dependencies
RUN apt-get update && apt-get install -y \
    python3.13 \
    python3.13-venv \
    python3-pip \
    libsndfile1 \
    libopus0 \
    ffmpeg \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

# Set working directory
WORKDIR /app

# Copy dependency files
COPY pyproject.toml uv.lock ./

# Install all dependencies including processing group
# Note: PyTorch will automatically use CUDA if available
RUN uv sync --frozen --no-dev --group processing

# Copy source code
COPY src/ ./src/
COPY config.yaml ./

# Set model cache directory
ENV STEMSET_MODEL_CACHE_DIR=/app/.models

# Expose port for HTTP endpoint
EXPOSE 8000

# Run GPU worker service
CMD [".venv/bin/uvicorn", "src.gpu_worker.app:app", "--host", "0.0.0.0", "--port", "8000"]
