import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { copyFileTail } from '../../core/runner/process.ts';

test('copies only the bytes written since the run started into the run artifact log', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ios-testing-log-slice-'));
  const shared = join(root, 'server.log');
  await writeFile(shared, 'earlier run\n');
  const base = Buffer.byteLength('earlier run\n');
  await writeFile(shared, 'earlier run\nthis run line 1\nthis run line 2\n');
  const target = join(root, 'wdio-appium.log');
  const copied = await copyFileTail(shared, base, target);
  assert.equal(await readFile(target, 'utf8'), 'this run line 1\nthis run line 2\n');
  assert.equal(copied, Buffer.byteLength('this run line 1\nthis run line 2\n'));
});

test('a missing shared log yields an empty artifact log, and the copy is bounded', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ios-testing-log-slice-'));
  const target = join(root, 'wdio-appium.log');
  assert.equal(await copyFileTail(join(root, 'absent.log'), 0, target), 0);
  assert.equal(await readFile(target, 'utf8'), '');
  const shared = join(root, 'server.log');
  await writeFile(shared, 'x'.repeat(100));
  assert.equal(await copyFileTail(shared, 20, target, 30), 30);
  await assert.rejects(() => copyFileTail(shared, -1, target), /offset/);
});
