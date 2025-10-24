<img src="https://r2cdn.perplexity.ai/pplx-full-logo-primary-dark%402x.png" style="height:64px;margin-right:32px"/>

## Triggering On-Demand GPU Processing from Your Litestar Backend

To build an on-demand audio processing system using Koyeb's scale-to-zero GPU instances triggered from your existing Litestar backend, you'll need to architect a solution that minimizes both idle costs and cold-start times. Here's how to implement this effectively:

### Architecture Overview

**Your Litestar Backend (Free Tier)** → **Cloudflare R2 (File Storage)** → **Trigger** → **GPU Worker Service (Scale-to-Zero)** → **Process \& Store Results**

### 1. Setting Up the GPU Worker Service

Deploy your hdemucs-ft audio processing service as a **Worker** type service on Koyeb with scale-to-zero enabled:[^1][^2]

- Set `--min-instances 0` to enable scale-to-zero
- Use Standard GPU instances (A100 or similar)
- Set idle period to 5 minutes (default) or customize based on your plan[^2]

The worker service should:

- Listen on an HTTP endpoint for processing requests
- Accept a job payload (R2 file URL, callback URL, job ID)
- Download audio from R2, process with hdemucs-ft, upload results back to R2
- Call back to your Litestar backend when complete


### 2. Triggering Methods (Choose One)

#### Option A: Direct HTTP Trigger from Litestar (Recommended)

After uploading to R2, your Litestar backend directly calls the GPU worker's public endpoint:

```python
import httpx

async def trigger_demux_job(audio_r2_url: str, job_id: str):
    payload = {
        "audio_url": audio_r2_url,
        "job_id": job_id,
        "callback_url": f"https://your-litestar-app.koyeb.app/jobs/{job_id}/complete"
    }
    
    async with httpx.AsyncClient(timeout=30.0) as client:
        # This will wake the sleeping GPU worker
        response = await client.post(
            "https://your-gpu-worker.koyeb.app/process",
            json=payload
        )
    return response.json()
```

**Pros**: Simple, no additional infrastructure, fastest to implement
**Cons**: Your Litestar app waits for the GPU worker to wake (200ms-5s cold start)

#### Option B: R2 Event Notifications + Queue (More Complex)

Use Cloudflare R2's event notifications to trigger processing automatically:[^4]

1. Configure R2 bucket event notifications for `object-create` events
2. Send notifications to a Cloudflare Queue
3. Create a lightweight consumer Worker (Cloudflare Workers) that:
    - Receives queue messages
    - Calls your Koyeb GPU worker endpoint with job details

**Pros**: Fully decoupled, your Litestar app doesn't wait for wake-up
**Cons**: Requires Cloudflare Workers paid plan (\$5/month), more complex setup[^5]

### 3. Minimizing Costs and Cold Starts

**To minimize A100 usage costs:**

- **Scale-to-zero is essential**: You pay \$0 when sleeping[^1][^2]
- **Batch processing**: If you have multiple files, queue them and process in one wake cycle
- **Set appropriate idle period**: Default 5 minutes means the worker stays warm for 5 minutes after last request[^2]

**Actual costs** (based on GPU pricing):

- A100 GPU: ~\$0.50/hour ≈ \$0.00014/second[^6]
- 5-second processing job: ~\$0.0007
- If sleeping 99% of the time with 100 jobs/day: ~\$0.07/day

**Cold start optimization:**

- Deep Sleep: 1-5 seconds (default, no extra cost during preview)[^2]
- Consider keeping `min-instances: 1` during peak hours if you need real-time responses


### 4. Triggering via Koyeb API

If you prefer programmatic control, use the Koyeb API to trigger redeployment or wake services:[^7][^8][^9]

```python
import httpx

async def trigger_koyeb_service(service_id: str, koyeb_token: str):
    headers = {"Authorization": f"Bearer {koyeb_token}"}
    
    # Redeploy/wake the service
    async with httpx.AsyncClient() as client:
        response = await client.post(
            f"https://app.koyeb.com/v1/services/{service_id}/redeploy",
            headers=headers
        )
    return response.json()
```

