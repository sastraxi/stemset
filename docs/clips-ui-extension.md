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
- **Song metadata on Clips only** - Only `song_id` differs between clips of the same recording. Location and date_recorded live on Recording.
- **Stems belong to Recordings** - Clips are just time windows over existing stems
- **Config shared via Recording** - All clips from the same recording share user config (EQ, effects, etc.) via `recording_id`

## Implementation Status

### ✅ Phase 1-3: Core Playback (Complete)

**Backend:**
- Clip API endpoints: `GET`/`POST`/`PATCH`/`DELETE` `/api/clips/{id}`, `/api/recordings/{id}/clips`
- All endpoints registered in `src/api/app.py`
- TypeScript types auto-generated via `@hey-api/openapi-ts`

**Frontend:**
- `usePlaybackController` now accepts optional `startTimeSec`/`endTimeSec` bounds
- Playback stops at clip end, seeks constrained to bounds, stop/reset returns to clip start
- `RecordingPlayer` - wrapper for full recording playback (no bounds)
- `ClipPlayer` - wrapper with time bounds
- Route: `/p/:profileName/clips/:clipId` → `ClipPage` component
- Clips sidebar in `AuthenticatedApp` (shows list, links to clip player)

## Next Steps

### Phase 4: Clip Creation UI

Add interactive clip creation to the recording player:

#### 4.1 Range Selection Component

Create a visual range selector overlay on the player:

**Components needed:**
1. **RangeSelector** - Transparent overlay on waveform + ruler
   - Two draggable handles (start/end markers)
   - Semi-transparent highlight between markers
   - Ruler shows marker positions with labels
   - Waveform shows dimmed regions outside selection

2. **Keyboard shortcuts:**
   - `I` - Set in point (start marker)
   - `O` - Set out point (end marker)
   - `X` - Clear selection
   - Space - Play/pause within selection

**Implementation approach:**
```typescript
// Add to StemPlayer or create new wrapper
interface RangeSelection {
  startSec: number | null;
  endSec: number | null;
}

function useRangeSelection(duration: number) {
  const [selection, setSelection] = useState<RangeSelection>({
    startSec: null,
    endSec: null
  });

  const selectRange = (start: number, end: number) => {
    setSelection({
      startSec: Math.max(0, start),
      endSec: Math.min(duration, end)
    });
  };

  const clearSelection = () => setSelection({ startSec: null, endSec: null });

  return { selection, selectRange, clearSelection };
}
```

**Visual design:**
- Highlight color: `rgba(59, 130, 246, 0.2)` (blue, 20% opacity)
- Marker handles: Blue circles with white borders, show time labels on hover
- Outside selection: Apply `opacity: 0.4` to waveforms and ruler ticks

#### 4.2 Create Clip Modal

When user has a selection, show a "Create Clip" button above the player. Clicking opens a modal:

```typescript
interface CreateClipModalProps {
  startSec: number;
  endSec: number;
  recordingId: string;
  onClose: () => void;
  onCreated: (clipId: string) => void;
}

function CreateClipModal({ startSec, endSec, recordingId, onClose, onCreated }: CreateClipModalProps) {
  const [displayName, setDisplayName] = useState("");
  const duration = endSec - startSec;

  const handleCreate = async () => {
    const response = await apiRecordingsRecordingIdClipsCreateClipEndpoint({
      path: { recording_id: recordingId },
      body: {
        recording_id: recordingId,
        start_time_sec: startSec,
        end_time_sec: endSec,
        display_name: displayName || null,
      },
    });

    // Invalidate clips query to refresh sidebar
    queryClient.invalidateQueries(['recording-clips', recordingId]);

    onCreated(response.data.id);
    onClose();
  };

  return (
    <Modal>
      <h2>Create Clip</h2>
      <p>Duration: {formatTime(duration)}</p>
      <p>Range: {formatTime(startSec)} → {formatTime(endSec)}</p>
      <input
        placeholder="Clip name (optional)"
        value={displayName}
        onChange={(e) => setDisplayName(e.target.value)}
      />
      <Button onClick={handleCreate}>Create Clip</Button>
      <Button onClick={onClose}>Cancel</Button>
    </Modal>
  );
}
```

**UX Flow:**
1. User plays recording, finds interesting section
2. User drags to select range or uses `I`/`O` keys
3. "Create Clip" button appears (sticky, above player)
4. Click button → Modal opens with range details
5. User enters optional name → Click "Create"
6. Clip appears in sidebar, user can click to navigate to clip player

### Phase 5: Enhanced Clip Management

#### 5.1 Clip Operations

Add actions to clips sidebar:
- **Rename** - Edit `display_name` via `PATCH /api/clips/{id}`
- **Delete** - Remove clip via `DELETE /api/clips/{id}` (does not delete recording)
- **Duplicate** - Create new clip with same bounds

#### 5.2 Song-Based Clip View

Create dedicated view for browsing all clips of a song:

**Route:** `/p/:profileName/songs/:songId/clips`

**Component:**
```typescript
function SongClipsView() {
  const { songId } = useParams();
  const { data: clips } = useQuery({
    queryKey: ['song-clips', songId],
    queryFn: () => apiSongsSongIdClipsGetSongClips({
      path: { song_id: songId }
    })
  });

  return (
    <div>
      <SongHeader songId={songId} />
      <ClipsList
        clips={clips?.data || []}
        showRecordingInfo={true}  // Different recordings for same song
      />
    </div>
  );
}
```

