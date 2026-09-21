import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLaunchLock, validateLaunchMode } from '../../server/session.ts';

test('accepts only the supported local launcher modes', () => {
  assert.equal(validateLaunchMode('dev'), 'dev');
  assert.equal(validateLaunchMode('serve'), 'serve');
  assert.throws(() => validateLaunchMode('shell'));
});

test('a launch lock is exclusive and releases only its own lock', async () => {
  const lock = await createLaunchLock('test');
  assert.equal(lock.acquired, true);
  const second = await createLaunchLock('test');
  assert.equal(second.acquired, false);
  assert.equal(second.owner?.mode, 'test');
  await lock.release();
  const third = await createLaunchLock('test');
  assert.equal(third.acquired, true);
  await third.release();
});
