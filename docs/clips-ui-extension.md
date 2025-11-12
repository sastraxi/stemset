# Clips UI Extension Guide

## Overview

A **Clip** represents a timed portion of a Recording, defined by `[start_time_sec ... end_time_sec]`. This allows multiple time slices of the same processed recording without reprocessing.

### Data Model

```
Recording (1) ← (N) Clip
    ↓                ↓
  Stems          Song (optional)
```

**Key design decisions:**
- **N Clips : 1 Recording** - Multiple clips can reference the same recording with different time bounds
- **Song metadata on Clips only** - Only `song_id` differs between clips of the same recording
- **Stems belong to Recordings** - Clips are just time windows over existing stems
- **Config shared via Recording** - All clips from the same recording share user config (EQ, effects, etc.)

---

## ✅ Completed: Phases 1-5

### Phase 1-3: Core Playback & Backend
- Complete clip CRUD API in `src/api/profile_routes.py`
- Time-bounded playback in `usePlaybackController`
- `RecordingPlayer` and `ClipPlayer` components
- Clip routing at `/p/:profileName/clips/:clipId`

### Phase 4: Clip Creation UI
- **RangeSelectionContext** (`frontend/src/contexts/RangeSelectionContext.tsx`)
  - Context-based range selection state management
  - Components opt-in by being wrapped in provider
- **Visual Selection** (Ruler + WaveformVisualization)
  - Components render selection highlights directly (no overlay)
  - Blue highlight on selection, dimmed regions outside
  - Draggable handles on ruler
- **Interaction Logic**
  - Click vs Drag detection (5px threshold)
  - Drag = select range, Click = seek playback
  - Keyboard shortcuts: `I` (in-point), `O` (out-point), `X` (clear)
- **CreateClipModal** (`frontend/src/components/CreateClipModal.tsx`)
  - shadcn/ui Dialog with range preview
  - Creates clip and navigates to clip page

### Phase 5: Enhanced Clip Management
- **ClipsList** (`frontend/src/components/ClipsList.tsx`)
  - Modern Tailwind styling with hover-revealed actions
  - Rename (inline edit), Delete (with confirmation), Duplicate
  - Integrated into AuthenticatedApp sidebar

---

## 🚧 Remaining Work

### Phase 6: Smart Clip Detection (Worker-Side Auto-Detection)

**Goal:** Automatically detect clip boundaries during processing to split recordings containing multiple songs (e.g., live recordings, rehearsals, DJ sets).

#### Implementation Requirements

1. **Backend Models** (`src/api/models.py`)
   - Add `clip_boundaries: list[ClipBoundary] | None = None` to `ProcessingCallbackPayload`
   - Define `ClipBoundary` model:
     ```python
     class ClipBoundary(BaseModel):
         start_time_sec: float
         end_time_sec: float
         confidence: float  # 0.0-1.0, for future filtering
     ```

2. **Worker Detection** (`src/processor/worker.py`)
   - Implement `detect_clip_boundaries(stems: dict[str, np.ndarray], sample_rate: int) -> list[ClipBoundary]`
   - **Algorithm: Silence-Based Segmentation**

     **Step 1: Activity Detection Per Stem**
     - Compute RMS energy in sliding windows (100ms, 50ms hop)
     - Convert to dB LUFS: `librosa.amplitude_to_db(rms, ref=np.max)`
     - Threshold to binary active/inactive (e.g., -40 dB)
     - Apply morphological dilation to bridge brief pauses (~0.5s)
     - Convert to time ranges: `[(start_sec, end_sec), ...]`

     **Step 2: Find Activity Islands**
     - Compute intersection of all stem activity ranges
     - Result: Regions where ALL stems are active (high-confidence clip centers)

     **Step 3: Grow to Natural Boundaries**
     - For each island, iteratively expand boundaries:
       - Check if ANY stem has activity overlapping current boundary
       - If yes, extend to include that activity
       - Repeat until no further expansion
     - Result: Complete musical phrases without cutting off intros/outros

     **Fallback:**
     - If no boundaries detected, return single full-length clip
     - Prevents breaking single-song recordings

   - **Dependencies needed:**
     ```python
     import librosa
     import scipy.ndimage
     from dataclasses import dataclass
     ```

   - **Integration point:** Call after stem separation, before upload callback
     ```python
     # In process_separation() after separation completes:
     boundaries = detect_clip_boundaries(separated_stems, sample_rate)

     # Include in callback payload
     callback_payload = ProcessingCallbackPayload(
         recording_id=recording_id,
         status="completed",
         clip_boundaries=boundaries,
         # ... other fields
     )
     ```

