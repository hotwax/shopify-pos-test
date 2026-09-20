import type { ScriptDefinition } from '../shared/contracts.ts';

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

export async function getHealth(): Promise<{ ok: boolean; mode: string }> {
  const response = await request<{ ok: boolean; mode: string; sessionToken: string }>('/api/health');
  sessionToken = response.sessionToken;
  return response;
}

export async function getCatalog(): Promise<CatalogResponse> {
  if (!sessionToken) await getHealth();
  return request<CatalogResponse>('/api/catalog');
}
