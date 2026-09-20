import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { classifyWorkerFailure, createCoordinator } from '../../core/runner/coordinator.ts';
import { requestApproval } from '../../core/runner/approval.ts';
import { consumeCommitAcknowledgement, consumeCommitOutcomeAcknowledgement, requestCommitAttempt, requestCommitOutcome } from '../../core/runner/effects.ts';
import { spawn } from '../../core/runner/process.ts';
import { isTerminalState } from '../../core/runner/protocol.ts';
import type { RunRequest } from '../../shared/contracts.ts';
import { createScenarioContext } from '../../test/support/context.ts';

const request: RunRequest = {
  scriptId: 'pos.open-first-order', deviceProfileId: 'test-ipad', parameters: {},
  assertionMode: 'pos', expectedRevision: 'revision-a',
};

async function eventually(read: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    if (await read()) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error('condition was not reached');
}

test('blocks a second run targeting the same device', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ios-testing-coordinator-'));
  const coordinator = createCoordinator({
    root,
    workerFactory: async () => spawn(process.execPath, ['-e', 'setTimeout(() => {}, 1_000)'], { cwd: process.cwd(), env: { PATH: process.env.PATH ?? '' } }),
  });
  const first = await coordinator.startRun(request);
  const second = await coordinator.startRun(request);
  assert.equal(second.state, 'blocked');
  await coordinator.requestStop(first.id);
});

test('does not call a zero-exit child successful without a structured result', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ios-testing-coordinator-'));
  const coordinator = createCoordinator({
    root,
    workerFactory: async () => spawn(process.execPath, ['-e', ''], { cwd: process.cwd(), env: { PATH: process.env.PATH ?? '' } }),
  });
  const accepted = await coordinator.startRun(request);
  await eventually(async () => isTerminalState((await coordinator.getRun(accepted.id)).state));
  const result = await coordinator.getRun(accepted.id);
  assert.equal(result.state, 'failed');
  assert.equal(result.effect, 'not-started');
});

test('classifies a locked iPad as a blocked precondition without changing access', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ios-testing-wda-'));
  await writeFile(join(directory, 'wdio-appium.log'), 'Error Domain=com.apple.dt.deviceprep Code=-3 "Unlock iPad to Continue"');
  assert.deepEqual(await classifyWorkerFailure(directory), {
    state: 'blocked',
    reason: 'device-locked',
    message: 'The iPad is locked. Unlock it yourself, leave Shopify POS on Home, and start a fresh run. The toolkit did not change iPad access settings.',
  });
});

test('classifies UI-automation authorization as a user-owned blocked precondition', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ios-testing-wda-'));
  await writeFile(join(directory, 'wdio-appium.log'), 'Not authorized for performing UI testing actions');
  const result = await classifyWorkerFailure(directory);
  assert.equal(result.state, 'blocked');
  assert.equal(result.reason, 'ui-automation-authorization');
});

test('stops an owned worker promptly when the device lock is observed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ios-testing-coordinator-'));
  const coordinator = createCoordinator({
    root,
    workerFactory: async ({ artifactDir }) => {
      await writeFile(join(artifactDir, 'wdio-appium.log'), 'Xcode cannot launch WebDriverAgentRunner because the device is locked.');
      return spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60_000)'], { cwd: process.cwd(), env: { PATH: process.env.PATH ?? '' } });
    },
  });
  const startedAt = Date.now();
  const accepted = await coordinator.startRun(request);
  await eventually(async () => isTerminalState((await coordinator.getRun(accepted.id)).state));
  const result = await coordinator.getRun(accepted.id);
  assert.equal(result.state, 'blocked');
  assert.ok(Date.now() - startedAt < 2_000);
});

test('accepts a structured worker result and exposes events to subscribers', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ios-testing-coordinator-'));
  const coordinator = createCoordinator({
    root,
    workerFactory: async ({ artifactDir }) => {
      await writeFile(join(artifactDir, 'result.json'), JSON.stringify({ passed: true }));
      return spawn(process.execPath, ['-e', ''], { cwd: process.cwd(), env: { PATH: process.env.PATH ?? '' } });
    },
  });
  const accepted = await coordinator.startRun(request);
  const states: string[] = [];
  const unsubscribe = coordinator.subscribeRun(accepted.id, 0, event => {
    if (event.type === 'run-state') states.push(String(event.data.state));
  });
  await eventually(async () => (await coordinator.getRun(accepted.id)).state === 'passed');
  unsubscribe();
  assert.ok(states.includes('running'));
  assert.equal((await coordinator.getRun(accepted.id)).state, 'passed');
});

test('blocks a run when the reviewed source revision is no longer current', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ios-testing-coordinator-'));
  let workerStarted = false;
  const coordinator = createCoordinator({
    root,
    currentRevision: () => 'revision-current',
    workerFactory: async () => { workerStarted = true; throw new Error('worker must not start'); },
  });
  const result = await coordinator.startRun({ ...request, expectedRevision: 'revision-reviewed' });
  assert.equal(result.state, 'blocked');
  assert.equal(result.effect, 'not-started');
  assert.equal(workerStarted, false);
  assert.match(result.statusMessage ?? '', /revision/i);
});

