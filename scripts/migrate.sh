#!/bin/bash
# Run Alembic database migrations with optional environment file
#
# Usage:
#   ./scripts/migrate.sh           # Uses .env (default)
#   ./scripts/migrate.sh .env.production

set -e  # Exit on error

# Change to project root directory
cd "$(dirname "$0")/.."

# Use provided env file or default to .env
ENV_FILE="${1:-.env}"

# Check if env file exists
if [ ! -f "$ENV_FILE" ]; then
    echo "Error: $ENV_FILE file not found"
    exit 1
fi

# Load environment variables from env file
echo "Loading environment from $ENV_FILE..."
export $(cat "$ENV_FILE" | grep -v '^#' | xargs)

# Verify DATABASE_URL is set
if [ -z "$DATABASE_URL" ]; then
    echo "Error: DATABASE_URL not found in $ENV_FILE"
    exit 1
fi

echo "Running Alembic migrations..."
echo "Database: ${DATABASE_URL%%@*}@***" # Mask password in output

# Run migrations
alembic upgrade head

echo "✓ Database migrated successfully!"
