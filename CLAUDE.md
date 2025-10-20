Let me chronologically analyze this conversation to create a comprehensive summary:

1. **Initial Setup**: User wanted to implement an AI-powered audio stem separation application with two components:
   - Backend: Scans directory for audio files, uses BS-RoFormer to separate into vocals/drums/bass/other
   - Frontend: Web player with independent volume controls

2. **Technology Choices Made**:
   - Python backend with Litestar API framework (user explicitly requested)
   - Bun for frontend package management (user explicitly requested)
   - Minimal TypeScript/React frontend
   - BS-RoFormer for stem separation (state-of-the-art model)
   - Opus compression for output (configurable, user requested)

3. **Key Implementation Decisions**:
   - Profile-based configuration (multiple source folders)
   - Content-based hashing to prevent duplicate processing
   - Queue system for sequential processing
   - Per-stem gain adjustments (informational only for UI)

4. **Major Pivots and User Corrections**:
   - User requested uv instead of pip
   - User requested bun instead of npm
   - User wanted to remove redundant mark_as_processed call
   - User asked to simplify separator by using audio-separator library features properly
   - User wanted fail-fast approach, removing try/except fallbacks
   - User clarified that per-stem gains are UI defaults, not post-processing

5. **Critical Issues Found and Fixed**:
   - Frontend infinite polling loop (useEffect dependencies)
   - CPU nice not working (switched to PyTorch thread limiting)
   - Toast notifications instead of window alerts
   - Backend connection splash screen
   - Queue status not clearing
   - Temporary WAV files littering directory
   - Duplicate folder creation (files marked processed immediately when queued)
   - Wrong model being used (2-stem instead of 4-stem)

6. **Files Created/Modified**:
   - Backend (src/): config.py, scanner.py, separator.py, queue.py, api.py, main.py
   - Frontend (frontend/): App.tsx, Toast.tsx, StemPlayer.tsx, types.ts, api.ts
   - Config: config.yaml, pyproject.toml, README.md

7. **Architectural Patterns**:
   - Singleton pattern for config and queue
   - Profile-based configuration
   - Content-based deduplication using SHA256 hashes
   - AsyncIO queue processing with threading for blocking operations
   - Web Audio API for synchronized multi-track playback

Summary:
1. **Primary Request and Intent**:
   - Build a two-component application for AI-powered audio stem separation:
     - **Component 1 (Backend)**: Directory scanner that monitors for new WAV files, uses state-of-the-art BS-RoFormer AI model to separate audio into 4 stems (vocals, drums, bass, other/guitars), 
saves stems with configurable Opus compression
     - **Component 2 (Frontend)**: Minimal web application allowing bandmates to play back separated stems with independent volume controls for practice/critical listening
   - Support multiple "profiles" (different source folders with independent settings)
   - Use content-based hashing to prevent duplicate processing (filenames change on recording device)
   - Process files sequentially in a queue (one at a time, no real-time requirement)
   - Apply loudness normalization with per-stem gain adjustments
   - Per-stem gain adjustments are informational only (set default UI slider positions, not applied during processing)

2. **Key Technical Concepts**:
   - **BS-RoFormer**: Band-Split Rotary Transformer - state-of-the-art model for music source separation (11.89 dB SDR for vocals)
   - **LUFS Normalization**: ITU-R BS.1770-4 compliant loudness measurement and normalization
   - **Opus Compression**: High-quality lossy audio codec optimized for music (192 kbps default)
   - **Content-Based Hashing**: SHA256 hashing of file contents to detect duplicates regardless of filename
   - **Profile-Based Configuration**: YAML configuration supporting multiple source folders with independent settings
   - **Web Audio API**: Browser API for synchronized multi-track playback with independent gain control
   - **AsyncIO with Threading**: Event loop with ThreadPoolExecutor for blocking ML operations
   - **PyTorch Thread Limiting**: `torch.set_num_threads()` to limit CPU usage and keep system responsive

