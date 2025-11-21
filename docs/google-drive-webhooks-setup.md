# Google Drive Webhook Auto-Import Setup Guide

## Overview

This document explains how to set up automated Google Drive monitoring for Stemset. When a user adds an audio file to a watched Drive folder, Stemset will automatically import and process it.

## Architecture

### Components

1. **Webhook Receiver** (`src/api/drive_routes.py`):
   - Endpoint: `POST /api/webhooks/drive`
   - Receives Google Drive push notifications
   - Filters for new file additions
   - Auto-imports audio files

2. **Subscription Manager** (`src/google_drive_webhooks.py`):
   - Creates/renews Drive API watch channels
   - Manages subscription lifecycle (24h max TTL)
   - Tracks active subscriptions in database

3. **Modal Scheduler** (`src/processor/webhook_manager.py`):
   - Runs every 12 hours via Modal Cron
   - Creates subscriptions for new profiles with Drive folders
   - Renews subscriptions expiring within 12 hours
   - Infrastructure-as-code: auto-deploys via GitHub Actions

4. **Database** (`src/db/models.py`):
   - `DriveWebhookSubscription` table tracks active channels
   - Stores channel_id, resource_id, folder_id, expiration

## Deployment

### 1. Koyeb Backend Setup

The backend is already deployed, but you need to ensure the `BACKEND_URL` environment variable is set correctly:

1. Go to Koyeb dashboard → Your service → Settings → Environment variables
2. Ensure `BACKEND_URL` is set to your public Koyeb URL (e.g., `https://stemset-api-your-org.koyeb.app`)
3. This URL is used for:
   - Worker callbacks
   - Google Drive webhook receiver endpoint

**No additional Koyeb configuration needed** - the webhook endpoint is already in the code.

### 2. Modal Webhook Manager Setup

The Modal webhook manager deploys automatically via GitHub Actions when you push to `main`.

**Required Modal Secrets:**

Create a Modal secret named `stemset-secrets` with these values:

```bash
modal secret create stemset-secrets \
  DATABASE_URL="postgresql+asyncpg://user:pass@host:5432/dbname" \
  BACKEND_URL="https://your-api.koyeb.app" \
  GOOGLE_CLIENT_ID="your-client-id.apps.googleusercontent.com" \
  GOOGLE_CLIENT_SECRET="your-client-secret"
```

**How to get DATABASE_URL from Koyeb:**
1. Koyeb dashboard → Your Postgres service → Connection details
2. Copy the connection string
3. Change `postgresql://` to `postgresql+asyncpg://` for async support

**Manual deployment (if needed):**
```bash
modal deploy src/processor/webhook_manager.py
```

The scheduler will run every 12 hours automatically (no idle charges - Modal only bills when function executes).

### 3. Database Migration

Run the Alembic migration to create the `drive_webhook_subscriptions` table:

```bash
# On your local machine or Koyeb instance
uv run alembic upgrade head
```

**For Koyeb deployment:**

You can run this via the Koyeb web console:
1. Go to your service → Shell
2. Run: `alembic upgrade head`

Or use `koyeb exec` CLI if you have it installed.

## How It Works

### Initial Setup Flow

1. User logs in with Google OAuth (grants Drive read access)
2. User sets `google_drive_folder_id` for a profile (via frontend)
3. Modal scheduler runs (every 12 hours):
   - Detects profile has Drive folder but no active subscription
   - Calls Google Drive API to create watch channel
   - Stores subscription in database
   - Subscription expires in 23 hours

### Auto-Import Flow

1. User adds `recording.wav` to watched Drive folder
2. Google sends webhook POST to `https://your-api.koyeb.app/api/webhooks/drive`
   - Headers: `X-Goog-Channel-ID`, `X-Goog-Resource-State: add`
3. Webhook receiver:
   - Looks up subscription by channel_id
   - Finds profile and user
   - Lists folder contents via Drive API
   - Identifies new audio files not yet imported
   - Calls existing `import_drive_file()` logic for each
4. Import process (existing flow):
   - Downloads file from Drive
   - Uploads to R2
   - Creates Recording
   - Triggers GPU worker (or local processing)
5. User sees new recording in frontend (processing → complete)

### Subscription Renewal Flow

1. Modal scheduler runs every 12 hours
2. Queries database for subscriptions expiring within 12 hours
3. For each expiring subscription:
   - Creates new watch channel via Drive API
   - Marks old subscription as inactive
   - Stores new subscription with fresh 23h expiration
4. Subscriptions stay active indefinitely (as long as scheduler runs)

## Free Tier Compatibility

All components stay within free tiers:

### Koyeb
- Webhook receiver: no additional cost (part of existing API)
- Database migration: one-time operation

### Modal
- **Webhook manager**: ~5 seconds execution every 12 hours = ~10s/day
- **Free tier**: 30 credits/month = ~900 seconds/month
- **Usage**: ~300s/month (well under limit)
- **Cost**: $0

