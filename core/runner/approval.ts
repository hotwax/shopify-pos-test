import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { ApprovalSummary } from '../../shared/transaction.ts';

interface Approval { runId: string; intentHash: string; approvedAt: string }
export interface ApprovalRequest {
  runId: string;
  intentHash: string;
  summary: ApprovalSummary;
  requestedAt: string;
}

function fileFor(root: string): string { return join(resolve(root), '.runtime', 'approvals.json'); }
function requestFileFor(root: string, runId: string): string { return join(resolve(root), '.runtime', 'runs', runId, 'approval-request.json'); }

function validRunId(runId: string): void {
  if (!/^[a-zA-Z0-9_-]{1,120}$/.test(runId)) throw new Error('Invalid approval request identity.');
}

function validHash(intentHash: string): void {
  if (!/^[a-f0-9]{64}$/.test(intentHash)) throw new Error('Invalid approval request identity.');
}

function validSummary(summary: ApprovalSummary): void {
  if (!summary || typeof summary !== 'object' || !/^[a-zA-Z0-9._-]{1,120}$/.test(summary.scenario) ||
      !['collect', 'even', 'refund'].includes(summary.direction) ||
      !summary.amount || typeof summary.amount.amount !== 'string' || !/^\d+(?:\.\d{1,2})?$/.test(summary.amount.amount) ||
      !/^[A-Z]{3}$/.test(summary.amount.currency) || !Number.isSafeInteger(summary.lineCount) || summary.lineCount < 1 || summary.lineCount > 1000 ||
      (summary.sourceOrderGid !== undefined && !/^gid:\/\/shopify\/Order\/[A-Za-z0-9_-]+$/.test(summary.sourceOrderGid))) {
    throw new Error('Invalid approval request summary.');
  }
}

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

export async function requestApproval(root: string, runId: string, intentHash: string, summary: ApprovalSummary): Promise<void> {
  validRunId(runId);
  validHash(intentHash);
  validSummary(summary);
  const file = requestFileFor(root, runId);
  await mkdir(resolve(file, '..'), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}-${Date.now()}`;
  const request: ApprovalRequest = { runId, intentHash, summary: structuredClone(summary), requestedAt: new Date().toISOString() };
  await writeFile(temporary, JSON.stringify(request), { flag: 'wx' });
  await rename(temporary, file);
}

export async function readApprovalRequest(root: string, runId: string): Promise<ApprovalRequest | undefined> {
  validRunId(runId);
  try {
    const value = JSON.parse(await readFile(requestFileFor(root, runId), 'utf8')) as ApprovalRequest;
    if (value?.runId !== runId || typeof value.intentHash !== 'string' || !value.summary) return undefined;
    validHash(value.intentHash);
    validSummary(value.summary);
    if (typeof value.requestedAt !== 'string' || !Number.isFinite(Date.parse(value.requestedAt))) return undefined;
    return structuredClone(value);
  } catch { return undefined; }
}

export async function clearApprovalRequest(root: string, runId: string): Promise<void> {
  validRunId(runId);
  await unlink(requestFileFor(root, runId)).catch(() => undefined);
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
