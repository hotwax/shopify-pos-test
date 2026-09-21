import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  consumeBridgeResponse,
  createObservedOrderRequest,
  createRecentOrderRequest,
  createShopifyOrderRequest,
  readBridgeRequests,
  writeBridgeResponse,
} from '../../core/runner/bridge.ts';

test('round-trips an owned observed-order bridge request and response', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ios-testing-bridge-'));
  const request = await createObservedOrderRequest(root, 'run-bridge', { observedName: '#42', runMarker: 'marker' });
  assert.deepEqual((await readBridgeRequests(root, 'run-bridge')).map(item => ({ id: item.id, observedName: item.operation === 'resolveObservedOrder' ? item.observedName : undefined })), [{ id: request.id, observedName: '#42' }]);
  await writeBridgeResponse(root, request, { ok: true, orderGid: 'gid://shopify/Order/42', orderName: '#42' });
  const response = await consumeBridgeResponse(root, request);
  assert.equal(response?.ok, true);
  assert.equal(response?.operation, 'resolveObservedOrder');
  if (response?.operation === 'resolveObservedOrder') {
    assert.equal(response.orderGid, 'gid://shopify/Order/42');
    assert.equal(response.orderName, '#42');
  }
  assert.equal(await consumeBridgeResponse(root, request), undefined);
});

test('round-trips a bounded Shopify order readback through the owned bridge', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ios-testing-bridge-order-'));
  const request = await createShopifyOrderRequest(root, 'run-order-bridge', { orderGid: 'gid://shopify/Order/42' });
  const detail = { gid: 'gid://shopify/Order/42', legacyResourceId: '42', name: '#42', financialStatus: 'PAID', fulfillmentStatus: 'UNFULFILLED', total: { amount: '12.00', currency: 'USD' }, paymentGatewayNames: ['cash'], returnStatus: null, returns: [], refunds: [], fulfillments: [], customer: null, transactions: [], agreements: [], lines: [], nextCursor: null };
  await writeBridgeResponse(root, request, { ok: true, order: detail });
  const response = await consumeBridgeResponse(root, request);
  assert.equal(response?.ok, true);
  assert.equal(response?.operation, 'readShopifyOrder');
  assert.deepEqual(response?.order, detail);
});

test('rejects unsafe bridge request data', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ios-testing-bridge-'));
  await assert.rejects(() => createObservedOrderRequest(root, '../run', { observedName: '#42' }), /identity/);
  await assert.rejects(() => createObservedOrderRequest(root, 'run-ok', { observedName: '' }), /order reference/);
});

test('round-trips an owned recent-order bridge request and rejects malformed input', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ios-testing-bridge-recent-'));
  const request = await createRecentOrderRequest(root, 'run-recent', { notBefore: '2026-09-21T01:09:38.000Z', totalAmount: '171.00', totalCurrency: 'USD', lineCount: 2 });
  const read = (await readBridgeRequests(root, 'run-recent'))[0];
  assert.equal(read?.operation, 'resolveRecentOrder');
  if (read?.operation === 'resolveRecentOrder') {
    assert.equal(read.totalAmount, '171.00');
    assert.equal(read.lineCount, 2);
  }
  await writeBridgeResponse(root, request, { ok: true, orderGid: 'gid://shopify/Order/42', orderName: 'HCDEV#42' });
  const response = await consumeBridgeResponse(root, request);
  assert.equal(response?.operation, 'resolveRecentOrder');
  if (response?.operation === 'resolveRecentOrder') assert.equal(response.orderGid, 'gid://shopify/Order/42');
  await assert.rejects(() => createRecentOrderRequest(root, 'run-recent', { notBefore: 'soon', totalAmount: '171.00', totalCurrency: 'USD', lineCount: 2 }), /commit time/);
  await assert.rejects(() => createRecentOrderRequest(root, 'run-recent', { notBefore: '2026-09-21T01:09:38.000Z', totalAmount: '$171', totalCurrency: 'USD', lineCount: 2 }), /total amount/);
  await assert.rejects(() => createRecentOrderRequest(root, 'run-recent', { notBefore: '2026-09-21T01:09:38.000Z', totalAmount: '171.00', totalCurrency: 'usd', lineCount: 2 }), /currency/);
  await assert.rejects(() => createRecentOrderRequest(root, 'run-recent', { notBefore: '2026-09-21T01:09:38.000Z', totalAmount: '171.00', totalCurrency: 'USD', lineCount: 0 }), /line count/);
});
