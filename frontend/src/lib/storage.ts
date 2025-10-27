/**
 * Type-safe localStorage wrapper for Stemset.
 *
 * All keys use the `stemset.*` prefix with version suffixes for safe migration.
 */

// Session state (UI state that persists across page reloads)
export interface PendingJob {
  job_id: string;
  profile_name: string;
  output_name: string;
  filename: string;
  timestamp: number;
}

import type { RecordingUserConfig } from '../types';

export type RecordingsMap = Record<string, RecordingUserConfig>; // key: `${profile}::${fileName}`

// Storage keys with versioning
const KEYS = {
  // Session state
  SESSION_PROFILE: 'stemset.session.profile.v1',
  SESSION_RECORDING: 'stemset.session.recording.v1',
  SESSION_PENDING_JOBS: 'stemset.session.pendingJobs.v1',

  // Per-recording state (v2 includes effects config)
  RECORDINGS: 'stemset.recordings.v2',
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
// Session State
// ============================================================================

export function getSessionProfile(): string | null {
  return getItem<string | null>(KEYS.SESSION_PROFILE, null);
}

export function setSessionProfile(profileName: string): void {
  setItem(KEYS.SESSION_PROFILE, profileName);
}

export function getSessionRecording(profileName?: string): string | null {
  if (profileName) {
    // Get profile-specific recording
    const key = `${KEYS.SESSION_RECORDING}.${profileName}`;
    return getItem<string | null>(key, null);
  }
  // Fallback to global recording for backward compatibility
  return getItem<string | null>(KEYS.SESSION_RECORDING, null);
}

export function setSessionRecording(recordingName: string, profileName?: string): void {
  if (profileName) {
    // Store profile-specific recording
    const key = `${KEYS.SESSION_RECORDING}.${profileName}`;
    setItem(key, recordingName);
  }
  // Also store as global for backward compatibility
  setItem(KEYS.SESSION_RECORDING, recordingName);
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
export function getRecordingState(profileName: string, fileName: string): RecordingUserConfig | null {
  const all = getAllRecordings();
  const key = getRecordingKey(profileName, fileName);
  return all[key] || null;
}

/**
 * Save state for a specific recording.
 */
export function setRecordingState(profileName: string, fileName: string, state: RecordingUserConfig): void {
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
  updates: Partial<RecordingUserConfig>
): void {
  const existing = getRecordingState(profileName, fileName);
  if (!existing) {
    // Create minimal default config to merge with updates
    const defaultConfig: RecordingUserConfig = {
      playbackPosition: 0,
      stems: {},
      effects: updates.effects || {
        eq: { bands: [], enabled: true },
        compressor: { threshold: -6, attack: 0.005, release: 0.1, bodyBlend: 0, airBlend: 0.1, enabled: true },
        reverb: { mix: 0.3, decay: 0.6, satAmount: 1.5, enabled: false },
        stereoExpander: { lowMidCrossover: 300, midHighCrossover: 3000, expLow: 1, compLow: 0.2, expMid: 1.2, compMid: 0.3, expHigh: 1.6, compHigh: 0.1, enabled: false },
      },
    };
    setRecordingState(profileName, fileName, { ...defaultConfig, ...updates });
  } else {
    setRecordingState(profileName, fileName, { ...existing, ...updates });
  }
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
