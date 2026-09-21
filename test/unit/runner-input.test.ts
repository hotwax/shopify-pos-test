import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { RunRequest } from '../../shared/contracts.ts';
import { readWorkerInput, writeWorkerInput } from '../../core/runner/input.ts';

const request: RunRequest = {
  scriptId: 'pos.create-cash-order',
  deviceProfileId: 'test-ipad',
  parameters: { lines: [{ variantGid: 'gid://shopify/ProductVariant/1', quantity: 1 }], currency: 'USD' },
  assertionMode: 'pos-shopify',
  expectedRevision: 'revision-1',
};

test('writes a bounded worker input file and reloads the exact request', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ios-testing-worker-input-'));
  const file = await writeWorkerInput(root, 'run-input', request);
  assert.match(file, /\.runtime\/runs\/run-input\/worker-input\.json$/);
  assert.deepEqual(await readWorkerInput(file, 'run-input'), request);
  const stat = await readFile(file, 'utf8');
  assert.match(stat, /ProductVariant\/1/);
  assert.doesNotMatch(stat, /password|token|secret/i);
});

test('rejects secret-looking worker parameters before writing them', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ios-testing-worker-input-'));
  await assert.rejects(() => writeWorkerInput(root, 'run-input', { ...request, parameters: { password: 'not-written' } }), /secret|credential|parameter/i);
});
