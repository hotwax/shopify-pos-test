import type { OmsCustomer, OmsPosOrder, SavedOmsConnection, DeviceProfile, OmsConnectionSummary, OmsLocation, OmsOrder, OmsOrderDetail, OmsOrderRecord, OmsShop, OmsShopifyOrderDetail, OmsVariant, RunRecord, RunRequest, SavedPosPin, ScriptDefinition, SetupCheck, SetupDefaults } from '../shared/contracts.ts';

let sessionToken: string | null = null;
let sessionHandshake: Promise<unknown> | null = null;

// The local session token only exists after /api/health. Any call that races
// ahead of it would be rejected with a 401, so the handshake is awaited here
// once rather than left to the order page mounts happen to run in.
async function ensureSession(path: string): Promise<void> {
  if (sessionToken || path === '/api/health') return;
  sessionHandshake ??= getHealth().finally(() => { sessionHandshake = null; });
  await sessionHandshake.catch(() => undefined);
}

async function send(path: string, init: RequestInit): Promise<Response> {
  const headers = new Headers(init.headers);
  if (sessionToken) headers.set('X-Local-Session', sessionToken);
  return fetch(path, { ...init, headers });
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  await ensureSession(path);
  let response = await send(path, init);
  // The sidecar issues a new session token when it restarts, which leaves this
  // tab holding one the host no longer accepts. Re-handshake once and retry so
  // a restart does not silently break every call until a hard reload.
  if (response.status === 401 && path !== '/api/health') {
    sessionToken = '';
    await ensureSession(path);
    if (sessionToken) response = await send(path, init);
  }
  const body = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `Local host request failed (${response.status}).`);
  return body;
}

// The session token only travels as a header (see `send` above), so a plain
// <img src="..."> can never authenticate against the artifact routes. Callers
// fetch the bytes through this helper and hand the resulting blob URL to an
// <img>, the same way `request` fetches and retries JSON bodies.
async function requestBlob(path: string): Promise<Blob> {
  await ensureSession(path);
  let response = await send(path, {});
  if (response.status === 401) {
    sessionToken = '';
    await ensureSession(path);
    if (sessionToken) response = await send(path, {});
  }
  if (!response.ok) throw new Error(`Local host request failed (${response.status}).`);
  return response.blob();
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

export async function getHostChecks(): Promise<{ checks: SetupCheck[] }> {
  if (!sessionToken) await getHealth();
  return request('/api/setup/host');
}

export async function checkTunnel(): Promise<{ ok: boolean; running: boolean }> {
  if (!sessionToken) await getHealth();
  return request('/api/setup/tunnel');
}

export async function getSetupDefaults(): Promise<SetupDefaults> {
  if (!sessionToken) await getHealth();
  return request('/api/setup/defaults');
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

export async function getPosPin(udid: string): Promise<{ saved: SavedPosPin | null }> {
  if (!sessionToken) await getHealth();
  return request(`/api/setup/pos-pin?udid=${encodeURIComponent(udid)}`);
}

export async function savePosPin(udid: string, pin: string): Promise<{ saved: SavedPosPin }> {
  if (!sessionToken) await getHealth();
  return request('/api/setup/pos-pin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ udid, pin }) });
}

export async function forgetPosPin(udid: string): Promise<{ removed: boolean }> {
  if (!sessionToken) await getHealth();
  return request('/api/setup/pos-pin/forget', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ udid }) });
}

export async function listRuns(): Promise<{ runs: RunRecord[] }> {
  if (!sessionToken) await getHealth();
  return request('/api/runs');
}

export interface RunProgressEntry { at: string; message: string; logOffset?: number; detail?: Record<string, unknown> }

export async function getRunLogs(id: string, from: number, to?: number): Promise<{ lines: string[]; truncated: boolean }> {
  const query = new URLSearchParams({ from: String(from), ...(to ? { to: String(to) } : {}) });
  return request(`/api/runs/${encodeURIComponent(id)}/logs?${query.toString()}`);
}

export async function getRunProgress(id: string): Promise<{ entries: RunProgressEntry[] }> {
  return request(`/api/runs/${encodeURIComponent(id)}/progress`);
}

export interface RunArtifact { name: string; kind: 'screenshot' | 'file'; size: number; modifiedAt: string }

export async function listRunArtifacts(id: string): Promise<{ artifacts: RunArtifact[] }> {
  return request(`/api/runs/${encodeURIComponent(id)}/artifacts`);
}

// Builds the path for a single artifact. It is not a fetch-ready session and
// cannot be used directly as an <img src> (see `requestBlob` above) — pass it
// through `getRunArtifactBlob` instead, which authenticates the request.
export function artifactUrl(id: string, name: string): string {
  return `/api/runs/${encodeURIComponent(id)}/artifacts/${encodeURIComponent(name)}`;
}