3. **Files and Code Sections**:

   **Backend Core Files:**
   
   - **`/Users/cam/dev/stemset/src/config.py`**
     - Why: Manages profile-based configuration using Pydantic models
     - Changes: Added `output_format` and `opus_bitrate` fields, removed unused `process_nice`
     - Key Code:
     ```python
     class Profile(BaseModel):
         name: str
         source_folder: str
         output_format: str = Field("opus")
         opus_bitrate: int = Field(192)
     ```

   - **`/Users/cam/dev/stemset/src/scanner.py`**
     - Why: Scans directories for new audio files, prevents duplicates via content hashing
     - Critical Fix: Files now marked as processed IMMEDIATELY when queued (not after completion) to prevent duplicate folder creation
     - Key Code:
     ```python
     def scan_for_new_files(self) -> list[tuple[Path, str]]:
         # ... file scanning logic ...
         file_hash = self._compute_file_hash(file_path)
         if file_hash in self.processed_hashes:
             continue
         # ... derive output name ...
         new_files.append((file_path, output_name))
         # Mark as processed immediately to prevent duplicates
         self.processed_hashes[file_hash] = output_name
         self._save_hash_db()
     ```

   - **`/Users/cam/dev/stemset/src/separator.py`** (MOST RECENT CRITICAL CHANGES)
     - Why: Core stem separation logic using audio-separator library
     - Major Refactor: Reduced from 280+ lines to 105 lines by properly using library features
     - Removed: All manual WAV metadata, Opus encoding, temp file management, try/except fallbacks
     - Critical Model Change: Updated to use 4-stem model instead of 2-stem
     - Key Code:
     ```python
     def _ensure_separator_loaded(self) -> None:
         if self.separator is None:
             import torch
             # Limit CPU threads for system responsiveness
             cpu_count = os.cpu_count() or 4
             thread_count = max(1, cpu_count // 2)
             torch.set_num_threads(thread_count)
             torch.set_num_interop_threads(thread_count)
             
             output_format = self.profile.output_format.upper()
             output_bitrate = f"{self.profile.opus_bitrate}k" if output_format == "OPUS" else None
             
             self.separator = Separator(
                 log_level=20,
                 model_file_dir=str(Path.home() / ".stemset" / "models"),
                 output_format=output_format,
                 output_bitrate=output_bitrate,
                 normalization_threshold=0.9,
             )
             
             # Load 4-stem model (vocals, drums, bass, other)
             self.separator.load_model("model_bs_roformer_viperx_sdr_10.5309.ckpt")
     
     def separate_and_normalize(self, input_file: Path, output_folder: Path) -> dict[str, Path]:
         # Build custom output names
         custom_output_names = {
             stem_name: str(output_folder / stem_name)
             for stem_name in self.STEM_NAMES
         }
         # Library handles everything (encoding, normalization, file writing)
         output_files = self.separator.separate(str(input_file), custom_output_names=custom_output_names)
         # Verify all 4 stems returned
         missing = set(self.STEM_NAMES) - set(stem_paths.keys())
         if missing:
             raise RuntimeError(f"Separation incomplete: missing stems {missing}")
     ```

   - **`/Users/cam/dev/stemset/src/queue.py`**
     - Why: Manages sequential job processing queue
     - Key Pattern: AsyncIO queue with job status tracking
     - Key Code:
     ```python
     @dataclass
     class Job:
         id: str
         profile_name: str
         input_file: Path
         output_folder: Path
         status: JobStatus
         created_at: datetime
         started_at: Optional[datetime] = None
         completed_at: Optional[datetime] = None
     ```

   - **`/Users/cam/dev/stemset/src/api.py`**
     - Why: Litestar REST API endpoints
     - Changes: Removed ineffective `os.nice()` call, removed redundant `mark_as_processed` call
     - Key Endpoints: `/api/profiles`, `/api/profiles/{name}/scan`, `/api/queue`, `/api/jobs`
     - Key Code:
     ```python
     async def process_job(job: Job) -> dict[str, str]:
         config = get_config()
         profile = config.get_profile(job.profile_name)
         separator = StemSeparator(profile)  # Handles thread limiting
         loop = asyncio.get_event_loop()
         stem_paths = await loop.run_in_executor(
             None, separator.separate_and_normalize, job.input_file, job.output_folder
         )
         return {name: str(path) for name, path in stem_paths.items()}
     ```

   **Configuration Files:**

   - **`/Users/cam/dev/stemset/config.yaml`**
     - Current example profile for H4N recorder
     - Key settings: Opus output at 192kbps, -23 LUFS target
     ```yaml
     profiles:
       - name: "h4n"
         source_folder: "/Volumes/H4N_SD/STEREO"
         output_format: "opus"
         opus_bitrate: 192
     ```

   - **`/Users/cam/dev/stemset/pyproject.toml`**
     - Dependencies: litestar, audio-separator, pyloudnorm, soundfile, watchdog, pydantic, pyyaml, uvicorn, onnxruntime, numpy
     - Python version: ==3.13.*

