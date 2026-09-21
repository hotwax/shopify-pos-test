import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

type ResourceMap = Record<string, string[]>;

function assertRunId(runId: string): void {
  if (!/^[a-zA-Z0-9_-]{1,120}$/.test(runId)) throw new Error('Invalid resource run ID.');
}

function assertResource(kind: string, gid: string): void {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(kind) || !/^gid:\/\/shopify\/[A-Za-z0-9_]+\/[A-Za-z0-9_-]+$/.test(gid)) throw new Error('Invalid affected resource identity.');
}

function fileFor(root: string, runId: string): string {
  assertRunId(runId);
  return join(resolve(root), '.runtime', 'runs', runId, 'resources.json');
}

async function readMap(root: string, runId: string): Promise<ResourceMap> {
  try {
    const value = JSON.parse(await readFile(fileFor(root, runId), 'utf8')) as unknown;
    if (!value || typeof value !== 'object') return {};
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).flatMap(([kind, ids]) => [
      [kind, Array.isArray(ids) ? ids.filter(id => typeof id === 'string') as string[] : []],
    ]));
  } catch { return {}; }
}

async function writeMap(root: string, runId: string, value: ResourceMap): Promise<void> {
  const file = fileFor(root, runId);
  await mkdir(resolve(file, '..'), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporary, JSON.stringify(value, null, 2), { flag: 'wx' });
  await rename(temporary, file);
}

export async function recordResource(root: string, runId: string, kind: string, gid: string): Promise<void> {
  assertResource(kind, gid);
  const resources = await readMap(root, runId);
  resources[kind] ??= [];
  if (!resources[kind].includes(gid)) resources[kind].push(gid);
  await writeMap(root, runId, resources);
}

export async function readResources(root: string, runId: string): Promise<ResourceMap> {
  return readMap(root, runId);
}
