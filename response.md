No, it does not work *exactly* the same way, though the logic for triggering the GPU worker is now identical.

Here's the breakdown:

1.  **GPU Worker Triggering**: The logic for determining whether to use a GPU worker and then triggering it via an HTTP POST request is now the same in both `upload_routes.py` (direct file upload) and `drive_routes.py` (Google Drive import). If `config.gpu_worker_url` or `GPU_WORKER_URL` is set, both will attempt to send the job to the remote Modal worker.

2.  **Local Processing Fallback**: This is where the difference lies.
    *   In `upload_routes.py`, if no GPU worker URL is configured, the local processing is initiated as a `BackgroundTask` that runs truly in the background, allowing the HTTP response to be sent immediately.
    *   In `drive_routes.py`, if no GPU worker URL is configured, the local processing `BackgroundTask` is `await`ed. This means that the HTTP response for the Google Drive import will *block* and wait until the local processing is complete before being sent back to the client.

So, while the remote GPU worker path is now consistent, the local processing fallback in the Google Drive import will block the API response, unlike the direct file upload.