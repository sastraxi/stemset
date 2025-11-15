#!/bin/bash
# Backup PostgreSQL database using pg_dump
#
# Usage:
#   ./scripts/backup.sh                    # Uses .env, outputs to backups/stemset_TIMESTAMP.dump
#   ./scripts/backup.sh .env.production    # Uses custom env file
#   ./scripts/backup.sh .env backup.dump   # Custom output file

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

# Parse DATABASE_URL to extract connection components
# Handles both postgresql:// and postgresql+asyncpg:// formats
DB_URL="${DATABASE_URL}"
DB_URL="${DB_URL#postgresql://}"
DB_URL="${DB_URL#postgresql+asyncpg://}"

# Extract user:password@host:port/database
if [[ $DB_URL =~ ^([^:]+):([^@]+)@([^:/]+):?([0-9]*)/(.+)$ ]]; then
    DB_USER="${BASH_REMATCH[1]}"
    DB_PASS="${BASH_REMATCH[2]}"
    DB_HOST="${BASH_REMATCH[3]}"
    DB_PORT="${BASH_REMATCH[4]:-5432}"
    DB_NAME="${BASH_REMATCH[5]}"
elif [[ $DB_URL =~ ^([^@]+)@([^:/]+):?([0-9]*)/(.+)$ ]]; then
    DB_USER="${BASH_REMATCH[1]}"
    DB_PASS=""
    DB_HOST="${BASH_REMATCH[2]}"
    DB_PORT="${BASH_REMATCH[3]:-5432}"
    DB_NAME="${BASH_REMATCH[4]}"
else
    echo "Error: Could not parse DATABASE_URL"
    exit 1
fi

# Set output file - use provided or generate timestamp-based name
if [ -n "$2" ]; then
    OUTPUT_FILE="$2"
else
    # Create backups directory if it doesn't exist
    mkdir -p backups
    TIMESTAMP=$(date +%Y%m%d_%H%M%S)
    OUTPUT_FILE="backups/${DB_NAME}_${TIMESTAMP}.dump"
fi

echo "Backing up database..."
echo "  Database: $DB_NAME"
echo "  Host: $DB_HOST:$DB_PORT"
echo "  User: $DB_USER"
echo "  Output: $OUTPUT_FILE"

# Set password for pg_dump
export PGPASSWORD="$DB_PASS"

# Run pg_dump with sane defaults:
# -Fc: Custom format (compressed, allows parallel restore)
# -v: Verbose output
# --no-owner: Don't output ownership commands
# --no-acl: Don't output ACL commands (GRANT/REVOKE)
# This ensures the dump can be restored to different user accounts
pg_dump \
    -h "$DB_HOST" \
    -p "$DB_PORT" \
    -U "$DB_USER" \
    -d "$DB_NAME" \
    -Fc \
    -v \
    --no-owner \
    --no-acl \
    -f "$OUTPUT_FILE"

# Clear password from environment
unset PGPASSWORD

echo "✓ Database backed up successfully to: $OUTPUT_FILE"
echo "  Size: $(du -h "$OUTPUT_FILE" | cut -f1)"
