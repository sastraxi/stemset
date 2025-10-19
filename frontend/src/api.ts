import type { Profile, StemFile, Job, QueueStatus } from './types';

const API_BASE = '/api';

export async function getProfiles(): Promise<Profile[]> {
  const response = await fetch(`${API_BASE}/profiles`);
  return response.json();
}

export async function getProfile(name: string): Promise<Profile> {
  const response = await fetch(`${API_BASE}/profiles/${name}`);
  return response.json();
}

export async function getProfileFiles(name: string): Promise<{ files: StemFile[] }> {
  const response = await fetch(`${API_BASE}/profiles/${name}/files`);
  return response.json();
}

export async function scanProfile(name: string): Promise<{ scanned: number; jobs: Job[] }> {
  const response = await fetch(`${API_BASE}/profiles/${name}/scan`, {
    method: 'POST',
  });
  return response.json();
}

export async function getQueueStatus(): Promise<QueueStatus> {
  const response = await fetch(`${API_BASE}/queue`);
  return response.json();
}

export async function getJobs(profile?: string): Promise<{ jobs: Job[] }> {
  const url = profile ? `${API_BASE}/jobs?profile=${profile}` : `${API_BASE}/jobs`;
  const response = await fetch(url);
  return response.json();
}
