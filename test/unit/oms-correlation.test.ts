import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { OmsService } from '../../core/oms/types.ts';
import { resolveObservedOrder, resolveShopifyOrder } from '../../core/oms/correlation.ts';
import type { TargetContext } from '../../shared/contracts.ts';

const context: TargetContext = {
  connectionId: 'local',
  omsOrigin: 'https://oms.example',
  userId: 'user-1',
  connectorShopId: 'shop-1',
  shopGid: 'gid://shopify/Shop/1',
  shopDomain: 'test.myshopify.com',
  locationGid: 'gid://shopify/Location/1',
  apiVersion: '2026-01',
};

function service(overrides: Partial<OmsService> = {}): OmsService {
  return {
    connections: () => [{ id: 'local', label: 'Test', origin: context.omsOrigin, state: 'connected', userId: context.userId }],
    login: async () => ({ id: 'local', label: 'Test', origin: context.omsOrigin, state: 'connected', userId: context.userId }),
    logout: async () => undefined,
    shops: async () => [{ connectorShopId: context.connectorShopId, shopGid: context.shopGid, shopDomain: context.shopDomain, name: 'Test', locationGid: context.locationGid, currency: 'USD', timezone: 'UTC' }],
    searchVariants: async () => ({ items: [], nextCursor: null }),
    searchOrders: async () => ({ items: [{ gid: 'gid://shopify/Order/42', name: '#42', financialStatus: 'PAID', fulfillmentStatus: null }], nextCursor: null }),
    resolveOrder: async () => ({ gid: 'gid://shopify/Order/42', legacyResourceId: '42', name: '#42', financialStatus: 'PAID', fulfillmentStatus: null, total: null, paymentGatewayNames: [], transactions: [], agreements: [], lines: [], nextCursor: null }),
    searchOrderRecords: async () => ({ items: [], nextCursor: null }),
    getOrderDetail: async () => ({ orderId: '42', orderName: '#42', externalId: null, statusId: null, orderDate: null, grandTotal: null, currency: null, items: [] }),
    listLocations: async () => ({ items: [], nextCursor: null }),
    ...overrides,
  };
}

test('resolves one exact observed order within the frozen OMS shop context', async () => {
  assert.deepEqual(await resolveObservedOrder(service(), context, { observedName: '#42' }), { orderGid: 'gid://shopify/Order/42', orderName: '#42' });
});

test('rejects ambiguous, missing, or mismatched shop/order context', async () => {
  await assert.rejects(() => resolveObservedOrder(service({ searchOrders: async () => ({ items: [{ gid: 'gid://shopify/Order/1', name: '#42', financialStatus: null, fulfillmentStatus: null }, { gid: 'gid://shopify/Order/2', name: '#42', financialStatus: null, fulfillmentStatus: null }], nextCursor: null }) }), context, { observedName: '#42' }), /ambiguous/i);
  await assert.rejects(() => resolveObservedOrder(service({ searchOrders: async () => ({ items: [], nextCursor: null }) }), context, { observedName: '#99' }), /not found/i);
  await assert.rejects(() => resolveObservedOrder(service(), { ...context, shopGid: 'gid://shopify/Shop/other' }, { observedName: '#42' }), /shop/i);
  await assert.rejects(() => resolveObservedOrder(service(), { ...context, userId: 'other' }, { observedName: '#42' }), /session/i);
});

test('reads a complete exact Shopify order through the frozen shop context', async () => {
  const first = { gid: 'gid://shopify/Order/42', legacyResourceId: '42', name: '#42', financialStatus: 'PAID', fulfillmentStatus: null, total: { amount: '12.00', currency: 'USD' }, paymentGatewayNames: ['cash'], transactions: [], agreements: [], lines: [{ gid: 'gid://shopify/LineItem/1', quantity: 1, refundableQuantity: 1, unitPrice: null, variantGid: 'gid://shopify/ProductVariant/1', variantTitle: null, sku: null, productGid: null, productTitle: null }], nextCursor: 'next-page' };
  const second = { ...first, lines: [{ ...first.lines[0]!, gid: 'gid://shopify/LineItem/2', variantGid: 'gid://shopify/ProductVariant/2' }], nextCursor: null };
  let calls = 0;
  const result = await resolveShopifyOrder(service({ resolveOrder: async (_connectionId, _shopId, input) => { calls += 1; return input.cursor ? second : first; } }), context, { orderGid: 'gid://shopify/Order/42' });
  assert.equal(calls, 2);
  assert.equal(result.nextCursor, null);
  assert.deepEqual(result.lines.map(line => line.gid), ['gid://shopify/LineItem/1', 'gid://shopify/LineItem/2']);
});

test('rejects a repeated order-detail cursor instead of returning partial readback', async () => {
  const page = { gid: 'gid://shopify/Order/42', legacyResourceId: '42', name: '#42', financialStatus: 'PAID', fulfillmentStatus: null, total: null, paymentGatewayNames: [], transactions: [], agreements: [], lines: [], nextCursor: 'same-page' };
  await assert.rejects(() => resolveShopifyOrder(service({ resolveOrder: async () => page }), context, { orderGid: 'gid://shopify/Order/42' }), /cursor/i);
});
