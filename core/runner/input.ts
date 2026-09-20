import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { RunRequest } from '../../shared/contracts.ts';
import { isValidTargetContext } from '../safety/environment.ts';

const secretKey = /password|token|secret|credential|api[_-]?key/i;

function validRunId(runId: string): void {
  if (!/^[a-zA-Z0-9_-]{1,120}$/.test(runId)) throw new Error('Invalid worker input identity.');
}

function safeValue(value: unknown, depth = 0): void {
  if (depth > 8) throw new Error('Worker parameters are too deeply nested.');
  if (value === null || typeof value === 'boolean' || typeof value === 'number') {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Worker parameters must contain finite numbers.');
    return;
  }
  if (typeof value === 'string') {
    if (value.length > 4_000 || /[\0\r\n]/.test(value)) throw new Error('Worker parameters contain an unsafe string.');
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > 1_000) throw new Error('Worker parameters contain too many entries.');
    for (const item of value) safeValue(item, depth + 1);
    return;
  }
  if (!value || typeof value !== 'object') throw new Error('Worker parameters must be JSON values.');
  const entries = Object.entries(value);
  if (entries.length > 100) throw new Error('Worker parameters contain too many fields.');
  for (const [key, item] of entries) {
    if (!/^[A-Za-z][A-Za-z0-9_.-]{0,80}$/.test(key) || secretKey.test(key)) throw new Error('Worker parameters contain an unsafe or credential-like field.');
    safeValue(item, depth + 1);
  }
}

function validRequest(request: unknown): asserts request is RunRequest {
  if (!request || typeof request !== 'object' || Array.isArray(request)) throw new Error('Worker input does not contain a run request.');
  const value = request as Partial<RunRequest>;
  if (typeof value.scriptId !== 'string' || !/^[A-Za-z0-9_.-]{1,120}$/.test(value.scriptId) ||
      typeof value.deviceProfileId !== 'string' || !/^[A-Za-z0-9_.-]{1,120}$/.test(value.deviceProfileId) ||
      !['pos', 'pos-shopify', 'pos-shopify-oms'].includes(String(value.assertionMode)) ||
      typeof value.expectedRevision !== 'string' || !/^[A-Za-z0-9_-]{1,120}$/.test(value.expectedRevision) ||
      !value.parameters || typeof value.parameters !== 'object' || Array.isArray(value.parameters)) throw new Error('Worker input contains an invalid run request.');
  safeValue(value.parameters);
  if (value.context !== undefined && !isValidTargetContext(value.context)) throw new Error('Worker input contains an invalid target context.');
  const encoded = JSON.stringify(value);
  if (encoded.length > 64_000) throw new Error('Worker input is too large.');
}

function fileFor(root: string, runId: string): string {
  validRunId(runId);
  return join(resolve(root), '.runtime', 'runs', runId, 'worker-input.json');
}

export async function writeWorkerInput(root: string, runId: string, request: RunRequest): Promise<string> {
  validRunId(runId);
  validRequest(request);
  const file = fileFor(root, runId);
  await mkdir(resolve(file, '..'), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporary, JSON.stringify({ schemaVersion: 1, runId, request: structuredClone(request) }), { flag: 'wx', mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, file);
  return file;
}

export async function readWorkerInput(file: string, runId: string): Promise<RunRequest> {
  validRunId(runId);
  const value = JSON.parse(await readFile(file, 'utf8')) as { schemaVersion?: unknown; runId?: unknown; request?: unknown };
  if (value?.schemaVersion !== 1 || value.runId !== runId) throw new Error('Worker input identity does not match the owned run.');
  validRequest(value.request);
  return structuredClone(value.request);
}