### Google Drive API
- **Quota**: 25,000 API calls/day (free)
- **Usage per renewal**: 1 call (watch request)
- **Usage per import**: 2-3 calls (list + download)
- **Typical usage**: <100 calls/day for personal use
- **Cost**: $0

## Configuration

### Profile Setup

Each profile can have a `google_drive_folder_id` set via frontend:

```typescript
// Frontend calls:
PATCH /api/profiles/{profile_name}/drive
{
  "drive_folder_id": "1aBcDeFgHiJkLmNoPqRsTuVwXyZ"
}
```

The Modal scheduler will automatically create a subscription on its next run (within 12 hours).

### Manual Subscription Management (Advanced)

If you need to manually create/stop subscriptions:

```python
from src.google_drive_webhooks import create_webhook_subscription, stop_webhook_subscription
from src.db.models import Profile
from src.config import get_config

# Create subscription
profile = session.exec(select(Profile).where(Profile.name == "my-profile")).first()
config = get_config()
webhook_url = f"{config.backend_url}/api/webhooks/drive"

subscription = await create_webhook_subscription(
    profile=profile,
    user_refresh_token=user.google_refresh_token,
    webhook_url=webhook_url,
    config=config,
    session=session,
)

# Stop subscription
await stop_webhook_subscription(
    subscription=subscription,
    user_refresh_token=user.google_refresh_token,
    config=config,
    session=session,
)
```

## Monitoring & Debugging

### Check Active Subscriptions

```sql
SELECT
    p.name as profile_name,
    s.channel_id,
    s.drive_folder_id,
    s.expiration_time,
    s.is_active,
    s.created_at
FROM drive_webhook_subscriptions s
JOIN profiles p ON s.profile_id = p.id
WHERE s.is_active = true
ORDER BY s.expiration_time;
```

### Modal Scheduler Logs

```bash
modal app logs stemset-webhook-manager
```

Look for:
- "Found X subscriptions expiring within 12 hours"
- "✓ Renewed subscription for {profile}"
- "✓ Created subscription for {profile}"

### Webhook Receiver Logs

Check Koyeb logs for:
- "Drive webhook received: channel={id}, state=add"
- "Found {N} new audio files to auto-import"
- "Auto-imported {filename} → {output_name}"

### Common Issues

**Subscriptions not created:**
- Check Modal scheduler is running: `modal app list`
- Verify `stemset-secrets` has correct values: `modal secret list`
- Check Google OAuth credentials are valid

**Webhooks not received:**
- Verify `BACKEND_URL` is public and accessible
- Check firewall/network allows POST to `/api/webhooks/drive`
- Ensure subscription hasn't expired (should renew within 12h)

**Files not auto-importing:**
- Check webhook receiver logs for errors
- Verify user has valid `google_refresh_token` in database
- Ensure Drive folder permissions allow reading files

## Security Considerations

1. **Webhook endpoint is unauthenticated** (by design):
   - Google Drive doesn't support custom auth headers
   - Uses channel_id for validation (UUID, unpredictable)
   - Only processes if channel_id matches active subscription

2. **Database access from Modal**:
   - Uses read-write access to manage subscriptions
   - Alternative: create API endpoint for subscription management
   - Current approach minimizes API surface and avoids circular dependencies

3. **Refresh tokens**:
   - Stored securely in database (not exposed to frontend)
   - Used only by backend and Modal scheduler
   - Rotated by Google OAuth flow

## Cost Summary

| Component | Free Tier | Estimated Usage | Monthly Cost |
|-----------|-----------|-----------------|--------------|
| Koyeb API | Included | N/A | $0 |
| Modal Scheduler | 30 credits | ~0.5 credits | $0 |
| Google Drive API | 25k calls/day | ~100 calls/day | $0 |
| PostgreSQL | Koyeb free tier | +1 table | $0 |

**Total: $0/month** for typical personal/small team use.

## Next Steps

1. Deploy webhook manager: Push to `main` branch (auto-deploys via GitHub Actions)
2. Run database migration: `alembic upgrade head` on Koyeb
3. Set up Modal secrets with database URL and Google OAuth credentials
4. Test by adding a file to a watched Drive folder
5. Monitor logs to confirm auto-import works

## Troubleshooting

**If auto-import isn't working:**

1. Check webhook manager is deployed:
   ```bash
   modal app list
   # Should show "stemset-webhook-manager"
   ```

2. Manually trigger renewal (for testing):
   ```bash
   modal run src/processor/webhook_manager.py::renew_drive_webhooks
   ```

3. Check subscription in database:
   ```sql
   SELECT * FROM drive_webhook_subscriptions WHERE is_active = true;
   ```

4. Test webhook endpoint manually:
   ```bash
   curl -X POST https://your-api.koyeb.app/api/webhooks/drive \
     -H "X-Goog-Channel-ID: test-channel" \
     -H "X-Goog-Resource-State: sync"
   # Should return {"status": "ok"}
   ```

## Future Enhancements

- Add frontend UI to show subscription status
- Support webhook notifications for file updates (re-processing)
- Add manual "sync now" button to force folder check
- Support watching multiple folders per profile
- Add email/push notifications when new files are auto-imported
