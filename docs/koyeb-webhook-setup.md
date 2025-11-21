# Koyeb Configuration for Webhooks

## Required Environment Variables

The following environment variables are already set in your Koyeb deployment. Just verify `BACKEND_URL` is correct:

### Existing Variables (verify these)

```
BACKEND_URL=https://your-stemset-api.koyeb.app
```

**Important:** Make sure `BACKEND_URL` is your actual public Koyeb URL, not localhost.

This is used for:
1. Worker callbacks (`POST /api/recordings/{id}/complete/{token}`)
2. Drive webhook receiver (`POST /api/webhooks/drive`)

## Database Migration

After deploying the code, run the migration to create the `drive_webhook_subscriptions` table:

### Option 1: Via Koyeb Web Console

1. Go to Koyeb dashboard → Your service → Shell
2. Run:
   ```bash
   alembic upgrade head
   ```

### Option 2: Via koyeb CLI (if installed)

```bash
koyeb exec your-service-name -- alembic upgrade head
```

### Option 3: From local machine (requires DATABASE_URL)

```bash
# Set DATABASE_URL to your Koyeb Postgres connection string
export DATABASE_URL="postgresql://user:pass@your-db.koyeb.app:5432/stemset"
uv run alembic upgrade head
```

## No Additional Koyeb Configuration Needed!

The webhook infrastructure is fully implemented in code:
- ✅ Webhook endpoint registered in `src/api/app.py`
- ✅ Excluded from JWT authentication
- ✅ Auto-deploys with your existing Koyeb deployment

## Verification

After deployment, test the webhook endpoint:

```bash
curl -X POST https://your-api.koyeb.app/api/webhooks/drive \
  -H "X-Goog-Channel-ID: test-123" \
  -H "X-Goog-Resource-State: sync"
```

Expected response:
```json
{"status": "ok"}
```

## Modal Secret Setup

The Modal webhook manager needs access to your database and Google OAuth credentials.

Create a Modal secret (one-time setup):

```bash
modal secret create stemset-secrets \
  DATABASE_URL="postgresql+asyncpg://user:pass@your-db.koyeb.app:5432/stemset" \
  BACKEND_URL="https://your-api.koyeb.app" \
  GOOGLE_CLIENT_ID="your-id.apps.googleusercontent.com" \
  GOOGLE_CLIENT_SECRET="your-secret"
```

**Note:** Change `postgresql://` to `postgresql+asyncpg://` in the DATABASE_URL.

## Deployment Checklist

- [ ] Code deployed to Koyeb (automatic via Git push)
- [ ] `BACKEND_URL` environment variable set correctly
- [ ] Database migration run: `alembic upgrade head`
- [ ] Modal secret `stemset-secrets` created with DATABASE_URL, BACKEND_URL, Google OAuth
- [ ] Modal webhook manager deployed: `modal deploy src/processor/webhook_manager.py` (or push to main for auto-deploy)
- [ ] Test webhook endpoint with curl command above

## Costs

**Koyeb:** No additional cost (webhook endpoint is part of existing API service)

**Modal:** $0/month (webhook manager uses <1 credit/month from 30 free credits)

**Google Drive API:** $0/month (well under 25k calls/day free tier)
