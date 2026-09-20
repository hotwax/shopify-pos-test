import type { DeviceProfile, RunRecord, ScriptDefinition, SetupCheck } from '../shared/contracts.ts';

let sessionToken: string | null = null;

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (sessionToken) headers.set('X-Local-Session', sessionToken);
  const response = await fetch(path, { ...init, headers });
  const body = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `Local host request failed (${response.status}).`);
  return body;
}

export interface CatalogResponse {
  scripts: ScriptDefinition[];
  errors: string[];
}

export async function getHealth(): Promise<{ ok: boolean; mode: string; revision: string }> {
  const response = await request<{ ok: boolean; mode: string; sessionToken: string; revision: string }>('/api/health');
  sessionToken = response.sessionToken;
  return response;
}

export async function getCatalog(): Promise<CatalogResponse> {
  if (!sessionToken) await getHealth();
  return request<CatalogResponse>('/api/catalog');
}

export async function getSetupDevices(): Promise<{ devices: { udid: string; name: string; model: string; os: string }[]; error?: string }> {
  if (!sessionToken) await getHealth();
  return request('/api/setup/devices');
}

export async function getProfiles(): Promise<{ profiles: DeviceProfile[] }> {
  if (!sessionToken) await getHealth();
  return request('/api/setup/profiles');
}

export async function checkSetup(profile: DeviceProfile): Promise<{ checks: SetupCheck[] }> {
  if (!sessionToken) await getHealth();
  return request('/api/setup/check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(profile) });
}

export async function saveProfile(profile: DeviceProfile): Promise<{ profiles: DeviceProfile[] }> {
  if (!sessionToken) await getHealth();
  return request('/api/setup/profile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(profile) });
}

export async function listRuns(): Promise<{ runs: RunRecord[] }> {
  if (!sessionToken) await getHealth();
  return request('/api/runs');
}

export async function getRun(id: string): Promise<RunRecord> {
  if (!sessionToken) await getHealth();
  return request(`/api/runs/${encodeURIComponent(id)}`);
}

export async function startRun(requestBody: { scriptId: string; deviceProfileId: string; parameters: Record<string, unknown>; assertionMode: string; expectedRevision: string }): Promise<RunRecord> {
  if (!sessionToken) await getHealth();
  return request('/api/runs/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(requestBody) });
}

export async function requestStop(id: string): Promise<void> {
  if (!sessionToken) await getHealth();
  await request(`/api/runs/${encodeURIComponent(id)}/stop`, { method: 'POST' });
}
