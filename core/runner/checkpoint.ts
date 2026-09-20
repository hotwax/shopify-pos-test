import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

interface CommitCheckpoint {
  runId: string;
  intentHash: string;
  attemptedAt: string;
  consumedAt?: string;
}

function fileFor(root: string): string { return join(resolve(root), '.runtime', 'commit-checkpoints.json'); }

function validRunId(runId: string): void {
  if (!/^[a-zA-Z0-9_-]{1,120}$/.test(runId)) throw new Error('Invalid commit checkpoint identity.');
}

function validHash(intentHash: string): void {
  if (!/^[a-f0-9]{64}$/.test(intentHash)) throw new Error('Invalid commit checkpoint identity.');
}

async function readCheckpoints(root: string): Promise<CommitCheckpoint[]> {
  try {
    const value = JSON.parse(await readFile(fileFor(root), 'utf8')) as unknown;
    return Array.isArray(value) ? value.filter(item => item && typeof item === 'object' && typeof item.runId === 'string' && typeof item.intentHash === 'string' && typeof item.attemptedAt === 'string') as CommitCheckpoint[] : [];
  } catch { return []; }
}

async function writeCheckpoints(root: string, checkpoints: CommitCheckpoint[]): Promise<void> {
  const file = fileFor(root);
  await mkdir(resolve(root, '.runtime'), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporary, JSON.stringify(checkpoints, null, 2), { flag: 'wx' });
  await rename(temporary, file);
}

export async function writeCommitCheckpoint(root: string, runId: string, intentHash: string): Promise<void> {
  validRunId(runId); validHash(intentHash);
  const checkpoints = await readCheckpoints(root);
  if (checkpoints.some(item => item.runId === runId)) throw new Error('A commit checkpoint already exists for this run.');
  await writeCheckpoints(root, [...checkpoints, { runId, intentHash, attemptedAt: new Date().toISOString() }]);
}

export async function consumeCommitCheckpoint(root: string, runId: string, intentHash: string): Promise<boolean> {
  validRunId(runId); validHash(intentHash);
  const checkpoints = await readCheckpoints(root);
  const match = checkpoints.find(item => item.runId === runId && item.intentHash === intentHash && !item.consumedAt);
  if (!match) return false;
  match.consumedAt = new Date().toISOString();
  await writeCheckpoints(root, checkpoints);
  return true;
}
