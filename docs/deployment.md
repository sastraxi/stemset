# Stemset Deployment Guide

This guide explains how to deploy Stemset using the **hybrid architecture** with:
- **Database**: PostgreSQL (Koyeb Managed/Neon/Supabase)
- **Frontend**: Cloudflare Pages (free, unlimited bandwidth)
- **Backend API**: Koyeb (free tier: 512MB RAM, 100GB bandwidth/month)
- **Audio Storage**: Cloudflare R2 (free for first 10GB, zero egress fees)

## Benefits of This Architecture

- **Cost**: $0/month for small deployments (Neon free tier includes PostgreSQL)
- **Performance**: Global CDN for frontend, zero-latency audio serving from R2
- **Scalability**: No bandwidth charges as you grow (R2 has zero egress fees)
- **Separation of concerns**: Static frontend can be cached aggressively, API scales independently
- **Database**: Structured queries, user management, job persistence

---

## Part 1: Setup PostgreSQL Database

### Option A: Koyeb Managed PostgreSQL (Recommended)

1. Log in to [Koyeb Dashboard](https://app.koyeb.com/)
2. Navigate to **Databases**
3. Click **Create database**
4. Configure:
   - **Database name**: `stemset`
   - **Plan**: **Micro** (free tier: 1GB storage, 100 connections)
   - **Region**: Choose closest to your API deployment
5. Click **Create database**
6. **Save the connection details**:
   - Host, Port, Database name, Username, Password
   - Connection string format: `postgresql://username:password@host:port/database`

### Option B: Neon (Alternative Free Option)

1. Sign up at [Neon](https://neon.tech/)
2. Create a new project
3. Database will be created automatically
4. Go to **Dashboard** → **Connection Details**
5. Copy the **Pooled connection string** (recommended for serverless)
6. Format: `postgresql://username:password@host/database?sslmode=require`

### Option C: Supabase (Alternative)

1. Sign up at [Supabase](https://supabase.com/)
2. Create a new project
3. Go to **Settings** → **Database**
4. Copy the **Connection string** (URI format)
5. Use the **Connection pooling** string for better performance

### 1.1 Test Database Connection

Create a `.env.production` file locally to test:

```bash
DATABASE_URL=postgresql://username:password@host:port/database
```

Test the connection:

```bash
# Install psql if needed (macOS)
brew install postgresql

# Test connection
psql "$DATABASE_URL" -c "SELECT version();"
```

### 1.2 Run Database Migration

```bash
# Set the database URL
export DATABASE_URL="postgresql://username:password@host:port/database"

# Run migrations to create tables
alembic upgrade head

# Verify tables were created
psql "$DATABASE_URL" -c "\dt"
```

You should see tables: `users`, `profiles`, `user_profiles`, `audio_files`, `recordings`, `stems`

---

## Part 2: Setup Cloudflare R2 (Audio Storage)

### 2.1 Create R2 Bucket

1. Log in to [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. Navigate to **R2 Object Storage**
3. Click **Create bucket**
4. Name: `stemset-media` (or your preference)
5. Location: **Automatic** (or choose closest to your users)
6. Click **Create bucket**

### 2.2 Create R2 API Token

1. In R2 dashboard, find **Manage R2 API Tokens** in the right sidebar
2. Click **Create API Token**
3. Configure the token:
   - **Token name**: `stemset-api`
   - **Permissions**: **Edit** (allows reading and writing objects)
   - **Specify bucket(s)**: Select `stemset-media` (or choose **Apply to all buckets in this account**)
   - **TTL**: Leave as default or set to never expire
4. Click **Create API Token**
5. **Save these credentials** (you won't see them again):
   - **Account ID**
   - **Access Key ID**
   - **Secret Access Key**

### 2.3 (Optional) Configure Public Access

If you want direct public access to audio files (faster, but less secure):

1. In your R2 bucket settings, go to **Settings** → **Public access**
2. Enable **Allow public access**
3. You'll get a public URL like: `https://pub-xxxxx.r2.dev`
4. Save this URL for later

**Note**: If you skip this step, the API will generate presigned URLs (valid for 1 hour).

---

## Part 3: Deploy Backend to Koyeb

### 3.1 Prepare Your Repository

1. Ensure your code is pushed to GitHub
2. The repository includes a multi-stage `Dockerfile`:
   - `api` target: Lightweight API dependencies only (~100MB)
   - `processing` target: Full ML/audio processing stack (~2GB+)
   - Koyeb will use the `api` target for fast, lightweight deployment

### 3.2 Create Koyeb App

1. Sign up at [Koyeb](https://www.koyeb.com/)
2. Click **Create App**
3. Choose **GitHub** as deployment source
4. Select your `stemset` repository
5. Configure:
   - **Builder**: Docker
   - **Dockerfile**: `Dockerfile`
   - **Target**: `api`
   - **Port**: `8000`
   - **Instance type**: Free (512MB RAM, 0.1 vCPU)
   - **Region**: Choose closest to your users

### 3.3 Configure Environment Variables

Add these environment variables in Koyeb dashboard:

```bash
# Database
DATABASE_URL=<from-part-1-database-connection-string>

# Authentication
STEMSET_BYPASS_AUTH=false
GOOGLE_CLIENT_ID=<your-google-oauth-client-id>
GOOGLE_CLIENT_SECRET=<your-google-oauth-client-secret>
JWT_SECRET=<generate-with: python -c "import secrets; print(secrets.token_hex(32))">
OAUTH_REDIRECT_URI=https://stemset-api.koyeb.app/auth/callback
FRONTEND_URL=https://stemset.pages.dev  # Update after deploying frontend

# Cloudflare R2
R2_ACCOUNT_ID=<from-step-2.2>
R2_ACCESS_KEY_ID=<from-step-2.2>
R2_SECRET_ACCESS_KEY=<from-step-2.2>
R2_BUCKET_NAME=stemset-media
R2_PUBLIC_URL=<from-step-2.3-if-configured>  # Optional
```

### 3.4 Deploy and Migrate Database

1. Click **Deploy**
2. Wait for build to complete (~3-5 minutes)
3. Your API will be available at: `https://stemset-api.koyeb.app`

**Run database migrations on production:**

```bash
# Set production database URL
export DATABASE_URL="<your-production-database-url>"

# Run migrations
alembic upgrade head

# If you have existing metadata.json files, migrate them:
uv run stemset migrate
```

4. Test: Visit `https://stemset-api.koyeb.app/api/profiles`

---

## Part 4: Deploy Frontend to Cloudflare Pages

### 4.1 Create Cloudflare Pages Project

1. Log in to [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. Navigate to **Pages**
3. Click **Create a project**
4. Choose **Connect to Git**
5. Select your GitHub repository
6. Configure build settings:
   - **Framework preset**: None
   - **Build command**: `cd frontend && bun install && bun run build`
   - **Build output directory**: `frontend/dist`

### 4.2 Configure Environment Variables

Add this environment variable in Cloudflare Pages settings:

```bash
VITE_API_URL=https://stemset-api.koyeb.app/api
```

### 4.3 Deploy

1. Click **Save and Deploy**
2. Wait for build (~2-3 minutes)
3. Your frontend will be available at: `https://stemset.pages.dev` (or custom domain)

### 4.4 Update Backend CORS

Go back to Koyeb and update the `FRONTEND_URL` environment variable to match your Cloudflare Pages URL:

```bash
FRONTEND_URL=https://stemset.pages.dev
```

Redeploy the Koyeb app for the change to take effect.

---

## Part 5: Configure Google OAuth

### 5.1 Update OAuth Credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
2. Edit your OAuth 2.0 Client ID
3. Add **Authorized redirect URIs**:
   - `https://stemset-api.koyeb.app/auth/callback`
4. Add **Authorized JavaScript origins**:
   - `https://stemset.pages.dev`
   - `https://stemset-api.koyeb.app`
5. Click **Save**

---

## Part 6: Upload Audio Files to R2

### 6.1 Process Audio Locally

Run the stemset CLI locally to process your audio files:

```bash
uv run stemset process <profile-name>
```

This will create files in `media/<profile-name>/`.

### 6.2 Install AWS CLI (for R2 uploads)

```bash
# macOS
brew install awscli

# Or use pip
pip install awscli
```

### 6.3 Configure AWS CLI for R2

Create a profile for R2:

```bash
aws configure --profile r2
```

Enter your R2 credentials:
- AWS Access Key ID: `<R2_ACCESS_KEY_ID from step 1.2>`
- AWS Secret Access Key: `<R2_SECRET_ACCESS_KEY from step 1.2>`
- Default region name: `auto`
- Default output format: `json`

### 6.4 Upload Files to R2

```bash
# Sync your local media folder to R2
aws s3 sync media/ s3://stemset-media/ \
  --endpoint-url https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com \
  --profile r2
```

**Note**: Replace `<R2_ACCOUNT_ID>` with your Cloudflare account ID from step 2.2.

### 6.5 Verify Upload

Check that files are in R2:

```bash
aws s3 ls s3://stemset-media/ \
  --endpoint-url https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com \
  --profile r2 \
  --recursive
```

---

## Part 7: Enable R2 in Backend

### 7.1 Update config.yaml

In your `config.yaml`, uncomment the R2 section:

```yaml
# Cloudflare R2 Storage
r2:
  account_id: ${R2_ACCOUNT_ID}
  access_key_id: ${R2_ACCESS_KEY_ID}
  secret_access_key: ${R2_SECRET_ACCESS_KEY}
  bucket_name: ${R2_BUCKET_NAME}
  public_url: ${R2_PUBLIC_URL}  # Optional
```

### 7.2 Commit and Deploy

```bash
git add config.yaml
git commit -m "Enable R2 storage"
git push
```

Koyeb will automatically redeploy your backend.

---

## Testing Your Deployment

1. Visit your frontend: `https://stemset.pages.dev`
2. Click **Sign in with Google**
3. You should be redirected to Google OAuth
4. After signing in, you should see your profiles and audio files
5. Click play on a song to test audio streaming from R2

---

## Costs Breakdown

### Free Tier Limits

**Cloudflare Pages**:
- ✅ Unlimited bandwidth
- ✅ Unlimited requests
- ✅ 500 builds/month

**Koyeb Free Tier**:
- ✅ 512MB RAM, 0.1 vCPU
- ✅ 100GB bandwidth/month
- ⚠️ No auto-sleep (stays running)

**Cloudflare R2**:
- ✅ 10GB storage/month
- ✅ 1M Class A operations/month (writes)
- ✅ 10M Class B operations/month (reads)
- ✅ **Zero egress fees** (unlimited downloads!)

### Cost Estimates if You Exceed Free Tier

- **R2 storage**: $0.015/GB/month (after 10GB)
- **Koyeb**: Stays free as long as you use <100GB bandwidth
- **Pages**: Always free for reasonable use

---

## Troubleshooting

### Backend won't start
- Check Koyeb logs for errors
- Verify all environment variables are set correctly
- Ensure `config.yaml` references match env vars

### Frontend can't reach API
- Check CORS configuration in `src/api/app.py`
- Verify `FRONTEND_URL` is set correctly in Koyeb
- Check `VITE_API_URL` in Cloudflare Pages

### Audio files won't play
- Verify files are uploaded to R2 (see step 5.5)
- Check R2 credentials in Koyeb environment variables
- Check browser console for CORS errors

### OAuth not working
- Verify redirect URIs in Google Cloud Console
- Check `OAUTH_REDIRECT_URI` matches Koyeb URL
- Ensure `FRONTEND_URL` is set correctly

---

## Local Development

For local development, you can still use the existing setup:

```bash
# Terminal 1: Backend
./dev.sh

# Terminal 2: Frontend
cd frontend && bun run dev
```

Visit `http://localhost:5173` - the frontend will proxy API requests to `localhost:8000`.

---

## Custom Domains (Optional)

### Frontend Custom Domain
1. In Cloudflare Pages → Custom domains
2. Add your domain (e.g., `stemset.yourdomain.com`)
3. Update `FRONTEND_URL` in Koyeb to match

### Backend Custom Domain
1. In Koyeb → Domains
2. Add your domain (e.g., `api.yourdomain.com`)
3. Update `OAUTH_REDIRECT_URI` and `VITE_API_URL` accordingly
4. Update Google OAuth authorized URIs

---

## Migration from Render

If you're currently on Render:

1. Export your Render environment variables
2. Follow steps above to deploy to Koyeb + Cloudflare
3. Test everything works
4. Update DNS/OAuth to point to new URLs
5. Delete Render app once confirmed working

---

## Docker Usage (Optional)

### Build Locally

```bash
# Build API image
docker build --target api -t stemset-api .

# Build processing image
docker build --target processing -t stemset-processing .
```

### Run API Locally

```bash
docker run -p 8000:8000 \
  -e STEMSET_BYPASS_AUTH=true \
  -e STEMSET_LOCAL_STORAGE=true \
  -v $(pwd)/media:/app/media \
  stemset-api
```

### Run Processing Locally

```bash
# Process files using Docker
docker run --rm \
  -v $(pwd)/media:/app/media \
  -v $(pwd)/input:/app/input \
  -v $(pwd)/.models:/app/.models \
  stemset-processing process h4n
```

---

## Next Steps

- Set up automatic syncing of processed files to R2
- Configure custom domains for cleaner URLs
- Set up monitoring/alerts for Koyeb app
- Consider adding caching layer (Cloudflare CDN already caches frontend)
