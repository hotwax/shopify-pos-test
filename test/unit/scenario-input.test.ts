import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { RunRequest } from '../../shared/contracts.ts';
import { writeWorkerInput } from '../../core/runner/input.ts';
import { readScenarioRequest } from '../../test/support/input.ts';

const request: RunRequest = {
  scriptId: 'pos.open-first-order', deviceProfileId: 'test-ipad', parameters: {},
  assertionMode: 'pos', expectedRevision: 'revision-1',
};

test('scenario input reads only the coordinator-owned run file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ios-testing-scenario-input-'));
  const file = await writeWorkerInput(root, 'run-input', request);
  assert.deepEqual(await readScenarioRequest({ RUN_INPUT_FILE: file, WDIO_RUN_ID: 'run-input' }), request);
});

test('scenario input fails closed when the owned input contract is incomplete', async () => {
  await assert.rejects(() => readScenarioRequest({ RUN_INPUT_FILE: '/tmp/other.json', WDIO_RUN_ID: '' }), /run identity|input file/i);
  await assert.rejects(() => readScenarioRequest({ RUN_INPUT_FILE: '/tmp/other.json', WDIO_RUN_ID: 'run-input' }), /input|ENOENT/i);
});
