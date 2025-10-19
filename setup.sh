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

# Check for cmake
if ! command -v cmake &> /dev/null; then
    echo "Error: cmake is not installed. Please install it first."
    echo "  On macOS, you can install it via Homebrew:"
    echo "    brew install cmake"
    exit 1
fi

# If you'd like to try cpython 3.14...
# Check for llvm==20.x
# if ! llvm_version=$(cmake --find-package -DNAME=LLVM -DCOMPILER_ID=GNU -DLANGUAGE=CXX -DMODE=EXISTENCE 2>&1 | grep -oP 'version \K[0-9]+(\.[0-9]+)*'); then
#     echo "Error: LLVM is not installed. Please install LLVM 20.x first."
#     echo "  On macOS, you can install it via Homebrew:"
#     echo "    brew install llvm@20"
#     exit 1
# elif [[ $llvm_version != 20.* ]]; then
#     echo "Error: LLVM version $llvm_version found. Please install LLVM 20.x."
#     echo "  On macOS, you can install it via Homebrew:"
#     echo "    brew install llvm@20"
#     exit 1
# fi
# echo "Then set the following environment variables:"
# echo "  export LDFLAGS=\"-L/usr/local/opt/llvm@20/lib\"
# echo "  export CPPFLAGS=\"-I/usr/local/opt/llvm@20/include\"
# echo "  export PATH=\"/usr/local/opt/llvm@20/bin:\$PATH\"
# echo "✓ LLVM 20.x check passed"

echo "✓ Dependencies check passed"

# Install Python dependencies
echo ""
echo "📦 Installing Python dependencies..."
uv sync

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
echo "2. Start the backend: uv run python -m src.main"
echo "3. Start the frontend: cd frontend && bun run dev"
echo "4. Open http://localhost:5173 in your browser"
