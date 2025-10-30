# PostgreSQL Migration - Implementation Summary

## Overview

This document outlines the migration from JSON-based metadata storage to PostgreSQL with SQLModel and Alembic. The goal is to replace file-based metadata.json files with a relational database for better queryability, relationships, and scalability.

## Architecture Changes

### From: JSON File Storage
- Metadata stored in `media/<profile>/<output_name>/metadata.json`
- Hash tracking in `.processed_hashes.json` per profile
- In-memory job tracking (lost on restart)
- No user records (OAuth info only in JWT)

### To: PostgreSQL Database
- Structured relational data with foreign keys
- UUIDv4 primary keys throughout
- Async-first with asyncpg driver
- Type-safe with SQLModel (Pydantic + SQLAlchemy)

## Database Schema

### Core Tables

**`users`** - OAuth authenticated users
- `id` (UUID, PK)
- `email` (unique, indexed)
- `name`, `picture_url`
- `created_at`, `last_login_at`

**`profiles`** - Processing profiles (h4n, bobw, etc.)
- `id` (UUID, PK)
- `name` (unique, indexed)
- `source_folder`, `strategy_name`
- `created_at`

**`user_profiles`** - Many-to-many join table
- `user_id` (FK to users)
- `profile_id` (FK to profiles)
- `created_at`

**`audio_files`** - Original source audio files
- `id` (UUID, PK)
- `profile_id` (FK to profiles, indexed)
- `filename`, `file_hash` (SHA256, unique, indexed)
- `storage_url` (R2/local path)
- `file_size_bytes`, `duration_seconds` (NOT NULL)
- `uploaded_at`

**`recordings`** - Processed outputs (replaces "Song")
- `id` (UUID, PK)
- `profile_id` (FK to profiles, indexed)
- `output_name` (folder name in media/)
- `display_name` (user-editable)
- `created_at`, `updated_at`

**`stems`** - Individual separated tracks
- `id` (UUID, PK)
- `recording_id` (FK to recordings, indexed)
- `audio_file_id` (FK to audio_files, indexed)
- `stem_type` (vocals, drums, bass, etc.)
- `measured_lufs`, `peak_amplitude`, `stem_gain_adjustment_db`
- `audio_url`, `waveform_url` (relative paths)
- `file_size_bytes`, `duration_seconds` (NOT NULL)
- `created_at`

### Key Design Decisions

1. **UUIDv4 Primary Keys**: All tables use UUID instead of auto-increment integers for distributed scalability
2. **Audio File ID on Stems**: Stems reference both recording AND original audio file for flexibility (future: overdubs, additional instruments)
3. **Duration as NOT NULL**: Fail fast if audio duration cannot be determined - critical for playback
4. **Fully Denormalized**: Each table has all data needed for queries (profile_id duplicated on recordings/audio_files)

## Implementation Completed

### 1. Dependencies Added
```bash
sqlmodel, alembic, asyncpg, psycopg2-binary, greenlet
```

### 2. Database Configuration (`src/db/config.py`)
- Async engine with connection pooling (10 base + 20 overflow)
- Lazy engine initialization (compatible with dotenv loading)
- `get_engine()` function for manual access
- `get_session()` async generator for dependency injection
- Automatic `postgresql://` → `postgresql+asyncpg://` conversion

### 3. Database Models (`src/db/models.py`)
- All 6 tables defined with SQLModel
- UUID default factories (`new_uuid()`)
- UTC timestamp factories (`utc_now()`)
- Relationships with lazy loading disabled (`lazy: "noload"`)

### 4. Alembic Setup
- Async migration support (`alembic/env.py`)
- Automatic model import for autogenerate
- dotenv integration for DATABASE_URL
- Initial migration created (`alembic/versions/001_initial_schema.py`)

### 5. CLI Migration Command (`src/cli/db_migrate.py`)
```bash
uv run stemset migrate
```

**What it does:**
- Scans all profiles from `config.yaml`
- Reads `media/<profile>/<output_name>/metadata.json` files
- Creates Profile records (synced from config)
- Creates AudioFile records (with SHA256 hash for deduplication)
- Creates Recording records (one per output folder)
- Creates Stem records (from metadata stems array)
- **Idempotent** - safe to run multiple times, skips existing records

**Special handling:**
- Infers source file properties from stem files if source not found
- Computes file sizes and durations using `soundfile`
- Uses output folder name as fallback hash if source unavailable

### 6. Docker Compose for Local Development
```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: stemset
      POSTGRES_USER: stemset
      POSTGRES_PASSWORD: stemset
    ports:
      - "5432:5432"
```

## Environment Variables Required

```bash
# Database connection (required)
DATABASE_URL=postgresql://stemset:stemset@localhost:5432/stemset

# Existing variables (unchanged)
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
JWT_SECRET=...
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET_NAME=stemset-media
GPU_WORKER_URL=https://...
```

## Migration Workflow

### Initial Setup
1. Start PostgreSQL: `docker compose up -d` (or use managed service)
2. Run migrations: `alembic upgrade head`
3. Populate database: `uv run stemset migrate`

