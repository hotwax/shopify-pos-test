import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { readMutationReadiness } from '../../core/safety/readiness.ts';

const target = {
  testOnly: true,
  connectionId: 'local',
  omsOrigin: 'https://test-maarg.hotwax.io',
  userId: 'user-1',
  connectorShopId: 'shop-1',
  shopGid: 'gid://shopify/Shop/1',
  shopDomain: 'test.myshopify.com',
  locationGid: 'gid://shopify/Location/1',
  apiVersion: '2026-01',
};

test('mutation readiness explains the missing reviewed policy and native gates', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ios-testing-readiness-'));
  const readiness = await readMutationReadiness(root);
  assert.equal(readiness.enabled, false);
  assert.ok(readiness.reasons.some(reason => /test-store allowlist/i.test(reason)));
  assert.ok(readiness.reasons.some(reason => /native POS context/i.test(reason)));
  assert.ok(readiness.reasons.some(reason => /native mutation selector/i.test(reason)));
});

test('a reviewed policy alone does not enable native mutations', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ios-testing-readiness-'));
  await mkdir(join(root, 'config'), { recursive: true });
  await writeFile(join(root, 'config', 'test-environments.json'), JSON.stringify({ schemaVersion: 1, targets: [target] }));
  const readiness = await readMutationReadiness(root);
  assert.equal(readiness.enabled, false);
  assert.ok(readiness.reasons.some(reason => /native POS context/i.test(reason)));
  assert.ok(readiness.reasons.some(reason => /native mutation selector/i.test(reason)));
  assert.ok(!readiness.reasons.some(reason => /allowlist/i.test(reason)));
});
