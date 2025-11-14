#!/bin/bash
# Generate a new Alembic migration file
#
# Usage:
#   ./scripts/generate_migration.sh "Your migration message"

set -e

cd "$(dirname "$0")/.."

ENV_FILE=".env"
if [ ! -f "$ENV_FILE" ]; then
    echo "Error: $ENV_FILE file not found"
    exit 1
fi

export $(cat "$ENV_FILE" | grep -v '^#' | xargs)

if [ -z "$DATABASE_URL" ]; then
    echo "Error: DATABASE_URL not found in $ENV_FILE"
    exit 1
fi

if [ -z "$1" ]; then
    echo "Error: Migration message is required"
    exit 1
fi

alembic revision --autogenerate -m "$1"
