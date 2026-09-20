import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  consumeBridgeResponse,
  createObservedOrderRequest,
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
  const detail = { gid: 'gid://shopify/Order/42', legacyResourceId: '42', name: '#42', financialStatus: 'PAID', fulfillmentStatus: 'UNFULFILLED', total: { amount: '12.00', currency: 'USD' }, paymentGatewayNames: ['cash'], transactions: [], agreements: [], lines: [], nextCursor: null };
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
