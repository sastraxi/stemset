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

export async function getFileMetadata(profileName: string, fileName: string): Promise<Record<string, any>> {
  const response = await fetch(`${API_BASE}/api/profiles/${profileName}/files/${fileName}/metadata`, defaultOptions);
  if (!response.ok) {
    throw new Error(`Failed to fetch metadata: ${response.statusText}`);
  }
  return response.json();
}
