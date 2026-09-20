import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

interface Approval { runId: string; intentHash: string; approvedAt: string }

function fileFor(root: string): string { return join(resolve(root), '.runtime', 'approvals.json'); }

async function readApprovals(root: string): Promise<Approval[]> {
  try {
    const value = JSON.parse(await readFile(fileFor(root), 'utf8')) as unknown;
    return Array.isArray(value) ? value.filter(item => item && typeof item === 'object' && typeof item.runId === 'string' && typeof item.intentHash === 'string') as Approval[] : [];
  } catch { return []; }
}

async function writeApprovals(root: string, approvals: Approval[]): Promise<void> {
  const file = fileFor(root);
  await mkdir(resolve(root, '.runtime'), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporary, JSON.stringify(approvals, null, 2), { flag: 'wx' });
  await rename(temporary, file);
}

export async function approveCheckpoint(root: string, runId: string, intentHash: string): Promise<void> {
  if (!/^[a-zA-Z0-9_-]{1,120}$/.test(runId) || !/^[a-f0-9]{64}$/.test(intentHash)) throw new Error('Invalid approval checkpoint identity.');
  const approvals = await readApprovals(root);
  await writeApprovals(root, [...approvals.filter(item => item.runId !== runId), { runId, intentHash, approvedAt: new Date().toISOString() }]);
}

export async function consumeApproval(root: string, runId: string, intentHash: string): Promise<boolean> {
  const approvals = await readApprovals(root);
  const match = approvals.find(item => item.runId === runId && item.intentHash === intentHash);
  if (!match) return false;
  await writeApprovals(root, approvals.filter(item => item !== match));
  return true;
}
