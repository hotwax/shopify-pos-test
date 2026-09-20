import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildOmsOrigin, instanceNameFromOrigin } from '../../ui/oms-origin.ts';

test('builds the HotWax OMS origin from a normalized instance name', () => {
  assert.equal(buildOmsOrigin('  Test-Maarg  '), 'https://test-maarg.hotwax.io');
  assert.equal(instanceNameFromOrigin('https://test-maarg.hotwax.io'), 'test-maarg');
});

test('rejects unsafe or incomplete OMS instance names', () => {
  assert.throws(() => buildOmsOrigin(''), /instance name/i);
  assert.throws(() => buildOmsOrigin('test_maarg'), /instance name/i);
  assert.throws(() => buildOmsOrigin('https://test-maarg.hotwax.io'), /instance name/i);
});
