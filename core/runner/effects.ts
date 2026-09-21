import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export interface CommitAttemptRequest {
  runId: string;
  intentHash: string;
  requestedAt: string;
}

export interface CommitAcknowledgement {
  runId: string;
  intentHash: string;
  acknowledgedAt: string;
}

export type CommitOutcome = 'confirmed' | 'unknown';

export interface CommitOutcomeRequest {
  runId: string;
  intentHash: string;
  effect: CommitOutcome;
  requestedAt: string;
}

export interface CommitOutcomeAcknowledgement {
  runId: string;
  intentHash: string;
  effect: CommitOutcome;
  acknowledgedAt: string;
}

function validRunId(runId: string): void {
  if (!/^[a-zA-Z0-9_-]{1,120}$/.test(runId)) throw new Error('Invalid commit-attempt identity.');
}

function validHash(intentHash: string): void {
  if (!/^[a-f0-9]{64}$/.test(intentHash)) throw new Error('Invalid commit-attempt identity.');
}

function validOutcome(effect: string): asserts effect is CommitOutcome {
  if (effect !== 'confirmed' && effect !== 'unknown') throw new Error('Invalid commit outcome.');
}

function fileFor(root: string, runId: string, name: string): string {
  validRunId(runId);
  return join(resolve(root), '.runtime', 'runs', runId, name);
}

async function writeAtomic(file: string, value: unknown): Promise<void> {
  await mkdir(resolve(file, '..'), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporary, JSON.stringify(value), { flag: 'wx' });
  await rename(temporary, file);
}

export async function requestCommitAttempt(root: string, runId: string, intentHash: string): Promise<void> {
  validRunId(runId);
  validHash(intentHash);
  await writeAtomic(fileFor(root, runId, 'commit-attempt.json'), { runId, intentHash, requestedAt: new Date().toISOString() } satisfies CommitAttemptRequest);
}

export async function readCommitAttempt(root: string, runId: string): Promise<CommitAttemptRequest | undefined> {
  const file = fileFor(root, runId, 'commit-attempt.json');
  try {
    const value = JSON.parse(await readFile(file, 'utf8')) as CommitAttemptRequest;
    if (value?.runId !== runId || typeof value.intentHash !== 'string' || typeof value.requestedAt !== 'string') return undefined;
    validHash(value.intentHash);
    if (!Number.isFinite(Date.parse(value.requestedAt))) return undefined;
    return structuredClone(value);
  } catch { return undefined; }
}

export async function clearCommitAttempt(root: string, runId: string): Promise<void> {
  await unlink(fileFor(root, runId, 'commit-attempt.json')).catch(() => undefined);
}

export async function acknowledgeCommitAttempt(root: string, runId: string, intentHash: string): Promise<void> {
  validRunId(runId);
  validHash(intentHash);
  await writeAtomic(fileFor(root, runId, 'commit-acknowledgement.json'), { runId, intentHash, acknowledgedAt: new Date().toISOString() } satisfies CommitAcknowledgement);
}

export async function consumeCommitAcknowledgement(root: string, runId: string, intentHash: string): Promise<boolean> {
  validRunId(runId);
  validHash(intentHash);
  const file = fileFor(root, runId, 'commit-acknowledgement.json');
  try {
    const value = JSON.parse(await readFile(file, 'utf8')) as CommitAcknowledgement;
    if (value?.runId !== runId || value.intentHash !== intentHash || !Number.isFinite(Date.parse(value.acknowledgedAt))) return false;
    await unlink(file);
    return true;
  } catch { return false; }
}

export async function requestCommitOutcome(root: string, runId: string, intentHash: string, effect: CommitOutcome): Promise<void> {
  validRunId(runId);
  validHash(intentHash);
  validOutcome(effect);
  await writeAtomic(fileFor(root, runId, 'commit-outcome.json'), { runId, intentHash, effect, requestedAt: new Date().toISOString() } satisfies CommitOutcomeRequest);
}

export async function readCommitOutcome(root: string, runId: string): Promise<CommitOutcomeRequest | undefined> {
  const file = fileFor(root, runId, 'commit-outcome.json');
  try {
    const value = JSON.parse(await readFile(file, 'utf8')) as CommitOutcomeRequest;
    if (value?.runId !== runId || typeof value.intentHash !== 'string' || typeof value.effect !== 'string' || typeof value.requestedAt !== 'string') return undefined;
    validHash(value.intentHash);
    validOutcome(value.effect);
    if (!Number.isFinite(Date.parse(value.requestedAt))) return undefined;
    return structuredClone(value);
  } catch { return undefined; }
}

export async function clearCommitOutcome(root: string, runId: string): Promise<void> {
  await unlink(fileFor(root, runId, 'commit-outcome.json')).catch(() => undefined);
}

export async function acknowledgeCommitOutcome(root: string, runId: string, intentHash: string, effect: CommitOutcome): Promise<void> {
  validRunId(runId);
  validHash(intentHash);
  validOutcome(effect);
  await writeAtomic(fileFor(root, runId, 'commit-outcome-acknowledgement.json'), { runId, intentHash, effect, acknowledgedAt: new Date().toISOString() } satisfies CommitOutcomeAcknowledgement);
}

export async function consumeCommitOutcomeAcknowledgement(root: string, runId: string, intentHash: string, effect: CommitOutcome): Promise<boolean> {
  validRunId(runId);
  validHash(intentHash);
  validOutcome(effect);
  const file = fileFor(root, runId, 'commit-outcome-acknowledgement.json');
  try {
    const value = JSON.parse(await readFile(file, 'utf8')) as CommitOutcomeAcknowledgement;
    if (value?.runId !== runId || value.intentHash !== intentHash || value.effect !== effect || !Number.isFinite(Date.parse(value.acknowledgedAt))) return false;
    await unlink(file);
    return true;
  } catch { return false; }
}