test('surfaces a worker approval request and resumes only after the coordinator approves it', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ios-testing-coordinator-'));
  const intentHash = 'b'.repeat(64);
  const coordinator = createCoordinator({
    root,
    workerFactory: async ({ runId, artifactDir }) => {
      await requestApproval(root, runId, intentHash, { scenario: 'create-cash-order', direction: 'collect', amount: { amount: '12.00', currency: 'USD' }, lineCount: 1 });
      await writeFile(join(artifactDir, 'result.json'), JSON.stringify({ passed: true, message: 'approved' }));
      return spawn(process.execPath, ['-e', 'setTimeout(() => {}, 500)'], { cwd: process.cwd(), env: { PATH: process.env.PATH ?? '' } });
    },
  });
  const accepted = await coordinator.startRun(request);
  await eventually(async () => (await coordinator.getRun(accepted.id)).state === 'awaiting-approval');
  const waiting = await coordinator.getRun(accepted.id);
  assert.equal(waiting.pendingApproval?.intentHash, intentHash);
  await coordinator.approveCheckpoint(accepted.id);
  await eventually(async () => (await coordinator.getRun(accepted.id)).state === 'passed');
  const finished = await coordinator.getRun(accepted.id);
  assert.equal(finished.pendingApproval, undefined);
  assert.equal(finished.effect, 'not-started');
});

test('does not report a passed run when a commit attempt lacks confirmed read-back', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ios-testing-coordinator-'));
  const intentHash = 'd'.repeat(64);
  const coordinator = createCoordinator({
    root,
    workerFactory: async ({ runId, artifactDir }) => {
      await requestCommitAttempt(root, runId, intentHash);
      await writeFile(join(artifactDir, 'result.json'), JSON.stringify({ passed: true, message: 'worker exited without a confirmation event' }));
      return spawn(process.execPath, ['-e', 'setTimeout(() => {}, 500)'], { cwd: process.cwd(), env: { PATH: process.env.PATH ?? '' } });
    },
  });
  const accepted = await coordinator.startRun(request);
  await eventually(async () => (await coordinator.getRun(accepted.id)).state === 'needs-reconciliation');
  const result = await coordinator.getRun(accepted.id);
  assert.equal(result.effect, 'unknown');
  assert.equal(result.state, 'needs-reconciliation');
});

test('records a confirmed business effect only after the worker reports verified read-back', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ios-testing-coordinator-'));
  const intentHash = 'e'.repeat(64);
  const coordinator = createCoordinator({
    root,
    workerFactory: async ({ runId, artifactDir }) => {
      await requestCommitAttempt(root, runId, intentHash);
      await eventually(async () => consumeCommitAcknowledgement(root, runId, intentHash));
      await requestCommitOutcome(root, runId, intentHash, 'confirmed');
      await eventually(async () => consumeCommitOutcomeAcknowledgement(root, runId, intentHash, 'confirmed'));
      await writeFile(join(artifactDir, 'result.json'), JSON.stringify({ passed: true, message: 'verified' }));
      return spawn(process.execPath, ['-e', 'setTimeout(() => {}, 50)'], { cwd: process.cwd(), env: { PATH: process.env.PATH ?? '' } });
    },
  });
  const accepted = await coordinator.startRun(request);
  await eventually(async () => (await coordinator.getRun(accepted.id)).state === 'passed');
  const result = await coordinator.getRun(accepted.id);
  assert.equal(result.effect, 'confirmed');
  assert.equal(result.businessEffectIntentHash, intentHash);
});

test('classifies a missing worker result after a commit attempt as reconciliation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ios-testing-coordinator-'));
  const intentHash = 'f'.repeat(64);
  const coordinator = createCoordinator({
    root,
    workerFactory: async ({ runId }) => {
      await requestCommitAttempt(root, runId, intentHash);
      return spawn(process.execPath, ['-e', 'setTimeout(() => {}, 100)'], { cwd: process.cwd(), env: { PATH: process.env.PATH ?? '' } });
    },
  });
  const accepted = await coordinator.startRun(request);
  await eventually(async () => (await coordinator.getRun(accepted.id)).state === 'needs-reconciliation');
  const result = await coordinator.getRun(accepted.id);
  assert.equal(result.effect, 'unknown');
  assert.match(result.statusMessage ?? '', /structured result/i);
});

test('routes observed-order correlation through the owned coordinator bridge', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ios-testing-coordinator-'));
  let receivedContext = false;
  const coordinator = createCoordinator({
    root,
    resolveObservedOrder: async ({ request: workerRequest, observedName }) => {
      receivedContext = Boolean(workerRequest.context?.shopGid === 'gid://shopify/Shop/1');
      return { orderGid: 'gid://shopify/Order/42', orderName: observedName };
    },
    workerFactory: async ({ runId, artifactDir }) => {
      const resolved = await createScenarioContext({ root, runId, bridgeTimeoutMs: 1_000 }).resolveObservedOrder({ observedName: '#42' });
      await writeFile(join(artifactDir, 'result.json'), JSON.stringify({ passed: resolved.orderGid.endsWith('/42') }));
      return spawn(process.execPath, ['-e', 'setTimeout(() => {}, 50)'], { cwd: process.cwd(), env: { PATH: process.env.PATH ?? '' } });
    },
  });
  const accepted = await coordinator.startRun({ ...request, context: {
    connectionId: 'local', omsOrigin: 'https://oms.example', userId: 'user-1', connectorShopId: 'shop-1',
    shopGid: 'gid://shopify/Shop/1', shopDomain: 'test.myshopify.com', locationGid: 'gid://shopify/Location/1', apiVersion: '2026-01',
  } });
  await eventually(async () => (await coordinator.getRun(accepted.id)).state === 'passed');
  assert.equal(receivedContext, true);
});
