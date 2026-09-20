import assert from 'node:assert/strict';
import { test } from 'node:test';
import { configuredOmsConnections } from '../../core/oms/config.ts';

test('constructs the configured OMS origin from an instance name', () => {
  const result = configuredOmsConnections({ OMS_INSTANCE_NAME: ' Test-Maarg ' });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.connections, [{ id: 'local-oms', label: 'test-maarg', origin: 'https://test-maarg.hotwax.io' }]);
});

test('keeps the old origin environment variable as a name-only migration path', () => {
  const result = configuredOmsConnections({ OMS_ORIGIN: 'https://test-maarg.hotwax.io/' });
  assert.deepEqual(result.errors, []);
  assert.equal(result.connections[0]?.origin, 'https://test-maarg.hotwax.io');
});

test('rejects a non-HotWax configured origin instead of forwarding it', () => {
  const result = configuredOmsConnections({ OMS_ORIGIN: 'https://attacker.example' });
  assert.deepEqual(result.connections, []);
  assert.match(result.errors[0] ?? '', /OMS_INSTANCE_NAME|HotWax/i);
});
