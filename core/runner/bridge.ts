import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export interface ObservedOrderBridgeInput {
  observedName: string;
  runMarker?: string;
}

export interface ObservedOrderBridgeRequest {
  id: string;
  runId: string;
  operation: 'resolveObservedOrder';
  observedName: string;
  runMarker?: string;
  requestedAt: string;
}

export interface ObservedOrderBridgeResponse {
  id: string;
  runId: string;
  ok: boolean;
  orderGid?: string;
  orderName?: string;
  error?: string;
  respondedAt: string;
}

function validRunId(runId: string): void {
  if (!/^[a-zA-Z0-9_-]{1,120}$/.test(runId)) throw new Error('Invalid bridge request identity.');
}

function validRequestId(id: string): void {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid bridge request identity.');
}

function runDirectory(root: string, runId: string): string {
  validRunId(runId);
  return join(resolve(root), '.runtime', 'runs', runId, 'bridge');
}

function requestFile(root: string, request: ObservedOrderBridgeRequest): string {
  return join(runDirectory(root, request.runId), `${request.id}.request.json`);
}

function responseFile(root: string, request: ObservedOrderBridgeRequest): string {
  return join(runDirectory(root, request.runId), `${request.id}.response.json`);
}

function validateInput(input: ObservedOrderBridgeInput): void {
  const observedName = input.observedName.trim();
  if (!observedName || observedName.length > 120) throw new Error('The observed POS order reference is empty or too long.');
  if (input.runMarker !== undefined && (input.runMarker.length > 200 || /[\0\r\n]/.test(input.runMarker))) throw new Error('The observed POS run marker is invalid.');
}

async function writeAtomic(file: string, value: unknown): Promise<void> {
  await mkdir(resolve(file, '..'), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporary, JSON.stringify(value), { flag: 'wx' });
  await rename(temporary, file);
}

function parseRequest(value: unknown): ObservedOrderBridgeRequest | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const item = value as Record<string, unknown>;
  if (typeof item.id !== 'string' || typeof item.runId !== 'string' || item.operation !== 'resolveObservedOrder' || typeof item.observedName !== 'string' || typeof item.requestedAt !== 'string') return undefined;
  try { validRequestId(item.id); validRunId(item.runId); validateInput({ observedName: item.observedName, ...(item.runMarker === undefined ? {} : { runMarker: String(item.runMarker) }) }); }
  catch { return undefined; }
  if (!Number.isFinite(Date.parse(item.requestedAt))) return undefined;
  return { id: item.id, runId: item.runId, operation: 'resolveObservedOrder', observedName: item.observedName.trim(), ...(item.runMarker === undefined ? {} : { runMarker: String(item.runMarker) }), requestedAt: item.requestedAt };
}

function parseResponse(value: unknown, request: ObservedOrderBridgeRequest): ObservedOrderBridgeResponse | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const item = value as Record<string, unknown>;
  if (item.id !== request.id || item.runId !== request.runId || typeof item.ok !== 'boolean' || typeof item.respondedAt !== 'string' || !Number.isFinite(Date.parse(item.respondedAt))) return undefined;
  if (item.ok) {
    if (typeof item.orderGid !== 'string' || !/^gid:\/\/shopify\/Order\/[A-Za-z0-9_-]+$/.test(item.orderGid) || typeof item.orderName !== 'string' || !item.orderName.trim()) return undefined;
    return { id: request.id, runId: request.runId, ok: true, orderGid: item.orderGid, orderName: item.orderName.trim(), respondedAt: item.respondedAt };
  }
  if (typeof item.error !== 'string' || !item.error.trim() || item.error.length > 500) return undefined;
  return { id: request.id, runId: request.runId, ok: false, error: item.error.replace(/password|token|secret|authorization/gi, '[redacted]'), respondedAt: item.respondedAt };
}

export async function createObservedOrderRequest(root: string, runId: string, input: ObservedOrderBridgeInput): Promise<ObservedOrderBridgeRequest> {
  validRunId(runId);
  validateInput(input);
  const request: ObservedOrderBridgeRequest = { id: randomUUID(), runId, operation: 'resolveObservedOrder', observedName: input.observedName.trim(), ...(input.runMarker === undefined ? {} : { runMarker: input.runMarker }), requestedAt: new Date().toISOString() };
  const file = requestFile(root, request);
  await mkdir(resolve(file, '..'), { recursive: true });
  await writeFile(file, JSON.stringify(request), { flag: 'wx' });
  return request;
}

export async function readBridgeRequests(root: string, runId: string): Promise<ObservedOrderBridgeRequest[]> {
  const directory = runDirectory(root, runId);
  let entries: string[];
  try { entries = await readdir(directory); } catch { return []; }
  const requests: ObservedOrderBridgeRequest[] = [];
  for (const entry of entries.filter(name => name.endsWith('.request.json')).sort()) {
    try {
      const parsed = parseRequest(JSON.parse(await readFile(join(directory, entry), 'utf8')));
      if (parsed) requests.push(parsed);
    }
    catch { /* malformed worker data remains unavailable and cannot authorize a read */ }
  }
  return requests;
}

export async function clearBridgeRequest(root: string, request: ObservedOrderBridgeRequest): Promise<void> {
  await unlink(requestFile(root, request)).catch(() => undefined);
}

export async function writeBridgeResponse(root: string, request: ObservedOrderBridgeRequest, result: Omit<ObservedOrderBridgeResponse, 'id' | 'runId' | 'respondedAt'>): Promise<void> {
  const response: ObservedOrderBridgeResponse = { ...result, id: request.id, runId: request.runId, respondedAt: new Date().toISOString() };
  if (!parseResponse(response, request)) throw new Error('Invalid observed-order bridge response.');
  await writeAtomic(responseFile(root, request), response);
}

export async function consumeBridgeResponse(root: string, request: ObservedOrderBridgeRequest): Promise<ObservedOrderBridgeResponse | undefined> {
  try {
    const parsed = parseResponse(JSON.parse(await readFile(responseFile(root, request), 'utf8')), request);
    if (!parsed) return undefined;
    await unlink(responseFile(root, request));
    return parsed;
  } catch { return undefined; }
}
