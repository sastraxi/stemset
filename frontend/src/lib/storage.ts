/**
 * Type-safe localStorage wrapper for Stemset.
 *
 * Minimal session state only:
 * - stemset.token: JWT authentication token
 * - stemset.masterVolume: Global master volume
 * - stemset.profile: Current profile name
 * - stemset.profile.<profileName>.recording: Current recording per profile
 */

// Storage keys
const KEYS = {
  TOKEN: "stemset.token",
  MASTER_VOLUME: "stemset.masterVolume",
  PROFILE: "stemset.profile",
  PROFILE_RECORDING_PREFIX: "stemset.profile.",
  DRIVE_HISTORY_PREFIX: "stemset.drive.history.",
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

// ============================================================================
// Authentication
// ============================================================================

export function getToken(): string | null {
  return getItem<string | null>(KEYS.TOKEN, null);
}

export function setToken(token: string): void {
  setItem(KEYS.TOKEN, token);
}

export function clearToken(): void {
  try {
    localStorage.removeItem(KEYS.TOKEN);
  } catch (error) {
    console.error("[storage] Failed to remove token:", error);
  }
}

// ============================================================================
// Master Volume
// ============================================================================

export function getMasterVolume(): number {
  return getItem<number>(KEYS.MASTER_VOLUME, 1.0);
}

export function setMasterVolume(volume: number): void {
  setItem(KEYS.MASTER_VOLUME, volume);
}

// ============================================================================
// Session State (Profile & Recording)
// ============================================================================

export function getSessionProfile(): string | null {
  return getItem<string | null>(KEYS.PROFILE, null);
}

export function setSessionProfile(profileName: string): void {
  setItem(KEYS.PROFILE, profileName);
}

export function getSessionRecording(profileName: string): string | null {
  const key = `${KEYS.PROFILE_RECORDING_PREFIX}${profileName}.recording`;
  return getItem<string | null>(key, null);
}

export function setSessionRecording(
  profileName: string,
  recordingName: string,
): void {
  const key = `${KEYS.PROFILE_RECORDING_PREFIX}${profileName}.recording`;
  setItem(key, recordingName);
}

export function clearSessionRecording(profileName: string): void {
  const key = `${KEYS.PROFILE_RECORDING_PREFIX}${profileName}.recording`;
  try {
    localStorage.removeItem(key);
  } catch (error) {
    console.error(
      `[storage] Failed to remove recording for ${profileName}:`,
      error,
    );
  }
}

// ============================================================================
// Google Drive Navigation History
// ============================================================================

export interface DriveFolderHistory {
  folderId: string;
  folderName: string;
}

export function getDriveFolderHistory(
  profileName: string,
): DriveFolderHistory[] {
  const key = `${KEYS.DRIVE_HISTORY_PREFIX}${profileName}`;
  return getItem<DriveFolderHistory[]>(key, []);
}

export function setDriveFolderHistory(
  profileName: string,
  history: DriveFolderHistory[],
): void {
  const key = `${KEYS.DRIVE_HISTORY_PREFIX}${profileName}`;
  setItem(key, history);
}

export function clearDriveFolderHistory(profileName: string): void {
  const key = `${KEYS.DRIVE_HISTORY_PREFIX}${profileName}`;
  try {
    localStorage.removeItem(key);
  } catch (error) {
    console.error(
      `[storage] Failed to remove Drive history for ${profileName}:`,
      error,
    );
  }
}