However, **this is NOT recommended** for on-demand processing because:

- Redeployment creates a new deployment, not just waking a sleeping service
- It's designed for CI/CD, not per-request triggers
- Cold starts are longer than simply hitting the service endpoint


### 5. Complete Workflow Example

```python
# In your Litestar backend after R2 upload
@post("/upload")
async def upload_audio(data: UploadRequest) -> dict:
    # 1. Upload to R2 using boto3
    r2_url = await upload_to_r2(data.file)
    
    # 2. Create job record in your database
    job = await db.create_job(
        user_id=data.user_id,
        audio_url=r2_url,
        status="pending"
    )
    
    # 3. Trigger GPU worker (will wake if sleeping)
    await trigger_gpu_worker(
        audio_url=r2_url,
        job_id=job.id,
        callback_url=f"{settings.base_url}/jobs/{job.id}/complete"
    )
    
    return {"job_id": job.id, "status": "processing"}

# Callback endpoint for GPU worker
@post("/jobs/{job_id}/complete")
async def job_complete(job_id: str, result: ProcessingResult) -> dict:
    await db.update_job(job_id, status="complete", stems_urls=result.stems)
    # Notify user via websocket/email/etc
    return {"status": "ok"}
```


### 6. GPU Worker Service Structure

Your GPU worker should be a simple HTTP server:

```python
# worker.py
from litestar import Litestar, post
import httpx

@post("/process")
async def process_audio(job: ProcessingJob) -> dict:
    # 1. Download from R2
    audio_file = await download_from_r2(job.audio_url)
    
    # 2. Run hdemucs-ft (2-5 seconds on A100)
    stems = await run_demucs(audio_file)
    
    # 3. Upload stems back to R2
    stem_urls = await upload_stems_to_r2(stems, job.job_id)
    
    # 4. Callback to Litestar backend
    async with httpx.AsyncClient() as client:
        await client.post(job.callback_url, json={"stems": stem_urls})
    
    return {"status": "complete", "stems": stem_urls}

app = Litestar([process_audio])
```


### Recommended Approach

**For your use case (hobby project, minimizing costs):**

1. Use **Direct HTTP Trigger** (Option A) - simplest implementation
2. Set idle period to **5 minutes** (keeps worker warm for multiple uploads in a session)
3. Your Litestar backend should return immediately after triggering, with job status in database
4. Client polls for completion or receives webhook/SSE notification

This gives you true pay-per-second GPU usage with minimal complexity.[^10][^11][^7][^1][^2]
<span style="display:none">[^12][^13][^14][^15][^16][^17][^18][^19][^20][^21][^22][^23][^24][^25][^26][^27][^28][^29][^30][^31][^32][^33][^34][^35][^36][^37][^38][^39][^40][^41][^42][^43][^44][^45][^46][^47][^48][^49][^50]</span>

<div align="center">⁂</div>

[^1]: https://www.koyeb.com/blog/scale-to-zero-optimize-gpu-and-cpu-workloads

[^2]: https://www.koyeb.com/docs/run-and-scale/scale-to-zero

[^3]: https://www.koyeb.com/blog/avoid-cold-starts-with-scale-to-zero-light-sleep

[^4]: https://developers.cloudflare.com/r2/buckets/event-notifications/

[^5]: https://www.reddit.com/r/CloudFlare/comments/1m277yt/why_are_basic_r2_object_upload_notifications/

[^6]: https://www.koyeb.com/pricing

[^7]: https://www.koyeb.com/docs/build-and-deploy/cli/reference

[^8]: https://community.koyeb.com/t/specify-image-tag-during-re-deploy/3990

[^9]: https://github.com/souravkl11/koyeb-api-nodejs

