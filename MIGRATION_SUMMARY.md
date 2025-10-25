# Migration Summary: Render → Cloudflare + Koyeb

## What Changed

### Before (Render)
- ❌ $7+/month for persistent disk
- ❌ Service spins down after 15 minutes (cold starts)
- ❌ Bandwidth charges after 100GB
- ❌ Single-server architecture (frontend + backend together)

### After (Cloudflare + Koyeb + R2)
- ✅ **$0/month** for reasonable usage
- ✅ No spin-down (Koyeb stays running)
- ✅ **Zero egress fees** from R2 (unlimited audio downloads!)
- ✅ Global CDN for frontend (faster for users)
- ✅ Separation of concerns (static vs dynamic)

## Architecture Overview

```
┌──────────────────┐         ┌──────────────────┐         ┌──────────────────┐
│ Cloudflare Pages │────────→│  Koyeb (API)     │────────→│  Cloudflare R2   │
│  (Frontend)      │  API    │  Litestar/Python │ S3 SDK │  (Audio Files)   │
│  FREE            │  calls  │  FREE TIER       │        │  FREE (10GB)     │
└──────────────────┘         └──────────────────┘         └──────────────────┘
```

## New Files Created

### Configuration
- ✅ `.koyeb/config.yaml` - Koyeb deployment config
- ✅ `frontend/wrangler.toml` - Cloudflare Pages config
- ✅ `frontend/.env.example` - Frontend environment variables
- ✅ Updated `config.yaml` - Added R2 storage section
- ✅ Updated `.env.example` - Added R2 credentials

### Code Changes
- ✅ `src/storage.py` - Storage abstraction (local/R2)
- ✅ `src/config.py` - Added `R2Config` model
- ✅ `src/api/profile_routes.py` - Updated to use storage backend
- ✅ `src/api/app.py` - Updated CORS for split architecture
- ✅ `frontend/src/api.ts` - Use environment variable for API URL
- ✅ `pyproject.toml` - Added `boto3` dependency

### Documentation
- ✅ `DEPLOYMENT.md` - Complete deployment guide
- ✅ `ARCHITECTURE.md` - Architecture overview
- ✅ `scripts/upload_to_r2.py` - Helper script for uploading files

## Next Steps

### 1. Install Dependencies

```bash
# Backend - install boto3
uv sync

# You can test locally first if needed
```

### 2. Setup Cloudflare R2 (10 minutes)

1. Create R2 bucket at [dash.cloudflare.com](https://dash.cloudflare.com)
2. Create API token with read/write access
3. Save Account ID, Access Key, Secret Key
4. (Optional) Enable public access for faster serving

See `DEPLOYMENT.md` Part 1 for detailed steps.

### 3. Deploy Backend to Koyeb (15 minutes)

1. Sign up at [koyeb.com](https://www.koyeb.com/)
2. Connect GitHub repository
3. Configure environment variables (OAuth + R2 credentials)
4. Deploy!

See `DEPLOYMENT.md` Part 2 for detailed steps.

### 4. Deploy Frontend to Cloudflare Pages (10 minutes)

1. In Cloudflare Dashboard → Pages
2. Connect GitHub repository
3. Set build command: `cd frontend && bun install && bun run build`
4. Set environment variable: `VITE_API_URL=https://stemset-api.koyeb.app/api`
5. Deploy!

See `DEPLOYMENT.md` Part 3 for detailed steps.

### 5. Configure Google OAuth (5 minutes)

Update your Google OAuth credentials with new redirect URIs:
- `https://stemset-api.koyeb.app/auth/callback`

See `DEPLOYMENT.md` Part 4 for detailed steps.

### 6. Upload Your Audio Files (varies)

```bash
# Process audio locally (if not already done)
uv run stemset process <profile>

# Upload to R2
python scripts/upload_to_r2.py <profile>
```

See `DEPLOYMENT.md` Part 5 for detailed steps.

### 7. Test Everything

1. Visit your Cloudflare Pages URL
2. Sign in with Google
3. Verify profiles load
4. Play audio to test R2 streaming
5. Check browser console for errors

## Testing Locally Before Deploy

You can test R2 integration locally:

1. Update `config.yaml` to uncomment R2 section
2. Set R2 environment variables in `.env`
3. Run backend: `./dev.sh`
4. Upload files: `python scripts/upload_to_r2.py`
5. Test API endpoints return R2 URLs

## Rollback Plan

If something goes wrong:

1. Keep Render deployment running while testing new setup
2. Only delete Render after confirming new setup works
3. Can quickly switch back by updating DNS/OAuth URIs
4. Local `media/` folder serves as backup

## Estimated Time

- **Total setup time**: ~1 hour (first time)
- **Ongoing deployments**: Automatic via git push
- **File uploads**: Depends on audio library size

## Cost Comparison

| Item | Render | Cloudflare+Koyeb |
|------|--------|------------------|
| Backend hosting | $7/mo | **FREE** |
| Persistent storage (10GB) | Included | **FREE** |
| Bandwidth (100GB) | Included | **FREE** |
| Frontend hosting | Included | **FREE** |
| Bandwidth overages | $0.10/GB | **$0** (R2) |
| **Monthly total** | **$7+** | **$0** |
| **Annual savings** | | **$84/year** |

## Additional Benefits

Beyond cost savings:

1. **Performance**: Global CDN for frontend (faster loads worldwide)
2. **Reliability**: No cold starts (Koyeb doesn't spin down)
3. **Scalability**: R2 has zero egress fees (unlimited downloads)
4. **Separation**: Frontend and backend can be updated independently
5. **Learning**: Modern cloud architecture patterns

## Questions?

- Read `DEPLOYMENT.md` for step-by-step instructions
- Read `ARCHITECTURE.md` for technical details
- Check `config.yaml` and `.env.example` for configuration reference

## Need Help?

Common issues and solutions:

- **"boto3 not found"**: Run `uv sync`
- **"R2 credentials invalid"**: Check account ID, keys in `.env`
- **"CORS error"**: Update `FRONTEND_URL` in Koyeb
- **"OAuth redirect mismatch"**: Update Google Cloud Console URIs
- **"Files not found"**: Verify files uploaded to R2 with `aws s3 ls`

See `DEPLOYMENT.md` Troubleshooting section for more.
