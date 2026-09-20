import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { loadApprovedTargets } from '../../core/safety/policy.ts';

const target = {
  connectionId: 'local',
  omsOrigin: 'https://test-maarg.hotwax.io',
  userId: 'user-1',
  connectorShopId: 'shop-1',
  shopGid: 'gid://shopify/Shop/1',
  shopDomain: 'test.myshopify.com',
  locationGid: 'gid://shopify/Location/1',
  apiVersion: '2026-01',
};

test('loads only exact HTTPS test-store targets from the reviewed policy file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ios-testing-policy-'));
  await mkdir(join(root, 'config'), { recursive: true });
  await writeFile(join(root, 'config', 'test-environments.json'), JSON.stringify({ schemaVersion: 1, targets: [{ ...target, testOnly: true }] }));
  assert.deepEqual(await loadApprovedTargets(root), [target]);
});

test('missing or malformed environment policy fails closed', async () => {
  const missing = await mkdtemp(join(tmpdir(), 'ios-testing-policy-'));
  assert.deepEqual(await loadApprovedTargets(missing), []);

  const malformed = await mkdtemp(join(tmpdir(), 'ios-testing-policy-'));
  await mkdir(join(malformed, 'config'), { recursive: true });
  await writeFile(join(malformed, 'config', 'test-environments.json'), JSON.stringify({ schemaVersion: 1, targets: [{ ...target, testOnly: true, omsOrigin: 'http://not-https.example' }] }));
  await assert.rejects(() => loadApprovedTargets(malformed), /HTTPS|target policy/i);
});

test('duplicate target identities are rejected', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ios-testing-policy-'));
  await mkdir(join(root, 'config'), { recursive: true });
  await writeFile(join(root, 'config', 'test-environments.json'), JSON.stringify({ schemaVersion: 1, targets: [{ ...target, testOnly: true }, { ...target, testOnly: true }] }));
  await assert.rejects(() => loadApprovedTargets(root), /duplicate/i);
});

test('rejects a target that is not explicitly marked test-only', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ios-testing-policy-'));
  await mkdir(join(root, 'config'), { recursive: true });
  await writeFile(join(root, 'config', 'test-environments.json'), JSON.stringify({ schemaVersion: 1, targets: [target] }));
  await assert.rejects(() => loadApprovedTargets(root), /test-only/i);
});
