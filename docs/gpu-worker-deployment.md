# GPU Worker Deployment Guide

This guide explains how to deploy and use the on-demand GPU processing feature for Stemset.

## Architecture Overview

```
┌─────────────────┐     Upload      ┌─────────────────┐
│  Local Files    │────────────────>│   R2 Storage    │
│  or Web Upload  │                 │   (inputs/)     │
└─────────────────┘                 └─────────────────┘
                                           │
                                           │ Download
                                           ▼
                                    ┌─────────────────┐
                                    │  GPU Worker     │
                                    │  (Koyeb GPU)    │
                                    │  Scale-to-Zero  │
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
2. **GPU Worker**: Koyeb GPU instance that processes audio on-demand
3. **R2 Storage**: Stores both inputs and outputs
4. **API Backend**: Coordinates jobs and handles callbacks

## Deployment Steps

### 1. Build and Deploy GPU Worker to Koyeb

**Build the Docker image:**

```bash
# Build GPU worker target
docker build --target gpu-worker -t stemset-gpu-worker .

# Tag for your registry
docker tag stemset-gpu-worker:latest your-registry/stemset-gpu-worker:latest

# Push to registry
docker push your-registry/stemset-gpu-worker:latest
```

**Deploy to Koyeb:**

1. Go to https://app.koyeb.com
2. Create new service
3. Select "Docker" as source
4. Enter your image: `your-registry/stemset-gpu-worker:latest`
5. **Important**: Select GPU instance type (e.g., A100)
6. Enable **Scale-to-Zero** (1-5s cold start)
7. Set environment variables:
   - `R2_ACCOUNT_ID`
   - `R2_ACCESS_KEY_ID`
   - `R2_SECRET_ACCESS_KEY`
   - `R2_BUCKET_NAME`
   - `R2_PUBLIC_URL` (optional)
8. Deploy!

**Service Configuration:**

```yaml
# .koyeb/gpu-worker.yaml (example)
name: stemset-gpu-worker
services:
  - name: gpu-worker
    regions:
      - was  # Washington D.C.
    instance_types:
      - gpu-nvidia-a100  # A100 GPU
    autoscaling:
      min: 0  # Scale to zero
      max: 1
    env:
      - name: R2_ACCOUNT_ID
        value: ${R2_ACCOUNT_ID}
      - name: R2_ACCESS_KEY_ID
        value: ${R2_ACCESS_KEY_ID}
      - name: R2_SECRET_ACCESS_KEY
        value: ${R2_SECRET_ACCESS_KEY}
      - name: R2_BUCKET_NAME
        value: stemset-media
    ports:
      - port: 8000
        protocol: http
```

### 2. Configure Stemset for Remote Processing

**Update config.yaml:**

```yaml
# Add GPU worker URL
gpu_worker_url: https://stemset-gpu.koyeb.app

# Enable remote processing for a profile
profiles:
  - name: "h4n"
    source_folder: "/Volumes/H4N_SD/STEREO"
    strategy: "hdemucs_mmi"
    remote: true  # Enable GPU processing
    output:
      format: "opus"
      bitrate: 192
```

**Update .env:**

```bash
# Backend URL (for GPU worker callbacks)
BACKEND_URL=https://stemset-api.koyeb.app

# R2 credentials (required for remote processing)
R2_ACCOUNT_ID=your-account-id
R2_ACCESS_KEY_ID=your-access-key
R2_SECRET_ACCESS_KEY=your-secret-key
R2_BUCKET_NAME=stemset-media
R2_PUBLIC_URL=https://pub-xyz.r2.dev  # Optional
```

## Usage

### Local Development with Remote Processing

```bash
# 1. Drop files in source folder
cp my-track.wav /Volumes/H4N_SD/STEREO/

# 2. Process using GPU worker
uv run stemset process h4n

# What happens:
# - Input uploaded to R2 (inputs/h4n/my-track.wav)
# - GPU worker triggered via HTTP
# - GPU worker downloads, processes, uploads stems
# - CLI downloads results to local media/h4n/
```

### Production Web Upload

```javascript
// Frontend uploads file, then triggers processing
const formData = new FormData();
formData.append('file', audioFile);

// 1. Upload to R2 (via backend API)
const uploadResponse = await fetch('/api/upload', {
  method: 'POST',
  body: formData,
});

// 2. Trigger processing
const jobResponse = await fetch('/api/process', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    profile_name: 'h4n',
    filename: 'my-track.wav',
    output_name: 'my-track_abc12345',
  }),
});

const { job_id } = await jobResponse.json();

// 3. Poll for completion
const pollStatus = async () => {
  const statusResponse = await fetch(`/api/jobs/${job_id}/status`);
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

## Cost Optimization

**Koyeb GPU Pricing (A100):**
- ~$0.50/hour when running
- $0 when sleeping (scale-to-zero)
- Cold start: 1-5 seconds with Deep Sleep

**Example Costs:**
- 5-second processing job: ~$0.0007
- 100 jobs/day with 99% sleep: ~$2/month
- Keeping warm (min=1): ~$360/month

**Best Practices:**
1. Use **scale-to-zero** for development and low-traffic production
3. Set idle period to 5 minutes to handle bursts
4. For high traffic, consider `min: 1` during peak hours only

## Monitoring

**Check GPU worker logs:**

```bash
# Via Koyeb CLI
koyeb logs stemset-gpu-worker

# Watch for:
# - "Downloading input: inputs/h4n/file.wav"
# - "Processing with strategy: hdemucs_mmi"
# - "Uploading 4 stems to R2"
# - "Calling back to: https://stemset-api.koyeb.app/api/jobs/..."
```

**Check API backend logs:**

```bash
# Via Koyeb CLI
koyeb logs stemset-api

# Watch for:
# - "Job abc-123 completed: complete"
# - "Stems: ['vocals', 'drums', 'bass', 'other']"
```

## Troubleshooting

### GPU Worker Won't Start

- **Check R2 credentials**: GPU worker requires R2 to be configured
- **Verify config.yaml**: Must be present in Docker image
- **Check GPU availability**: A100 instances may have limited availability

### Processing Fails

- **Check input file exists in R2**: `inputs/<profile>/<filename>`
- **Verify strategy exists**: Check config.yaml strategies section
- **Monitor GPU worker logs**: Look for error messages
- **Check callback URL**: Ensure API backend is accessible from GPU worker

### CLI Can't Download Results

- **Check R2 credentials locally**: Must have R2 access to download
- **Verify output exists**: Check R2 bucket for `<profile>/<output_name>/`
- **Check network**: Ensure you can reach R2 storage

### Cold Start Too Slow

- **Keep warm during peak hours**: Set `min: 1` temporarily
- **Optimize Docker image**: Reduce layer size for faster pulls

## Alternative: Local GPU Processing

If you have a local GPU, you can skip the GPU worker entirely:

```yaml
profiles:
  - name: "h4n"
    remote: false  # Use local processing
    # ... rest of config
```

This uses your local machine's GPU (if available) or CPU for processing.

## Next Steps

1. Deploy GPU worker to Koyeb
2. Update `config.yaml` with `gpu_worker_url` and `remote: true`
3. Test with a small file: `uv run stemset process h4n some-file.wav`
4. Monitor costs and adjust scale-to-zero settings as needed
5. Implement web upload API endpoint for production
