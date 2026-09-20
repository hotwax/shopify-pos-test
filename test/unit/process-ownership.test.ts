import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from '../../core/runner/process.ts';

test('starts a child with argument arrays and terminates only the owned process group', async () => {
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30_000)'], {
    cwd: process.cwd(),
    env: { PATH: process.env.PATH ?? '' },
  });
  assert.ok(child.pid);
  await child.terminate(100);
  assert.equal(child.isAlive(), false);
});

test('rejects shell strings and environment leakage', () => {
  assert.throws(() => spawn('node; touch /tmp/unsafe', [], { cwd: process.cwd(), env: { PATH: '' } }), /executable/);
  assert.throws(() => spawn(process.execPath, ['-e', ''], { cwd: process.cwd(), env: { PATH: '', PASSWORD: 'secret' } }), /environment/);
});
