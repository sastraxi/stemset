/**
 * Type-safe localStorage wrapper for Stemset.
 *
 * All keys use the `stemset.*` prefix with version suffixes for safe migration.
 */

// Master effect settings (global across all recordings)
export interface MasterEqSettings {
  id: string;
  frequency: number;
  type: BiquadFilterType;
  gain: number;
  q: number;
}

export interface MasterLimiterSettings {
  thresholdDb: number;
  release: number;
  enabled: boolean;
}

// Session state (UI state that persists across page reloads)
export interface PendingJob {
  job_id: string;
  profile_name: string;
  output_name: string;
  filename: string;
  timestamp: number;
}

// Per-recording playback state
export interface RecordingState {
  playbackPosition: number; // seconds
  stemGains: Record<string, number>; // linear gain values
  stemMutes: Record<string, boolean>; // mute states
}

export type RecordingsMap = Record<string, RecordingState>; // key: `${profile}::${fileName}`

// Storage keys with versioning
const KEYS = {
  // Global master effects
  MASTER_EQ: 'stemset.master.eq.v1',
  MASTER_LIMITER: 'stemset.master.limiter.v2',
  MASTER_EQ_ENABLED: 'stemset.master.eq.enabled.v1',

  // Session state
  SESSION_PROFILE: 'stemset.session.profile.v1',
  SESSION_PENDING_JOBS: 'stemset.session.pendingJobs.v1',

  // Per-recording state
  RECORDINGS: 'stemset.recordings.v1',
} as const;

/**
 * Generic localStorage getter with JSON parsing and error handling.
 */
function getItem<T>(key: string, defaultValue: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return defaultValue;
    return JSON.parse(raw) as T;
  } catch (error) {
    console.warn(`[storage] Failed to parse ${key}, using default:`, error);
    return defaultValue;
  }
}

/**
 * Generic localStorage setter with JSON serialization and error handling.
 */
function setItem<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.error(`[storage] Failed to save ${key}:`, error);
  }
}

/**
 * Remove a key from localStorage.
 */
// Unused but kept for future use
// function removeItem(key: string): void {
//   try {
//     localStorage.removeItem(key);
//   } catch (error) {
//     console.error(`[storage] Failed to remove ${key}:`, error);
//   }
// }

// ============================================================================
// Master Effects (global settings)
// ============================================================================

export function getMasterEq(defaultValue: MasterEqSettings[]): MasterEqSettings[] {
  return getItem(KEYS.MASTER_EQ, defaultValue);
}

export function setMasterEq(value: MasterEqSettings[]): void {
  setItem(KEYS.MASTER_EQ, value);
}

export function getMasterLimiter(defaultValue: MasterLimiterSettings): MasterLimiterSettings {
  return getItem(KEYS.MASTER_LIMITER, defaultValue);
}

export function setMasterLimiter(value: MasterLimiterSettings): void {
  setItem(KEYS.MASTER_LIMITER, value);
}

export function getMasterEqEnabled(defaultValue: boolean): boolean {
  return getItem(KEYS.MASTER_EQ_ENABLED, defaultValue);
}

export function setMasterEqEnabled(value: boolean): void {
  setItem(KEYS.MASTER_EQ_ENABLED, value);
}

// ============================================================================
// Session State
// ============================================================================

export function getSessionProfile(): string | null {
  return getItem<string | null>(KEYS.SESSION_PROFILE, null);
}

export function setSessionProfile(profileName: string): void {
  setItem(KEYS.SESSION_PROFILE, profileName);
}

export function getPendingJobs(): PendingJob[] {
  return getItem<PendingJob[]>(KEYS.SESSION_PENDING_JOBS, []);
}

export function setPendingJobs(jobs: PendingJob[]): void {
  setItem(KEYS.SESSION_PENDING_JOBS, jobs);
}

export function removePendingJob(jobId: string): void {
  const jobs = getPendingJobs();
  const filtered = jobs.filter(job => job.job_id !== jobId);
  setPendingJobs(filtered);
}

export function pruneStalePendingJobs(maxAgeMs: number = 7 * 24 * 60 * 60 * 1000): void {
  const jobs = getPendingJobs();
  const now = Date.now();
  const fresh = jobs.filter(job => now - job.timestamp < maxAgeMs);
  if (fresh.length !== jobs.length) {
    setPendingJobs(fresh);
    console.log(`[storage] Pruned ${jobs.length - fresh.length} stale pending jobs`);
  }
}

// ============================================================================
// Per-Recording State
// ============================================================================

/**
 * Generate a unique key for a recording.
 */
export function getRecordingKey(profileName: string, fileName: string): string {
  return `${profileName}::${fileName}`;
}

/**
 * Get all recording states.
 */
export function getAllRecordings(): RecordingsMap {
  return getItem<RecordingsMap>(KEYS.RECORDINGS, {});
}

/**
 * Get state for a specific recording.
 */
export function getRecordingState(profileName: string, fileName: string): RecordingState | null {
  const all = getAllRecordings();
  const key = getRecordingKey(profileName, fileName);
  return all[key] || null;
}

/**
 * Save state for a specific recording.
 */
export function setRecordingState(profileName: string, fileName: string, state: RecordingState): void {
  const all = getAllRecordings();
  const key = getRecordingKey(profileName, fileName);
  all[key] = state;
  setItem(KEYS.RECORDINGS, all);
}

/**
 * Update a subset of recording state (partial update).
 */
export function updateRecordingState(
  profileName: string,
  fileName: string,
  updates: Partial<RecordingState>
): void {
  const existing = getRecordingState(profileName, fileName) || {
    playbackPosition: 0,
    stemGains: {},
    stemMutes: {},
  };
  setRecordingState(profileName, fileName, { ...existing, ...updates });
}

/**
 * Remove state for a specific recording.
 */
export function removeRecordingState(profileName: string, fileName: string): void {
  const all = getAllRecordings();
  const key = getRecordingKey(profileName, fileName);
  delete all[key];
  setItem(KEYS.RECORDINGS, all);
}

/**
 * Remove all recording states for a profile (useful when profile is deleted).
 */
export function removeProfileRecordings(profileName: string): void {
  const all = getAllRecordings();
  const filtered = Object.fromEntries(
    Object.entries(all).filter(([key]) => !key.startsWith(`${profileName}::`))
  );
  setItem(KEYS.RECORDINGS, filtered);
}

/**
 * Clean up recording states that don't match the current file list.
 */
export function pruneStaleRecordings(profileName: string, validFileNames: string[]): void {
  const all = getAllRecordings();
  const validKeys = new Set(validFileNames.map(name => getRecordingKey(profileName, name)));
  const profilePrefix = `${profileName}::`;

  let pruned = 0;
  const filtered = Object.fromEntries(
    Object.entries(all).filter(([key]) => {
      // Keep all non-profile entries + valid profile entries
      if (!key.startsWith(profilePrefix)) return true;
      const keep = validKeys.has(key);
      if (!keep) pruned++;
      return keep;
    })
  );

  if (pruned > 0) {
    setItem(KEYS.RECORDINGS, filtered);
    console.log(`[storage] Pruned ${pruned} stale recordings for profile ${profileName}`);
  }
}
