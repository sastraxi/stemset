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

echo "✓ Dependencies check passed"

# Install Python dependencies
echo ""
echo "📦 Installing Python dependencies..."
uv pip install -e .

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
echo "1. Edit config.yaml to configure your profiles"
echo "2. Start the backend: python -m backend.main"
echo "3. Start the frontend: cd frontend && bun run dev"
echo "4. Open http://localhost:5173 in your browser"