3. **Upload Route Handler** (`src/api/upload_routes.py`)
   - Modify `recording_complete()` to handle `clip_boundaries` in callback payload
   - If boundaries present, auto-create clips:
     ```python
     if payload.clip_boundaries:
         for i, boundary in enumerate(payload.clip_boundaries):
             db_operations.create_clip(
                 recording_id=recording.id,
                 start_time_sec=boundary.start_time_sec,
                 end_time_sec=boundary.end_time_sec,
                 display_name=f"Section {i+1}" if len(payload.clip_boundaries) > 1 else None
             )
     ```
   - Log creation for debugging
   - Consider: User preference toggle for auto-clip detection?

4. **Frontend Auto-Refresh**
   - Already handled: `ClipsList` refetches on recording change
   - Detected clips will appear in sidebar automatically after upload completes

#### Tuning Parameters (Future)
- `threshold_db`: -40 dB (adjust per use case)
- `dilation_seconds`: 0.5s (bridge brief pauses)
- `min_clip_duration`: 5s (filter out very short sections)
- `max_clip_duration`: None (don't split long songs)

#### Testing Strategy
1. Upload recording with multiple songs separated by silence
2. Verify worker detects boundaries
3. Check callback payload includes boundaries
4. Confirm clips created automatically
5. Test edge cases:
   - Single song (no boundaries) → single clip
   - Very short recording → single clip
   - Recording with talking/noise between songs → multiple clips

---

### Phase 7: Song-Based Clip View

**Goal:** Dedicated view to see all clips for a specific song across multiple recordings.

#### Use Case
- User records "Song X" at multiple rehearsals/performances
- Want to compare different takes/versions
- Current UI only shows clips per-recording

#### Implementation

1. **Route** (`frontend/src/routes/p/$profileName/songs/$songId/clips.tsx`)
   ```tsx
   import { useParams } from "@tanstack/react-router";
   import { useQuery } from "@tanstack/react-query";
   import { apiSongsSongIdClipsGetSongClips } from "@/api/generated";

   export function SongClipsView() {
     const { songId, profileName } = useParams({ strict: false });

     const { data: clips, isLoading } = useQuery({
       queryKey: ['song-clips', songId],
       queryFn: () => apiSongsSongIdClipsGetSongClips({
         path: { song_id: songId }
       })
     });

     return (
       <div className="container mx-auto p-4">
         <SongHeader songId={songId} />
         <h2>All Clips</h2>
         {clips?.data.map(clip => (
           <ClipCard
             key={clip.id}
             clip={clip}
             showRecordingInfo={true}  // Show which recording this clip is from
           />
         ))}
       </div>
     );
   }
   ```

2. **ClipCard Component** (extend ClipsList for card layout)
   - Show clip name, duration, time range
   - **Show recording metadata**: date recorded, location
   - Link to clip player
   - Play button for inline preview?

3. **Navigation**
   - Add link from SongMetadata component
   - Breadcrumb: Profile → Songs → Song X → Clips

#### Backend Already Complete
- `GET /api/songs/{song_id}/clips` exists in `profile_routes.py`
- Returns all clips for a song across all recordings

---

### Phase 8: Advanced Features (Future Enhancements)

#### 8.1 Clip Preview in Sidebar
**Problem:** Clicking a clip navigates away from current recording

**Solution:**
- Hover over clip → Show mini waveform preview tooltip
- Click clip name → Navigate to clip player (current behavior)
- Click play icon → Start playback at clip's start time in current player
  - Requires: RecordingPlayer.seekTo(time) method
  - UX: Smooth transition, visual indicator of current clip

**Implementation:**
- Add `onClipPreview?: (startSec: number) => void` prop to ClipsList
- Wire to RecordingPlayer's seek function
- Generate mini waveform: Use same image, render at small scale

#### 8.2 Clip Export
**Goal:** Export clip as standalone audio file (mixed stems)

**Use Cases:**
- Share specific sections with band members
- Create backing tracks from clips
- Export individual songs from live recording

**Implementation:**
1. **Export Button** in ClipPlayer or ClipsList
2. **Backend Route:** `POST /api/clips/{clip_id}/export`
   - Load stems for clip's recording
   - Trim to clip bounds
   - Mix down to stereo WAV/MP3
   - Return presigned download URL or stream file
3. **Format Options:** WAV (lossless), MP3 (compressed), per-stem ZIP

**Complexity:** Requires stem mixing logic on backend

#### 8.3 Clip Annotations
**Goal:** Add text notes/markers within clips

**Use Cases:**
- Rehearsal notes ("fix timing at 1:23")
- Song structure markers ("verse", "chorus")
- Performance feedback

**Data Model:**
```python
class ClipAnnotation(BaseModel):
    clip_id: str
    time_sec: float  # Relative to clip start
    text: str
    color: str | None = None
```

**UI:**
- Click on waveform to add annotation marker
- Hover to see note text
- Edit/delete annotations

#### 8.4 Clip Playlists
**Goal:** Ordered sequences of clips with continuous playback

**Use Cases:**
- Setlist preparation (rehearse song order)
- Create medleys from clips
- Demo reels from best takes

**Data Model:**
```python
class Playlist(BaseModel):
    id: str
    name: str
    profile_id: str
    clip_ids: list[str]  # Ordered
```

**Playback:**
- Auto-advance to next clip when current ends
- Crossfade option?
- Requires: Queue management in playback controller

---

## Configuration & Persistence

All clips from the same recording share user configuration:
- **Playback position** - Each clip tracks its own position within bounds
- **Stem volumes, mute, solo** - Shared via `RecordingUserConfig(recording_id, "stems")`
- **Effects (EQ, compressor, reverb)** - Shared via recording-scoped config keys

**Implication:** Adjusting EQ in one clip affects all clips from that recording. This is intentional—stems are shared resources. If you want different mixing, create separate recordings.

---

## Testing Checklist

**✅ Core functionality:**
- [x] RecordingPlayer works unchanged (full-length playback)
- [x] ClipPlayer respects time bounds (no seeking outside range)
- [x] Clips sidebar shows in recording view
- [x] Clicking clip navigates to `/p/:profile/clips/:clipId`
- [x] Clip URL routing works

**✅ Clip creation (Phase 4):**
- [x] Can select time range via drag in player
- [x] Can select time range via I/O keyboard shortcuts
- [x] Click vs drag detection works (5px threshold)
- [x] Create clip modal appears with correct bounds
- [x] Created clip appears in sidebar immediately
- [x] Clip playback constrained to selected range

**✅ Clip management (Phase 5):**
- [x] Can rename clips via sidebar (inline edit)
- [x] Can delete clips (recording remains, confirmation dialog)
- [x] Can duplicate clips

**⬜ Advanced (Phase 6+):**
- [ ] Worker auto-detects clip boundaries
- [ ] Detected boundaries create clips automatically
- [ ] Song-based clip view shows clips across recordings
- [ ] Clip preview in sidebar (hover tooltip)
- [ ] Clip export to standalone file

---

## File Reference

**Phase 4-5 Implementation:**
- `frontend/src/contexts/RangeSelectionContext.tsx` - Range selection state management
- `frontend/src/components/CreateClipModal.tsx` - Clip creation dialog
- `frontend/src/components/ClipsList.tsx` - Enhanced clips sidebar with actions
- `frontend/src/components/RecordingPlayer.tsx` - Wrapped with RangeSelectionProvider, keyboard shortcuts
- `frontend/src/components/Ruler.tsx` - Modified: Range selection rendering + drag logic
- `frontend/src/components/WaveformVisualization.tsx` - Modified: Range selection rendering + drag logic

**Backend (Phases 1-3, already complete):**
- `src/api/profile_routes.py` - Clip CRUD endpoints
- `src/api/models.py` - Clip API models
- `src/db/models.py` - Clip database model
- `src/db/operations.py` - Clip database operations

**Phase 6 (TODO):**
- `src/processor/worker.py` - Add `detect_clip_boundaries()` function
- `src/api/upload_routes.py` - Modify `recording_complete()` to create clips from boundaries
- `src/api/models.py` - Add `ClipBoundary` model and update `ProcessingCallbackPayload`
