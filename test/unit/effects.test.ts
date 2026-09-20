import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  acknowledgeCommitAttempt,
  acknowledgeCommitOutcome,
  consumeCommitAcknowledgement,
  consumeCommitOutcomeAcknowledgement,
  readCommitAttempt,
  readCommitOutcome,
  requestCommitAttempt,
  requestCommitOutcome,
} from '../../core/runner/effects.ts';

test('persists and consumes an exact coordinator acknowledgement for a commit attempt', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ios-testing-effects-'));
  const runId = 'run-effects';
  const intentHash = 'c'.repeat(64);
  await requestCommitAttempt(root, runId, intentHash);
  assert.deepEqual((await readCommitAttempt(root, runId))?.intentHash, intentHash);
  await acknowledgeCommitAttempt(root, runId, intentHash);
  assert.equal(await consumeCommitAcknowledgement(root, runId, intentHash), true);
  assert.equal(await consumeCommitAcknowledgement(root, runId, intentHash), false);
});

test('rejects malformed commit-attempt identities', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ios-testing-effects-'));
  await assert.rejects(() => requestCommitAttempt(root, '../run', 'c'.repeat(64)), /identity/);
  await assert.rejects(() => requestCommitAttempt(root, 'run-ok', 'c'.repeat(63)), /identity/);
});

test('persists and consumes a confirmed or unknown outcome acknowledgement', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ios-testing-effects-'));
  const runId = 'run-outcome';
  const intentHash = 'd'.repeat(64);
  await requestCommitOutcome(root, runId, intentHash, 'confirmed');
  assert.equal((await readCommitOutcome(root, runId))?.effect, 'confirmed');
  await acknowledgeCommitOutcome(root, runId, intentHash, 'confirmed');
  assert.equal(await consumeCommitOutcomeAcknowledgement(root, runId, intentHash, 'confirmed'), true);
  assert.equal(await consumeCommitOutcomeAcknowledgement(root, runId, intentHash, 'confirmed'), false);
  await assert.rejects(() => requestCommitOutcome(root, runId, intentHash, 'not-an-effect' as 'confirmed'), /outcome/);
});
