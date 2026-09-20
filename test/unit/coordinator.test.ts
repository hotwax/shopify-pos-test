import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { classifyWorkerFailure, createCoordinator } from '../../core/runner/coordinator.ts';
import { spawn } from '../../core/runner/process.ts';
import { isTerminalState } from '../../core/runner/protocol.ts';
import type { RunRequest } from '../../shared/contracts.ts';

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
