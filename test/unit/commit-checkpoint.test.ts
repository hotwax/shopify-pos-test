import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { approveCheckpoint, consumeApproval } from '../../core/runner/approval.ts';
import { consumeCommitCheckpoint, writeCommitCheckpoint } from '../../core/runner/checkpoint.ts';
import { readResources, recordResource } from '../../core/runner/resources.ts';
import { createScenarioContext } from '../../test/support/context.ts';
import type { TransactionIntent } from '../../shared/transaction.ts';

test('approval checkpoints are exact and one-use', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ios-testing-approval-'));
  const hash = 'a'.repeat(64);
  await approveCheckpoint(root, 'run-1', hash);
  assert.equal(await consumeApproval(root, 'run-1', hash), true);
  assert.equal(await consumeApproval(root, 'run-1', hash), false);
  await approveCheckpoint(root, 'run-2', hash);
  assert.equal(await consumeApproval(root, 'run-2', 'b'.repeat(64)), false);
  assert.equal(await consumeApproval(root, 'run-2', hash), true);
});

test('approval checkpoint rejects malformed identities', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ios-testing-approval-'));
  await assert.rejects(() => approveCheckpoint(root, '../run', 'a'.repeat(64)));
  await assert.rejects(() => approveCheckpoint(root, 'run-1', 'not-a-hash'));
});

test('commit checkpoint is durable, exact and one-time', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ios-testing-commit-'));
  const hash = 'c'.repeat(64);
  await writeCommitCheckpoint(root, 'run-1', hash);
  assert.equal(await consumeCommitCheckpoint(root, 'run-1', hash), true);
  assert.equal(await consumeCommitCheckpoint(root, 'run-1', hash), false);
});

test('commit checkpoint rejects reuse with a different intent', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ios-testing-commit-'));
  await writeCommitCheckpoint(root, 'run-1', 'c'.repeat(64));
  assert.equal(await consumeCommitCheckpoint(root, 'run-1', 'd'.repeat(64)), false);
  await assert.rejects(() => writeCommitCheckpoint(root, '../run', 'c'.repeat(64)));
});

test('owned scenario context consumes the exact approval before recording a commit attempt', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ios-testing-context-'));
  const intent = { scenario: 'create-cash-order', sourceHash: 'source', udid: 'device', context: {}, returnLines: [], purchaseLines: [{ variantGid: 'variant', quantity: 1 }], tender: 'cash', expectedDirection: 'collect', maximumAbsoluteAmount: { amount: '1.00', currency: 'USD' } } as unknown as TransactionIntent;
  const hash = (await import('../../core/safety/intent.ts')).hashIntent(intent);
  await approveCheckpoint(root, 'run-1', hash);
  const context = createScenarioContext({ root, runId: 'run-1', approvalTimeoutMs: 20 });
  assert.deepEqual(await context.requireApproval(intent), { intentHash: hash });
  await context.recordCommitAttempt(hash);
  assert.equal(await consumeCommitCheckpoint(root, 'run-1', hash), true);
  await assert.rejects(() => context.requireApproval(intent), /approval/i);
});

test('records sanitized affected resource IDs without duplicating them', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ios-testing-resources-'));
  await recordResource(root, 'run-1', 'order', 'gid://shopify/Order/1');
  await recordResource(root, 'run-1', 'order', 'gid://shopify/Order/1');
  await recordResource(root, 'run-1', 'return', 'gid://shopify/Return/1');
  assert.deepEqual(await readResources(root, 'run-1'), { order: ['gid://shopify/Order/1'], return: ['gid://shopify/Return/1'] });
  await assert.rejects(() => recordResource(root, '../run', 'order', 'gid://shopify/Order/1'));
  await assert.rejects(() => recordResource(root, 'run-1', 'order', 'not-an-id'));
});
