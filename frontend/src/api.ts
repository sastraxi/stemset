import type { Profile, StemFile } from './types';

// Use environment variable for API URL in production, fallback to empty for local dev (proxy handles it)
const API_BASE = import.meta.env.VITE_API_URL || '';

// Default fetch options to include credentials (cookies)
const defaultOptions: RequestInit = {
  credentials: 'include',
};

export async function getProfiles(): Promise<Profile[]> {
  const response = await fetch(`${API_BASE}/api/profiles`, defaultOptions);
  if (!response.ok) {
    throw new Error(`Failed to fetch profiles: ${response.statusText}`);
  }
  return response.json();
}

export async function getProfile(name: string): Promise<Profile> {
  const response = await fetch(`${API_BASE}/api/profiles/${name}`, defaultOptions);
  if (!response.ok) {
    throw new Error(`Failed to fetch profile: ${response.statusText}`);
  }
  return response.json();
}

export async function getProfileFiles(name: string): Promise<StemFile[]> {
  const response = await fetch(`${API_BASE}/api/profiles/${name}/files`, defaultOptions);
  if (!response.ok) {
    throw new Error(`Failed to fetch files: ${response.statusText}`);
  }
  return response.json();
}

export async function getFileMetadata(metadataUrl: string, bustCache = false): Promise<Record<string, any>> {
  // Add cache-busting parameter if needed (e.g., after updates)
  // Only bust cache for metadata.json since it can change
  const url = bustCache ? `${metadataUrl}?t=${Date.now()}` : metadataUrl;

  const response = await fetch(url, {
    // Only disable cache when explicitly busting - otherwise let browser cache normally
    ...(bustCache ? { cache: 'no-store' as RequestCache } : {}),
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch metadata: ${response.statusText}`);
  }
  return response.json();
}

export async function updateDisplayName(
  profileName: string,
  fileName: string,
  displayName: string
): Promise<Record<string, any>> {
  const response = await fetch(
    `${API_BASE}/api/profiles/${profileName}/files/${fileName}/display-name`,
    {
      ...defaultOptions,
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ display_name: displayName }),
    }
  );
  if (!response.ok) {
    throw new Error(`Failed to update display name: ${response.statusText}`);
  }
  return response.json();
}
