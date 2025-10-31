# Modal GPU Worker Deployment Guide

This guide explains how to deploy and use Modal for on-demand GPU processing with Stemset.

## Why Modal?

**Cost Savings**: Modal charges per-second for actual GPU usage with no idle minimums
- Koyeb RTX-4000: $0.046/job (30s compute + 300s forced idle)
- **Modal A100: $0.021/job** (30s × $2.50/hr, pay-per-second only)
- **~54% cost reduction** for typical workloads

**Additional Benefits**:
- ✅ True serverless - no minimum idle time
- ✅ Fast cold starts (<1s vs 300s minimum on Koyeb)
- ✅ Better GPU options (A100, H100, etc.)
- ✅ Simpler deployment (no Docker builds)
- ✅ $30 free credits + potential startup program credits ($500-$50k)
- ✅ Native R2 integration via CloudBucketMount

## Architecture Overview

```
┌─────────────────┐     Upload      ┌─────────────────┐
│  Local Files    │────────────────>│   R2 Storage    │
│  or Web Upload  │                 │   (inputs/)     │
└─────────────────┘                 └─────────────────┘
                                           │
                                           │ Mount
                                           ▼
                                    ┌─────────────────┐
                                    │  Modal Worker   │
                                    │  (A100 GPU)     │
                                    │  Pay-per-second │
                                    └─────────────────┘
                                           │
                                           │ Upload
                                           ▼
                                    ┌─────────────────┐
                                    │   R2 Storage    │
                                    │   (outputs/)    │
                                    └─────────────────┘
                                           │
                                           │ Download (optional)
                                           ▼
                                    ┌─────────────────┐
                                    │  Local Media    │
                                    │  (CLI only)     │
                                    └─────────────────┘
```

## Components

1. **CLI / Web Frontend**: Uploads input files to R2
2. **Modal Worker**: Serverless GPU function that processes audio on-demand
3. **R2 Storage**: Stores both inputs and outputs (mounted directly by Modal)
4. **API Backend** (Koyeb): Coordinates jobs and handles callbacks

## Setup Steps

### 1. Install Modal SDK

```bash
# Install modal package
uv sync

# Authenticate with Modal
modal token new
```

This opens a browser window to authenticate. After authenticating, your credentials are stored locally.

### 2. Create Modal Secret for R2

Modal needs access to your R2 bucket. Create a secret with your R2 credentials:

```bash
./scripts/setup_modal_secret.sh
```

**Note**: Cloudflare R2 is S3-compatible, so it uses `AWS_*` variable names even though it's not AWS.

### 3. Deploy to Modal

```bash
# Deploy the worker function
uv run modal deploy src/processor/worker.py
```

This will output the webhook URL for your function, something like:
```
✓ Created web function process => https://your-workspace--stemset-gpu-process.modal.run
```

### 4. Configure Stemset

Update your `.env` file with the Modal endpoint:

```bash
# GPU worker URL (get from modal deploy output)
GPU_WORKER_URL=https://your-workspace--stemset-gpu-process.modal.run
```

**Important**: Make sure R2 is configured in `config.yaml`:

```yaml
r2:
  account_id: ${R2_ACCOUNT_ID}
  access_key_id: ${R2_ACCESS_KEY_ID}
  secret_access_key: ${R2_SECRET_ACCESS_KEY}
  bucket_name: stemset-media
  public_url: ${R2_PUBLIC_URL}  # Optional
```

## Usage

### CLI Processing with Modal

```bash
# Process files using Modal GPU worker
uv run stemset process h4n

# What happens:
# 1. Input uploaded to R2 (inputs/h4n/filename.wav)
# 2. Modal function triggered via HTTP
# 3. Modal mounts R2, downloads input
# 4. GPU processes audio (~30 seconds)
# 5. Stems uploaded back to R2
# 6. CLI downloads results to local media/h4n/
```

### Web Upload Processing

```javascript
// Frontend uploads file, then triggers processing
const formData = new FormData();
formData.append('file', audioFile);

// 1. Upload to R2 and trigger processing (single endpoint)
const uploadResponse = await fetch('/api/upload/h4n', {
  method: 'POST',
  body: formData,
});

const { job_id } = await uploadResponse.json();

// 2. Poll for completion
const pollStatus = async () => {
  const statusResponse = await fetch(`/api/jobs/${job_id}`);
  const { status, stems } = await statusResponse.json();

  if (status === 'complete') {
    console.log('Processing complete!', stems);
  } else if (status === 'error') {
    console.error('Processing failed');
  } else {
    setTimeout(pollStatus, 2000);  // Poll every 2 seconds
  }
};

pollStatus();
```

