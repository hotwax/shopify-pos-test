import assert from 'node:assert/strict';
import { mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { resolveTrustedWorkerSource } from '../../core/runner/snapshot.ts';

test('worker source manifest includes only the requested in-workspace entry and excludes local secrets', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ios-testing-snapshot-'));
  await writeFile(join(root, 'entry.ts'), 'export default 1;');
  await writeFile(join(root, '.env'), 'PASSWORD=secret');
  const manifest = await resolveTrustedWorkerSource(root, 'entry.ts');
  assert.deepEqual(manifest.files, ['entry.ts']);
  assert.deepEqual(manifest.excluded, ['.env', '.git', '.runtime', 'artifacts', '.wda']);
});

test('worker source manifest rejects a symlink or traversal outside the checkout', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ios-testing-snapshot-'));
  const outside = await mkdtemp(join(tmpdir(), 'ios-testing-snapshot-outside-'));
  await writeFile(join(outside, 'entry.ts'), 'export default 1;');
  await symlink(join(outside, 'entry.ts'), join(root, 'entry.ts'));
  await assert.rejects(() => resolveTrustedWorkerSource(root, 'entry.ts'), /outside/);
  await assert.rejects(() => resolveTrustedWorkerSource(root, '../entry.ts'), /outside|entry/);
});
