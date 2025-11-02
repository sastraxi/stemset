#!/bin/bash
set -e

echo "🎵 Setting up Stemset..."

# Check for uv
if ! command -v uv &> /dev/null; then
    echo "Error: uv is not installed. Please install it first:"
    echo "  curl -LsSf https://astral.sh/uv/install.sh | sh"
    exit 1
fi

# Check for bun
if ! command -v bun &> /dev/null; then
    echo "Error: bun is not installed. Please install it first:"
    echo "  curl -fsSL https://bun.sh/install | bash"
    exit 1
fi

# Check for ffmpeg
if ! command -v ffmpeg &> /dev/null; then
    echo "Error: ffmpeg is not installed. Please install it first."
    echo "  On macOS: brew install ffmpeg"
    echo "  On Ubuntu/Debian: sudo apt-get install ffmpeg"
    exit 1
fi

echo "✓ Dependencies check passed"

# Install Python dependencies
echo ""
echo "📦 Installing Python dependencies..."
echo "   - API dependencies (lightweight)"
echo "   - Shared dependencies (pydantic, boto3, httpx, pyyaml)"
echo "   - Processing dependencies (ML models, audio libraries)"
uv sync  # Installs default-groups: shared + processing

# Install frontend dependencies
echo ""
echo "📦 Installing frontend dependencies..."
cd frontend
bun install
cd ..

echo ""
echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo ""
echo "1. Set up database:"
echo "   For local development:"
echo "     docker compose up -d  # Start PostgreSQL container"
echo "     alembic upgrade head   # Run database migrations"
echo ""
echo "2. Run development servers:"
echo "   Terminal 1: ./dev.sh              # Backend API"
echo "   Terminal 2: cd frontend && bun run dev  # Frontend"
echo ""
echo "3. Deploy to production:"
echo "   See docs/deployment.md for complete deployment guide"
echo "   Includes PostgreSQL setup on Koyeb/Modal/Cloudflare Pages/R2"
echo ""
