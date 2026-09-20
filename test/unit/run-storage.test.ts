import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createRunStorage } from '../../core/storage/runs.ts';
import { recordResource } from '../../core/runner/resources.ts';
import { createInitialRunRecord } from '../../core/runner/protocol.ts';
import type { RunRequest } from '../../shared/contracts.ts';

const request: RunRequest = {
  scriptId: 'pos.open-first-order', deviceProfileId: 'test-ipad', parameters: {},
  assertionMode: 'pos', expectedRevision: 'revision-a',
};

test('persists an append-only journal and atomically updated summary', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ios-testing-runs-'));
  const storage = createRunStorage(root);
  const initial = createInitialRunRecord('run-one', request, 'revision-a', '2026-09-20T00:00:00.000Z');
  await storage.create(initial);
  await storage.append(initial, { protocolVersion: 1, runId: 'run-one', sequence: 1, at: '2026-09-20T00:00:01.000Z', type: 'run-state', data: { state: 'running' } });
  await storage.append(await storage.get('run-one'), { protocolVersion: 1, runId: 'run-one', sequence: 2, at: '2026-09-20T00:00:02.000Z', type: 'run-state', data: { state: 'passed' } });

  const loaded = await storage.get('run-one');
  assert.equal(loaded.state, 'passed');
  assert.equal(loaded.lastSequence, 2);
  const journal = await readFile(join(root, '.runtime', 'runs', 'run-one', 'journal.ndjson'), 'utf8');
  assert.equal(journal.trim().split('\n').length, 2);
});

test('ignores only a truncated final journal record and recovers a corrupt summary', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ios-testing-runs-'));
  const storage = createRunStorage(root);
  const initial = createInitialRunRecord('run-two', request, 'revision-a', '2026-09-20T00:00:00.000Z');
  await storage.create(initial);
  await storage.append(initial, { protocolVersion: 1, runId: 'run-two', sequence: 1, at: '2026-09-20T00:00:01.000Z', type: 'run-state', data: { state: 'running' } });
  const journalPath = join(root, '.runtime', 'runs', 'run-two', 'journal.ndjson');
  await writeFile(journalPath, `${await readFile(journalPath, 'utf8')}{"protocolVersion":1,"runId":"run-two"`);
  await writeFile(join(root, '.runtime', 'runs', 'run-two', 'summary.json'), '{broken');

  const loaded = await storage.get('run-two');
  assert.equal(loaded.state, 'running');
  assert.equal(loaded.lastSequence, 1);
});

test('marks a run for reconciliation when a journal record is missing after a summary', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ios-testing-runs-'));
  const storage = createRunStorage(root);
  const initial = createInitialRunRecord('run-three', request, 'revision-a', '2026-09-20T00:00:00.000Z');
  await storage.create(initial);
  const running = await storage.append(initial, { protocolVersion: 1, runId: 'run-three', sequence: 1, at: '2026-09-20T00:00:01.000Z', type: 'run-state', data: { state: 'running' } });
  await writeFile(join(root, '.runtime', 'runs', 'run-three', 'journal.ndjson'), '');
  await writeFile(join(root, '.runtime', 'runs', 'run-three', 'summary.json'), JSON.stringify(running));

  const loaded = await storage.get('run-three');
  assert.equal(loaded.state, 'needs-reconciliation');
  assert.equal(loaded.effect, 'unknown');
});

test('hydrates durable affected resources into the run summary', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ios-testing-runs-'));
  const storage = createRunStorage(root);
  const initial = createInitialRunRecord('run-resources', request, 'source');
  await storage.create(initial);
  await recordResource(root, 'run-resources', 'order', 'gid://shopify/Order/1');
  const loaded = await storage.get('run-resources');
  assert.deepEqual(loaded.resourceIds, { order: ['gid://shopify/Order/1'] });
});