### Future Schema Changes
1. Modify models in `src/db/models.py`
2. Generate migration: `alembic revision --autogenerate -m "Description"`
3. Review generated migration in `alembic/versions/`
4. Apply migration: `alembic upgrade head`

## Remaining Implementation Tasks

### Phase 1: Core Processing Integration
- **Scanner** (`src/cli/scanner.py`): Query `audio_files` table by hash instead of `.processed_hashes.json`
- **Processor** (`src/cli/processor.py`): Create Recording + Stem records after separation completes
- **Separator** (`src/modern_separator.py`): Return structured data instead of writing JSON

### Phase 2: API Integration
- **Litestar App** (`src/api/app.py`): Add database lifespan context (init engine on startup, dispose on shutdown)
- **Dependency Injection**: Add `get_session()` as route dependency
- **Profile Routes** (`src/api/profile_routes.py`):
  - `GET /api/profiles` → Query Profile table (filtered by user access via UserProfile join)
  - `GET /api/profiles/{name}/files` → Query Recording + Stem with joinedload
  - `PATCH /api/profiles/{name}/files/{file}/display-name` → Update Recording.display_name
- **Auth Routes** (`src/api/auth_routes.py`):
  - On OAuth login success: upsert User record, update last_login_at
  - Check profile access via UserProfile join
  - Return accessible profiles with user info

### Phase 3: Cleanup
- Remove `to_file()` / `from_file()` methods from StemsMetadata
- Remove `.processed_hashes.json` read/write logic
- Remove `update_metadata()` from StorageBackend protocol
- Remove `get_metadata_url()` - metadata comes from DB now
- Keep `get_file_url()` and `get_waveform_url()` - media files stay in R2/local storage

### Phase 4: Documentation
- Update `CLAUDE.md` with database architecture section
- Add database diagram showing relationships
- Document query patterns for common operations
- Add troubleshooting guide for database issues

## Production Deployment

### Koyeb Configuration
```bash
# Add to environment variables
DATABASE_URL=postgresql://user:pass@host:5432/stemset

# Run migrations on deployment
alembic upgrade head
```

### Database Hosting Options
1. **Koyeb Managed PostgreSQL**: Simple integration, same platform as API
2. **Neon**: Serverless PostgreSQL, generous free tier, connection pooling
3. **Supabase**: PostgreSQL + extras, free tier available

## Testing Strategy

### Manual Testing Checklist
- [ ] Run migration on local database with existing media files
- [ ] Verify all recordings and stems populated correctly
- [ ] Test scanner duplicate detection with database queries
- [ ] Test processor creates database records after separation
- [ ] Test API endpoints return data from database
- [ ] Test user authentication creates user records
- [ ] Test profile access control via UserProfile join
- [ ] Test display name updates via API

### Database Verification Queries
```sql
-- Count records by table
SELECT 'profiles' as table, COUNT(*) FROM profiles
UNION SELECT 'audio_files', COUNT(*) FROM audio_files
UNION SELECT 'recordings', COUNT(*) FROM recordings
UNION SELECT 'stems', COUNT(*) FROM stems
UNION SELECT 'users', COUNT(*) FROM users;

-- Verify recording has all expected stems
SELECT r.output_name, COUNT(s.id) as stem_count
FROM recordings r
LEFT JOIN stems s ON s.recording_id = r.id
GROUP BY r.id, r.output_name;

-- Check for orphaned records
SELECT COUNT(*) FROM stems WHERE recording_id NOT IN (SELECT id FROM recordings);
SELECT COUNT(*) FROM audio_files WHERE profile_id NOT IN (SELECT id FROM profiles);
```

## Migration Rollback Plan

If issues arise:
1. Keep JSON files during transition period for rollback
2. Database and JSON can coexist temporarily
3. Revert code changes to read from JSON instead of database
4. Optional: Generate JSON files from database for backup

## Performance Considerations

- **Indexes**: All foreign keys indexed, unique constraints on hash/email
- **Connection Pooling**: 10 base connections + 20 overflow
- **Lazy Loading**: Disabled by default (`lazy: "noload"`), use joinedload for relationships
- **Query Optimization**: Use `select()` with explicit joinedload for N+1 prevention

## Benefits of This Migration

1. **Queryability**: Filter recordings by LUFS, duration, profile, date
2. **User Management**: Track who uploads what, profile access control
3. **Job Persistence**: Processing jobs survive server restarts
4. **Duplicate Detection**: Fast hash-based lookups across all profiles
5. **Referential Integrity**: Foreign keys prevent orphaned stems/recordings
6. **Scalability**: Ready for multi-user, multi-tenancy features
7. **Analytics**: Built-in support for usage tracking, metrics, audit logs

## Known Limitations

- Media files (audio/waveforms) still in R2/local storage (by design)
- OAuth state still in-memory (out of scope for this migration)
- Processing jobs still in-memory (out of scope for this migration)
- No automatic sync from database back to JSON files

## Future Enhancements

- Activity logging table for user actions
- Processing job persistence table
- OAuth session persistence table
- User preferences table
- Song entity (many recordings → one song)
- Tags/labels for recordings
- Playlists or collections
- Sharing and permissions system
