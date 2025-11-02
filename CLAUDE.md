# Stemset Development Guide

## What This Is

Stemset is an AI-powered audio stem separation application with Google OAuth authentication:
1. **Backend**: Python/Litestar service that serves stems via authenticated REST API and hosts the frontend
2. **Frontend**: React/TypeScript web player with Google OAuth for secure access and independent stem volume controls
3. **Processing**: Audio separation can run either:
   - **Locally**: `uv run stemset process <profile>` (default)
   - **Remotely**: On-demand Modal serverless GPU functions (pay-per-second, no idle charges)
   - Processed stems stored in R2 and optionally downloaded to local `media/`

## Core Principles

### Fail Fast
We do not catch exceptions to provide fallbacks. If something fails, we want to know immediately. No `try/except` blocks unless absolutely necessary for resource cleanup.

### Modern Python
- Use Python 3.13+ features: `from __future__ import annotations`, type unions with `|`, no `Optional`
- Type everything. No `Any` unless interfacing with untyped third-party code. Check with `basedpyright`
- Pydantic for all data models, configuration, and serialization
- `uv` for package management, not pip

### Clean Architecture Layers

**Unidirectional dependencies only.** Higher layers can import from lower layers, never the reverse.

```
Configuration (config.py)
    ↓
Registry (models/registry.py)
    ↓
Base Abstractions (models/audio_separator_base.py)
    ↓
Concrete Models (models/atomic_models.py)
    ↓
Executors (models/strategy_executor.py)
    ↓
Public Interface (modern_separator.py)
    ↓
API (api.py)
```

## How We Structure Code

### Separation Models

All audio separation models inherit from `AudioSeparator` ABC which defines:
- `output_slots: dict[str, str]` - What this model produces (e.g., `{"vocals": "Vocal track", "not_vocals": "Instrumental"}`)
- `model_filename: str` - Which model file to load
- `separate(input_file, output_dir) -> dict[str, Path]` - Performs separation

We use `AudioSeparatorLibraryModel` as the base for models using the `audio-separator` library, so concrete models only need to define `output_slots` and `model_filename`.

### Strategy Trees

Strategies are defined in `config.yaml` as recursive trees:
```yaml
successive:
  _: "vocals_mel_band_roformer.ckpt"  # Model to use
  vocals: vocals                       # Final output
  not_vocals:                          # Feed into next model
    _: "kuielab_b_drums.onnx"
    drums: drums
    not_drums:
      _: "kuielab_a_bass.onnx"
      bass: bass
      not_bass: other
```

The `_` key specifies which model to use. Other keys map that model's output slots to either:
- **String values**: Final stem names (leaf nodes)
- **Dict values**: Subtrees that process that output further

**Validation**: At execution time, we verify output slots in the config match what the model actually produces. Config errors fail immediately with clear messages.

**Intermediate Processing**: All intermediate files use lossless WAV format. Only final outputs use the user's configured format (Opus, WAV, etc.).

**Processing Workflows**:>`

**Web Upload Processing** (Modal):
1. Frontend uploads file to backend
2. Backend uploads to storage (R2/local)
3. Backend triggers GPU (or local) worker
4. Worker processes and uploads stems
5. Worker calls back to API
6. Frontend polls for completion
7. Frontend streams stems from R2

**Modal Worker Deployment**:
- Deploy with: `modal deploy src/processor/worker.py`
- Creates serverless HTTPS endpoint automatically
- Mounts R2 bucket via CloudBucketMount (no egress fees)
- Pay-per-second billing with no idle charges
- See `docs/modal-deployment.md` for full deployment guide

