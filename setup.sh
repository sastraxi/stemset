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
echo "1. Configure your profiles:"
echo "   Edit config.yaml and set source_folder paths"
echo ""
echo "2. Process audio files:"
echo "   uv run stemset process <profile-name>"
echo ""
echo "3. Generate static manifests:"
echo "   uv run stemset build"
echo ""
echo "4. Run frontend locally:"
echo "   cd frontend && bun run dev"
echo ""
echo "5. Deploy to Cloudflare Pages (requires wrangler):"
echo "   npm install -g wrangler  # First time only"
echo "   wrangler login           # First time only"
echo "   uv run stemset deploy"
echo ""
