import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { approveCheckpoint, consumeApproval } from '../../core/runner/approval.ts';

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