4. **Errors and Fixes**:

   - **Infinite Frontend Polling Loop**
     - Error: Frontend was spamming backend with requests every few milliseconds
     - Root Cause: `useEffect` had `backendConnected` in dependency array, causing re-runs on every state change
     - Fix: Removed all dependencies from polling useEffect (empty array `[]`), used closure variables for state tracking
     - User Quote: "The frontend is now SPAMMING the backend with INFO: 127.0.0.1:57732 - 'GET /api/profiles HTTP/1.1' 200 OK"

   - **CPU Nice Not Working**
     - Error: `os.nice()` call wasn't making system more responsive
     - Root Cause: os.nice() affects entire process, but using threads (not processes). PyTorch uses same process.
     - Fix: Used `torch.set_num_threads()` and `torch.set_num_interop_threads()` to limit PyTorch to half of CPU cores
     - User Quote: "The os.nice thing isn't working. Given what you now know about the audio separator library (and the fact that we're using asyncio here), is there a way to do this?"

   - **Profiles Not Loading After Reconnection**
     - Error: Profile dropdown empty when transitioning from backend down to backend up
     - Root Cause: Profiles only loaded on initial mount, not on reconnection
     - Fix: Added reconnection detection logic to reload profiles when backend comes online
     - User Feedback: Showed screenshot of empty profile dropdown

   - **Temporary WAV Files Littering Directory**
     - Error: Separator leaving WAV files in current directory
     - Root Cause: audio-separator default output directory not configured
     - Fix: Set `output_dir` parameter to `~/.stemset/temp_output`, added cleanup logic
     - User Quote: "we have a stem WAV that's littering our main folder"

   - **Duplicate Folders Created**
     - Error: Two folders created in ./media/h4n/ for same file
     - Root Cause: Files marked as processed only AFTER completion, so rescanning before completion created duplicates
     - Fix: Mark files as processed IMMEDIATELY when queued (in `scan_for_new_files()`)
     - User Quote: "we have... for some reason having *two* folders in our ./media/h4n directory even though we just processed one file"

   - **Queue Not Clearing**
     - Error: Queue status showing jobs indefinitely
     - Root Cause: Polling logic not properly updating queue status
     - Fix: Improved polling logic to track processing state transitions

   - **Over-Engineered Separator Code**
     - Error: 280+ lines of complex code with manual WAV metadata embedding, Opus encoding via ffmpeg, temp file management
     - Root Cause: Not using audio-separator library to its full potential
     - User Feedback: "I want you to take a step back and think about this problem holistically. We have introduced a lot of complexity in the form of try/excepts and fallbacks, whereas we really 
want to fail fast"
     - Fix: Massive refactor to 105 lines by using library's `output_format`, `output_bitrate`, and `custom_output_names` features
     - User Quote: "Please read the downloaded code (in .venv) and re-write our StemSeparator to use built-in opus encoding (if possible) as well as understanding exactly how to use 
custom_output_names"

   - **Wrong Model - 2 Stems Instead of 4**
     - Error: Separation failing with "missing stems {'drums', 'other', 'vocals', 'bass'}" error
     - Root Cause: Using `model_bs_roformer_ep_317_sdr_12.9755.ckpt` which is a 2-stem model (Vocals/Instrumental only, num_stems: 1 in YAML)
     - Investigation: Read model config file at `~/.stemset/models/model_bs_roformer_ep_317_sdr_12.9755.yaml` and found `num_stems: 1` and `instruments: [Vocals, Instrumental]`
     - Fix: Changed to `htdemucs_ft.yaml` (4-stem model)

5. **Problem Solving**:

   - **Achieved**:
     - Clean architecture with profile-based configuration
     - Duplicate prevention via content hashing
     - Opus compression working via audio-separator's pydub integration
     - Toast notifications instead of alerts
     - Backend connection splash screen
     - Responsive system during processing (PyTorch thread limiting)
     - Soundfile confirmed to support Opus reading (tested with test_opus.py)

   - **Ongoing**:
     - Need to test new 4-stem BS-RoFormer viperx model
     - Verify all 4 stems (vocals, drums, bass, other) are being output correctly
     - Confirm Opus encoding works with 4-stem model
