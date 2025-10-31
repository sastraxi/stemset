#!/usr/bin/env bash
set -euo pipefail

# Setup Modal secret for R2 storage
# This script reads R2 credentials from .env and creates a Modal secret

echo "Setting up Modal secret for R2 storage..."

# Check if .env exists
if [ ! -f .env ]; then
    echo "Error: .env file not found"
    echo "Please create .env from .env.example first"
    exit 1
fi

# Load .env file
set -a
source .env
set +a

# Check required variables
MISSING_VARS=()
[ -z "${R2_ACCOUNT_ID:-}" ] && MISSING_VARS+=("R2_ACCOUNT_ID")
[ -z "${R2_ACCESS_KEY_ID:-}" ] && MISSING_VARS+=("R2_ACCESS_KEY_ID")
[ -z "${R2_SECRET_ACCESS_KEY:-}" ] && MISSING_VARS+=("R2_SECRET_ACCESS_KEY")
[ -z "${R2_BUCKET_NAME:-}" ] && MISSING_VARS+=("R2_BUCKET_NAME")

if [ ${#MISSING_VARS[@]} -ne 0 ]; then
    echo "Error: Missing required environment variables in .env:"
    for var in "${MISSING_VARS[@]}"; do
        echo "  - $var"
    done
    exit 1
fi

echo "Found R2 credentials in .env:"
echo "  Account ID: ${R2_ACCOUNT_ID:0:8}..."
echo "  Access Key: ${R2_ACCESS_KEY_ID:0:8}..."
echo "  Bucket: $R2_BUCKET_NAME"
echo ""

# Create Modal secret
echo "Creating Modal secret 'r2-secret'..."
uv run modal secret create r2-secret \
    AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" \
    AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
    R2_ACCOUNT_ID="$R2_ACCOUNT_ID" \
    R2_BUCKET_NAME="$R2_BUCKET_NAME"

echo ""
echo "✓ Modal secret 'r2-secret' created successfully!"
echo ""
echo "Next steps:"
echo "  1. Update src/processor/worker.py with your R2 account ID"
echo "  2. Deploy worker: uv run modal deploy src/processor/worker.py"
echo "  3. Set GPU_WORKER_URL in .env with the Modal endpoint"
