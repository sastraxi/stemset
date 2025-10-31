#!/bin/bash
# Migrate production database using credentials from .env.production

set -e  # Exit on error

# Change to project root directory
cd "$(dirname "$0")/.."

# Check if .env.production exists
if [ ! -f ".env.production" ]; then
    echo "Error: .env.production file not found"
    exit 1
fi

# Load environment variables from .env.production
echo "Loading environment from .env.production..."
export $(cat .env.production | grep -v '^#' | xargs)

# Verify DATABASE_URL is set
if [ -z "$DATABASE_URL" ]; then
    echo "Error: DATABASE_URL not found in .env.production"
    exit 1
fi

echo "Running Alembic migrations on production database..."
echo "Database: ${DATABASE_URL%%@*}@***" # Mask password in output

# Run migrations
alembic upgrade head

echo "✓ Production database migrated successfully!"
