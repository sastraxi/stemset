#!/bin/bash
# Restore PostgreSQL database using pg_restore
#
# Usage:
#   ./scripts/restore.sh backup.dump              # Uses .env
#   ./scripts/restore.sh backup.dump .env.local   # Uses custom env file
#
# WARNING: This will DROP and recreate the database!

set -e  # Exit on error

# Change to project root directory
cd "$(dirname "$0")/.."

# Check if backup file is provided
if [ -z "$1" ]; then
    echo "Error: Backup file not provided"
    echo "Usage: $0 <backup_file> [env_file]"
    echo "Example: $0 backups/stemset_20250114_123456.dump"
    exit 1
fi

BACKUP_FILE="$1"

# Check if backup file exists
if [ ! -f "$BACKUP_FILE" ]; then
    echo "Error: Backup file not found: $BACKUP_FILE"
    exit 1
fi

# Use provided env file or default to .env
ENV_FILE="${2:-.env}"

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

# Detect if we're restoring to a managed service (like Supabase) that only has 'postgres' database
MANAGED_SERVICE=false
if [ "$DB_NAME" = "postgres" ]; then
    MANAGED_SERVICE=true
    echo "WARNING: This will DROP all tables and data in the '$DB_NAME' database!"
else
    echo "WARNING: This will DROP and recreate the database '$DB_NAME'!"
fi
echo "  Host: $DB_HOST:$DB_PORT"
echo "  User: $DB_USER"
echo "  Backup: $BACKUP_FILE"
echo ""
read -p "Are you sure you want to continue? (yes/no): " -r
if [[ ! $REPLY =~ ^[Yy][Ee][Ss]$ ]]; then
    echo "Restore cancelled"
    exit 0
fi

# Set password for psql/pg_restore
export PGPASSWORD="$DB_PASS"

if [ "$MANAGED_SERVICE" = true ]; then
    echo "Detected managed service - cleaning existing tables..."
    # For managed services, drop all tables in the public schema
    psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "
        DO \$\$ DECLARE
            r RECORD;
        BEGIN
            -- Drop all tables
            FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
                EXECUTE 'DROP TABLE IF EXISTS public.' || quote_ident(r.tablename) || ' CASCADE';
            END LOOP;
            -- Drop all sequences
            FOR r IN (SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema = 'public') LOOP
                EXECUTE 'DROP SEQUENCE IF EXISTS public.' || quote_ident(r.sequence_name) || ' CASCADE';
            END LOOP;
            -- Drop all views
            FOR r IN (SELECT table_name FROM information_schema.views WHERE table_schema = 'public') LOOP
                EXECUTE 'DROP VIEW IF EXISTS public.' || quote_ident(r.table_name) || ' CASCADE';
            END LOOP;
        END \$\$;
    "
else
    echo "Dropping existing database..."
    # Connect to postgres database to drop/create
    psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d postgres -c "DROP DATABASE IF EXISTS $DB_NAME;"

    echo "Creating new database..."
    psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d postgres -c "CREATE DATABASE $DB_NAME;"
fi

echo "Restoring database from backup..."
# Run pg_restore with sane defaults:
# -v: Verbose output
# -d: Target database
# --no-owner: Don't set ownership (use current user)
# --no-acl: Don't restore ACL commands
# -j: Number of parallel jobs (use 4 for faster restore)
# --clean: Drop database objects before recreating
# --if-exists: Suppress errors if objects don't exist when cleaning
pg_restore \
    -h "$DB_HOST" \
    -p "$DB_PORT" \
    -U "$DB_USER" \
    -d "$DB_NAME" \
    -v \
    --no-owner \
    --no-acl \
    -j 4 \
    --clean \
    --if-exists \
    "$BACKUP_FILE" 2>&1 | grep -v "does not exist$" | grep -v "does not exist, skipping$" || true

echo ""
echo "Verifying restore..."
TABLE_COUNT=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -c "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE';")

# Clear password from environment
unset PGPASSWORD

if [ "$TABLE_COUNT" -gt 0 ]; then
    echo "✓ Database restored successfully!"
    echo "  Tables restored: $TABLE_COUNT"
    echo ""
    echo "  You may want to run migrations to ensure schema is up to date:"
    echo "  ./scripts/migrate.sh $ENV_FILE"
else
    echo "✗ Restore may have failed - no tables found in database"
    exit 1
fi
