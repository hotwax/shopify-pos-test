import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { approveCheckpoint } from '../../core/runner/approval.ts';
import { readBridgeRequests, writeBridgeResponse } from '../../core/runner/bridge.ts';
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

test('scenario context resolves an observed POS order through the owned bridge', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ios-testing-context-'));
  const runId = 'run-context-bridge';
  const contextRunner = createScenarioContext({ root, runId, bridgeTimeoutMs: 1_000 });
  const responder = (async () => {
    const deadline = Date.now() + 1_000;
    while (Date.now() < deadline) {
      const request = (await readBridgeRequests(root, runId))[0];
      if (request) {
        await writeBridgeResponse(root, request, { ok: true, orderGid: 'gid://shopify/Order/42', orderName: '#42' });
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error('bridge request was not written');
  })();
  assert.deepEqual(await contextRunner.resolveObservedOrder({ observedName: '#42' }), { orderGid: 'gid://shopify/Order/42', orderName: '#42' });
  await responder;
});

test('scenario context reads a sanitized Shopify order through the owned bridge', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ios-testing-context-order-'));
  const runId = 'run-context-order-bridge';
  const contextRunner = createScenarioContext({ root, runId, bridgeTimeoutMs: 1_000 });
  const detail = { gid: 'gid://shopify/Order/42', legacyResourceId: '42', name: '#42', financialStatus: 'PAID', fulfillmentStatus: 'UNFULFILLED', total: { amount: '12.00', currency: 'USD' }, paymentGatewayNames: ['cash'], transactions: [], agreements: [], lines: [], nextCursor: null };
  const responder = (async () => {
    const deadline = Date.now() + 1_000;
    while (Date.now() < deadline) {
      const request = (await readBridgeRequests(root, runId))[0];
      if (request?.operation === 'readShopifyOrder') {
        await writeBridgeResponse(root, request, { ok: true, order: detail });
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error('shopify order bridge request was not written');
  })();
  assert.deepEqual(await contextRunner.readShopifyOrder('gid://shopify/Order/42'), detail);
  await responder;
});
