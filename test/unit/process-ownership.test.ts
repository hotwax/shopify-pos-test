import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { test } from 'node:test';
import { findAvailablePort, spawn } from '../../core/runner/process.ts';

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

test('moves WDA to a free local port when the preferred port is occupied', async () => {
  const blocker = createServer();
  await new Promise<void>(resolve => blocker.listen(0, '127.0.0.1', resolve));
  const address = blocker.address();
  assert.equal(typeof address, 'object');
  const preferred = (address as { port: number }).port;
  const selected = await findAvailablePort(preferred);
  assert.notEqual(selected, preferred);
  assert.ok(selected >= 1024);
  await new Promise<void>((resolve, reject) => blocker.close(error => error ? reject(error) : resolve()));
});
