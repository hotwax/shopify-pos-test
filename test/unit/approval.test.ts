import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  approveCheckpoint,
  consumeApproval,
  readApprovalRequest,
  requestApproval,
} from '../../core/runner/approval.ts';
import type { ApprovalSummary } from '../../shared/transaction.ts';

const summary: ApprovalSummary = {
  scenario: 'create-cash-order',
  direction: 'collect',
  amount: { amount: '12.00', currency: 'USD' },
  lineCount: 1,
};

test('persists a bounded approval request and consumes only the exact one-time approval', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ios-testing-approval-'));
  const runId = 'run-approval';
  const intentHash = 'a'.repeat(64);
  await requestApproval(root, runId, intentHash, summary);
  assert.deepEqual(await readApprovalRequest(root, runId), {
    runId,
    intentHash,
    summary,
    requestedAt: (await readApprovalRequest(root, runId))?.requestedAt,
  });

  await approveCheckpoint(root, runId, intentHash);
  assert.equal(await consumeApproval(root, runId, intentHash), true);
  assert.equal(await consumeApproval(root, runId, intentHash), false);
});

test('rejects malformed approval request identities and summaries', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ios-testing-approval-'));
  await assert.rejects(() => requestApproval(root, '../run', 'a'.repeat(64), summary), /identity/);
  await assert.rejects(() => requestApproval(root, 'run-ok', 'a'.repeat(63), summary), /identity/);
  await assert.rejects(() => requestApproval(root, 'run-ok', 'a'.repeat(64), { ...summary, lineCount: 0 }), /summary/);
});