[^10]: https://dev.to/ephraimx/how-to-deploy-a-full-stack-app-to-koyeb-using-docker-compose-and-jenkins-19a7

[^11]: https://www.linkedin.com/posts/alisdairbroshar_serverless-just-got-a-whole-lot-more-real-activity-7272645630055927808-eYlL

[^12]: https://community.koyeb.com/t/docker-auto-redeployment-on-image-changes/2065

[^13]: https://pipedream.com/apps/samsara/integrations/koyeb

[^14]: https://github.com/koyeb/koyeb-github-runner-scheduler-demo

[^15]: https://community.koyeb.com/t/is-there-a-way-to-create-worker-that-cleans-itself-up-if-there-is-a-successful-exit/2818

[^16]: https://websockets.readthedocs.io/en/stable/deploy/koyeb.html

[^17]: https://www.koyeb.com/docs/reference/services

[^18]: https://www.youtube.com/watch?v=9N0_IGDZAIs

[^19]: https://www.nylas.com/blog/how-to-create-and-read-webhooks-with-php-koyeb-and-bruno/

[^20]: https://www.koyeb.com/docs/reference/api

[^21]: https://www.koyeb.com/tutorials/dynamically-start-github-action-runners-on-koyeb

[^22]: https://www.koyeb.com

[^23]: https://www.koyeb.com/blog/deploy-ai-infrastructure-in-2025-autoscaling-serverless-gpus-scale-to-zero-and-more

[^24]: https://www.koyeb.com/docs/build-and-deploy/prebuilt-docker-images

[^25]: https://www.koyeb.com/tutorials/tag/api

[^26]: https://www.koyeb.com/blog/pro-and-scale-plans-manage-1000s-of-services-more-users-and-included-compute

[^27]: https://www.koyeb.com/docs/build-and-deploy/deploy-with-git

[^28]: https://www.pulumi.com/registry/packages/koyeb/api-docs/service/

[^29]: https://developers.cloudflare.com/images/manage-images/configure-webhooks/

[^30]: https://www.pulumi.com/registry/packages/koyeb/api-docs/getservice/

[^31]: https://community.koyeb.com/t/partial-re-deploy-possiblitity/177

[^32]: https://developers.cloudflare.com/notifications/get-started/configure-webhooks/

[^33]: https://registry.terraform.io/providers/koyeb/koyeb/latest/docs/resources/service

[^34]: https://www.koyeb.com/tutorials/deploy-a-python-celery-worker

[^35]: https://developers.cloudflare.com/api/resources/alerting/subresources/destinations/subresources/webhooks/methods/create/

[^36]: https://developer.koyeb.com

[^37]: https://www.koyeb.com/tutorials

[^38]: https://blog.cloudflare.com/th-th/data-anywhere-events-pipelines-durable-execution-workflows

[^39]: https://www.koyeb.com/docs/reference/deployments

[^40]: https://neon.com/docs/guides/koyeb

[^41]: https://community.koyeb.com/t/not-enough-information-in-api-documentation/275

[^42]: https://dev.to/ephraimx/how-to-deploy-a-full-stack-app-to-koyeb-using-docker-compose-and-github-actions-2oj

[^43]: https://www.prisma.io/docs/orm/prisma-client/deployment/traditional/deploy-to-koyeb

[^44]: https://www.koyeb.com/tutorials/deploy-a-rest-api-using-koa-prisma-and-aiven

[^45]: https://hasura.io/docs/2.0/deployment/deployment-guides/koyeb/

[^46]: https://www.postman.com/gokoyeb/koyeb/documentation/y5r00xu/koyeb-rest-api

[^47]: https://www.koyeb.com/docs

[^48]: https://www.koyeb.com/tutorials/how-to-deploy-a-rest-api-with-flask-fauna-and-authentication-on-koyeb

[^49]: https://www.npmjs.com/package/node-koyeb-api

[^50]: https://www.koyeb.com/tutorials/using-langserve-to-build-rest-apis-for-langchain-applications

