import type { Profile, StemFile } from './types';

// Use environment variable for API URL in production, fallback to empty for local dev (proxy handles it)
const API_BASE = import.meta.env.VITE_API_URL || '';

const TOKEN_KEY = 'stemset_token';

// Helper to get auth headers with JWT token
function getAuthHeaders(): HeadersInit {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) {
    return {
      'Authorization': `Bearer ${token}`,
    };
  }
  return {};
}

// Helper for authenticated fetch
async function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const headers = {
    ...getAuthHeaders(),
    ...options.headers,
  };
  return fetch(url, { ...options, headers });
}

export async function getProfiles(): Promise<Profile[]> {
  const response = await authFetch(`${API_BASE}/api/profiles`);
  if (!response.ok) {
    throw new Error(`Failed to fetch profiles: ${response.statusText}`);
  }
  return response.json();
}

export async function getProfile(name: string): Promise<Profile> {
  const response = await authFetch(`${API_BASE}/api/profiles/${name}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch profile: ${response.statusText}`);
  }
  return response.json();
}

export async function getProfileFiles(name: string): Promise<StemFile[]> {
  const response = await authFetch(`${API_BASE}/api/profiles/${name}/files`);
  if (!response.ok) {
    throw new Error(`Failed to fetch files: ${response.statusText}`);
  }
  return response.json();
}

export async function getRecording(recordingId: string): Promise<StemFile> {
  const response = await authFetch(`${API_BASE}/api/recordings/${recordingId}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch recording: ${response.statusText}`);
  }
  return response.json();
}

export async function updateDisplayName(
  profileName: string,
  fileName: string,
  displayName: string
): Promise<Record<string, any>> {
  const response = await authFetch(
    `${API_BASE}/api/profiles/${profileName}/files/${fileName}/display-name`,
    {
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