## GPU Options and Pricing

Modal offers several GPU options. You can change the GPU in `src/processor/worker.py`:

```python
@app.function(
    gpu="A100-40GB",  # Change this
    ...
)
```

### Available GPUs

| GPU | VRAM | Price/Hour | Price/30s | Best For |
|-----|------|------------|-----------|----------|
| T4 | 16GB | $0.59 | $0.005 | Budget processing, htdemucs |
| L4 | 24GB | $0.70 | $0.006 | Good value, htdemucs_ft |
| A10G | 24GB | $1.10 | $0.009 | Mid-tier, recommended |
| A100-40GB | 40GB | $2.50 | $0.021 | High performance, our default |
| H100 | 80GB | ~$4.00 | $0.033 | Overkill for audio (not needed) |

**Recommendation**: Start with **A10G** ($1.10/hr) for best value. A100 is currently configured but may be more than you need.

## Cost Examples

**100 jobs/month, 30 seconds each**:
- Koyeb RTX-4000: $4.60/month (with 300s idle per job)
- Modal A100: $2.10/month (pay-per-second)
- Modal A10G: $0.92/month (pay-per-second)
- **Modal T4: $0.50/month** (cheapest option)

**1000 jobs/month, 30 seconds each**:
- Koyeb RTX-4000: $46.00/month
- Modal A100: $21.00/month
- Modal A10G: $9.20/month
- Modal T4: $5.00/month

## Monitoring

### View Modal Logs

```bash
# View recent logs
modal app logs stemset-gpu

# Stream logs in real-time
modal app logs stemset-gpu --follow
```

### Check Modal Dashboard

Visit [modal.com/apps](https://modal.com/apps) to see:
- Function invocations
- GPU usage and costs
- Logs and errors
- Performance metrics

## Troubleshooting

### Modal Worker Won't Start

- **Check R2 secret**: `modal secret list` should show `r2-secret`
- **Verify config.yaml**: Must be copied into Modal image
- **Check account ID**: Update `bucket_endpoint_url` with your R2 account ID

### Processing Fails

- **Check input file exists in R2**: `inputs/<profile>/<filename>`
- **Verify strategy exists**: Check config.yaml strategies section
- **Monitor Modal logs**: `modal app logs stemset-gpu`
- **Check callback URL**: Ensure API backend is accessible from Modal

### "Secret not found" Error

Create the R2 secret:
```bash
modal secret create r2-secret \
  AWS_ACCESS_KEY_ID=<your-key> \
  AWS_SECRET_ACCESS_KEY=<your-secret>
```

### Cold Starts

Modal cold starts are typically <1 second for Python functions. If you see slow starts:
- Check image size (Modal downloads image on first run)
- Consider using `@app.cls()` for stateful deployments with model caching

## Updating the Worker

When you make changes to the worker code:

```bash
# Redeploy
modal deploy src/processor/worker.py

# The URL stays the same, so no need to update GPU_WORKER_URL
```

## Free Credits & Startup Program

- **New Users**: $30 in free credits
- **Startup Program**: $500 - $50,000 in credits
  - Apply at [modal.com/startups](https://modal.com/startups)
  - Requirements: Shared workspace (not personal), early-stage startup

## Alternative: Local GPU Processing

If you have a local GPU, you can bypass Modal entirely:

```bash
# Process locally (no GPU_WORKER_URL needed)
uv run stemset process h4n --local
```

This uses your local machine's GPU (if available) or CPU for processing.

## Next Steps

1. ✅ Install Modal SDK: `uv sync`
2. ✅ Authenticate: `modal token new`
3. ✅ Create R2 secret: `modal secret create r2-secret ...`
4. ✅ Update account ID in `src/processor/worker.py`
5. ✅ Deploy worker: `modal deploy src/processor/worker.py`
6. ✅ Set `GPU_WORKER_URL` in `.env`
7. ✅ Test: `uv run stemset process h4n some-file.wav`
8. 🎵 Process audio with serverless GPUs!