export async function getRunArtifactBlob(id: string, name: string): Promise<Blob> {
  if (!sessionToken) await getHealth();
  return requestBlob(artifactUrl(id, name));
}

export async function getRun(id: string): Promise<RunRecord> {
  if (!sessionToken) await getHealth();
  return request(`/api/runs/${encodeURIComponent(id)}`);
}

export async function startRun(requestBody: Pick<RunRequest, 'scriptId' | 'deviceProfileId' | 'parameters' | 'assertionMode' | 'expectedRevision'> & Partial<Pick<RunRequest, 'context'>>): Promise<RunRecord> {
  if (!sessionToken) await getHealth();
  return request('/api/runs/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(requestBody) });
}

export async function requestStop(id: string): Promise<void> {
  if (!sessionToken) await getHealth();
  await request(`/api/runs/${encodeURIComponent(id)}/stop`, { method: 'POST' });
}

export async function getOmsConnections(): Promise<{ connections: OmsConnectionSummary[] }> {
  if (!sessionToken) await getHealth();
  return request('/api/oms/connections');
}

export async function addOmsConnection(instanceName: string): Promise<{ connection: OmsConnectionSummary }> {
  if (!sessionToken) await getHealth();
  return request('/api/oms/connections', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ instanceName }) });
}

export async function getOmsHealth(connectionId: string): Promise<{ connection: OmsConnectionSummary }> {
  if (!sessionToken) await getHealth();
  return request(`/api/oms/health?connectionId=${encodeURIComponent(connectionId)}`);
}

export async function getSavedOmsConnections(): Promise<{ saved: SavedOmsConnection[] }> {
  return request('/api/oms/saved');
}

export async function saveOmsConnection(body: { instanceName: string; username: string; password: string; autoConnect?: boolean }): Promise<{ saved: SavedOmsConnection }> {
  return request('/api/oms/saved', { method: 'POST', body: JSON.stringify(body) });
}

export async function forgetOmsConnection(id: string): Promise<{ removed: boolean }> {
  return request('/api/oms/saved/forget', { method: 'POST', body: JSON.stringify({ id }) });
}

export async function connectSavedOmsConnection(id: string): Promise<{ connection: OmsConnectionSummary }> {
  return request('/api/oms/saved/connect', { method: 'POST', body: JSON.stringify({ id }) });
}

export async function loginOms(connectionId: string, username: string, password: string): Promise<{ connection: OmsConnectionSummary }> {
  if (!sessionToken) await getHealth();
  return request('/api/oms/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ connectionId, username, password }) });
}

export async function logoutOms(connectionId: string): Promise<void> {
  if (!sessionToken) await getHealth();
  await request('/api/oms/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ connectionId }) });
}

export async function getOmsShops(connectionId: string): Promise<{ shops: OmsShop[] }> {
  if (!sessionToken) await getHealth();
  return request(`/api/oms/shops?connectionId=${encodeURIComponent(connectionId)}`);
}

interface ShopReadRequest { connectionId: string; shopId: string; search?: string; cursor?: string; locationGid?: string }

export async function searchOmsVariants(body: ShopReadRequest): Promise<{ items: OmsVariant[]; nextCursor: string | null }> {
  if (!sessionToken) await getHealth();
  return request('/api/oms/variants/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

export async function listOmsPosOrders(body: ShopReadRequest): Promise<{ items: OmsPosOrder[]; nextCursor: string | null }> {
  return request('/api/oms/orders/pos-recent', { method: 'POST', body: JSON.stringify(body) });
}

export async function searchOmsCustomers(body: ShopReadRequest): Promise<{ items: OmsCustomer[]; nextCursor: string | null }> {
  return request('/api/oms/customers/search', { method: 'POST', body: JSON.stringify(body) });
}

export async function searchOmsOrders(body: ShopReadRequest): Promise<{ items: OmsOrder[]; nextCursor: string | null }> {
  if (!sessionToken) await getHealth();
  return request('/api/oms/orders/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

export async function getOmsShopifyOrderDetail(body: { connectionId: string; shopId: string; gid: string; cursor?: string }): Promise<{ order: OmsShopifyOrderDetail }> {
  if (!sessionToken) await getHealth();
  return request('/api/oms/orders/shopify-detail', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

export async function searchOmsOrderRecords(body: { connectionId: string; search?: string; cursor?: string }): Promise<{ items: OmsOrderRecord[]; nextCursor: string | null }> {
  if (!sessionToken) await getHealth();
  return request('/api/oms/orders/records', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

export async function getOmsOrderDetail(connectionId: string, orderId: string): Promise<{ order: OmsOrderDetail }> {
  if (!sessionToken) await getHealth();
  return request('/api/oms/orders/detail', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ connectionId, orderId }) });
}

export async function listOmsLocations(body: ShopReadRequest): Promise<{ items: OmsLocation[]; nextCursor: string | null }> {
  if (!sessionToken) await getHealth();
  return request('/api/oms/locations/list', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}
