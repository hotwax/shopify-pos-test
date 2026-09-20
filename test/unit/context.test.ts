import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { approveCheckpoint } from '../../core/runner/approval.ts';
import { hashIntent } from '../../core/safety/intent.ts';
import { createScenarioContext } from '../../test/support/context.ts';
import type { TargetContext } from '../../shared/contracts.ts';
import type { TransactionIntent } from '../../shared/transaction.ts';

const context: TargetContext = {
  connectionId: 'local', omsOrigin: 'https://oms.example', userId: 'user-1', connectorShopId: 'shop-1',
  shopGid: 'gid://shopify/Shop/1', shopDomain: 'test.myshopify.com', locationGid: 'gid://shopify/Location/1', apiVersion: '2026-01',
};
const intent: TransactionIntent = {
  scenario: 'create-cash-order', sourceHash: 'source-1', udid: 'device-1', context,
  purchaseLines: [{ variantGid: 'gid://shopify/ProductVariant/1', quantity: 1 }], returnLines: [],
  tender: 'cash', expectedDirection: 'collect', maximumAbsoluteAmount: { amount: '12.00', currency: 'USD' },
};

test('scenario approval waits for the exact one-time checkpoint', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ios-testing-context-'));
  const runId = 'run-context';
  const pending = createScenarioContext({ root, runId }).requireApproval(intent);
  setTimeout(() => { void approveCheckpoint(root, runId, hashIntent(intent)); }, 25);
  assert.deepEqual(await pending, { intentHash: hashIntent(intent) });
});