### Phase 6: Smart Clip Detection

Implement automatic clip boundary detection in the worker:

#### Algorithm: Silence-Based Segmentation

**Goal:** Detect natural breaks between songs/sections based on stem activity.

**Approach:**

1. **Activity Detection Per Stem**
   - For each stem, compute RMS energy in sliding windows (e.g., 100ms)
   - Threshold to binary active/inactive (e.g., -40 dB LUFS)
   - Apply morphological dilation (expand active regions by ~0.5s) to bridge brief pauses
   - Output: Run-length encoded activity ranges per stem

2. **Find Activity Islands**
   - Compute intersection: regions where ALL stems are active simultaneously
   - These are candidate clip centers (high confidence regions)

3. **Grow to Boundaries**
   - For each island, iteratively expand start/end until reaching silence:
     - Check if any stem has activity overlapping the boundary
     - If yes, extend boundary to include that activity
     - Repeat until no more expansion occurs
   - Result: Clip boundaries that capture complete musical phrases

**Implementation location:** `src/processor/worker.py`

**Numpy pseudocode:**
```python
def detect_clip_boundaries(stems: dict[str, np.ndarray], sample_rate: int) -> list[ClipBoundary]:
    # 1. Compute activity for each stem
    activities = {}
    for name, audio in stems.items():
        rms = librosa.feature.rms(y=audio, frame_length=frame_length)[0]
        rms_db = librosa.amplitude_to_db(rms, ref=np.max)
        active = rms_db > threshold_db

        # Dilate to bridge short gaps
        active = scipy.ndimage.binary_dilation(active, iterations=dilation_frames)

        # Convert to sample ranges
        activities[name] = active_to_ranges(active, hop_length)

    # 2. Find islands where all stems active
    all_active = intersect_all_ranges(activities.values())

    # 3. Grow each island to natural boundaries
    boundaries = []
    for island in all_active:
        start, end = island
        changed = True
        while changed:
            changed = False
            for ranges in activities.values():
                for r_start, r_end in ranges:
                    if overlaps(r_start, r_end, start, end):
                        new_start = min(start, r_start)
                        new_end = max(end, r_end)
                        if new_start != start or new_end != end:
                            start, end = new_start, new_end
                            changed = True

        boundaries.append(ClipBoundary(
            start_time_sec=start / sample_rate,
            end_time_sec=end / sample_rate
        ))

    return boundaries if boundaries else [full_length_clip]
```

**Integration:**
- Worker reports boundaries in `ProcessingCallbackPayload.clip_boundaries`
- Upload route `recording_complete()` creates clips from boundaries
- Frontend automatically shows detected clips in sidebar

### Phase 7: Advanced Features (Future)

#### 7.1 Clip Preview in Sidebar
- Hover over clip → mini waveform preview
- Click to jump to that time in recording player (before navigating)

#### 7.2 Clip Export
- Export individual clip as standalone audio file (mix stems to stereo)
- Useful for sharing specific sections

#### 7.3 Clip Annotations
- Add text notes/timestamps within clips
- Useful for rehearsal notes, song structure markers

#### 7.4 Clip Playlists
- Create ordered sequences of clips
- Playback transitions smoothly between clips
- Useful for setlists, medleys

## Configuration & Persistence

All clips from the same recording share user configuration:
- **Playback position** - Each clip tracks its own position within its bounds
- **Stem volumes, mute, solo** - Shared via `RecordingUserConfig(recording_id, "stems")`
- **Effects (EQ, compressor, reverb)** - Shared via recording-scoped config keys

This means adjusting EQ in a clip affects all clips from that recording. This is intentional—if you want different mixing for different sections, create separate recordings.

## Testing Checklist

**Core functionality:**
- [x] RecordingPlayer works unchanged (full-length playback)
- [x] ClipPlayer respects time bounds (no seeking outside range)
- [x] Clips sidebar shows in recording view
- [x] Clicking clip navigates to `/p/:profile/clips/:clipId`
- [x] Clip URL routing works

**Clip creation (Phase 4):**
- [ ] Can select time range in player
- [ ] Create clip modal appears with correct bounds
- [ ] Created clip appears in sidebar immediately
- [ ] Clip playback constrained to selected range

**Advanced (Phase 5+):**
- [ ] Can rename clips via sidebar
- [ ] Can delete clips (recording remains)
- [ ] Song-based clip view shows clips across recordings
- [ ] Worker auto-detects clip boundaries
- [ ] Detected boundaries create clips automatically

## File Reference

**New files created:**
- `frontend/src/components/RecordingPlayer.tsx` - Full recording wrapper
- `frontend/src/components/ClipPlayer.tsx` - Time-bounded wrapper
- `frontend/src/components/ClipPage.tsx` - Clip view page
- `frontend/src/routes/p/$profileName/clips/$clipId.tsx` - Clip route

**Modified files:**
- `frontend/src/hooks/usePlaybackController.ts` - Added time bounds support
- `frontend/src/hooks/useStemPlayer.ts` - Pass through time bounds
- `frontend/src/components/StemPlayer.tsx` - Accept time bounds props
- `frontend/src/components/AuthenticatedApp.tsx` - Added clips sidebar, use RecordingPlayer
- `src/api/app.py` - Register clip endpoints

**Backend (already complete):**
- `src/api/profile_routes.py` - Clip CRUD endpoints
- `src/api/models.py` - Clip API models
- `src/db/models.py` - Clip database model
- `src/db/operations.py` - Clip database operations
