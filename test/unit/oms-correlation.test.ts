import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { OmsService } from '../../core/oms/types.ts';
import { resolveObservedOrder, resolveRecentPosOrder, resolveShopifyOrder } from '../../core/oms/correlation.ts';
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
    shops: async () => [{ connectorShopId: context.connectorShopId, shopGid: context.shopGid, shopDomain: context.shopDomain, name: 'Test', locationGid: context.locationGid, currency: 'USD', timezone: 'UTC', apiVersion: context.apiVersion }],
    searchVariants: async () => ({ items: [], nextCursor: null }),
    searchCustomers: async () => ({ items: [], nextCursor: null }),
    listPosOrders: async () => ({ items: [], nextCursor: null }),
    searchOrders: async () => ({ items: [{ gid: 'gid://shopify/Order/42', name: '#42', financialStatus: 'PAID', fulfillmentStatus: null }], nextCursor: null }),
    resolveOrder: async () => ({ gid: 'gid://shopify/Order/42', legacyResourceId: '42', name: '#42', financialStatus: 'PAID', fulfillmentStatus: null, total: null, paymentGatewayNames: [], returnStatus: null, returns: [], refunds: [], fulfillments: [], customer: null, transactions: [], agreements: [], lines: [], nextCursor: null }),
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
  const first = { gid: 'gid://shopify/Order/42', legacyResourceId: '42', name: '#42', financialStatus: 'PAID', fulfillmentStatus: null, total: { amount: '12.00', currency: 'USD' }, paymentGatewayNames: ['cash'], returnStatus: null, returns: [], refunds: [], fulfillments: [], customer: null, transactions: [], agreements: [], lines: [{ gid: 'gid://shopify/LineItem/1', quantity: 1, refundableQuantity: 1, unitPrice: null, variantGid: 'gid://shopify/ProductVariant/1', variantTitle: null, sku: null, productGid: null, productTitle: null, hasOnlyDefaultVariant: null, productVariantCount: null }], nextCursor: 'next-page' };
  const second = { ...first, lines: [{ ...first.lines[0]!, gid: 'gid://shopify/LineItem/2', variantGid: 'gid://shopify/ProductVariant/2' }], nextCursor: null };
  let calls = 0;
  const result = await resolveShopifyOrder(service({ resolveOrder: async (_connectionId, _shopId, input) => { calls += 1; return input.cursor ? second : first; } }), context, { orderGid: 'gid://shopify/Order/42' });
  assert.equal(calls, 2);
  assert.equal(result.nextCursor, null);
  assert.deepEqual(result.lines.map(line => line.gid), ['gid://shopify/LineItem/1', 'gid://shopify/LineItem/2']);
});

test('rejects a repeated order-detail cursor instead of returning partial readback', async () => {
  const page = { gid: 'gid://shopify/Order/42', legacyResourceId: '42', name: '#42', financialStatus: 'PAID', fulfillmentStatus: null, total: null, paymentGatewayNames: [], returnStatus: null, returns: [], refunds: [], fulfillments: [], customer: null, transactions: [], agreements: [], lines: [], nextCursor: 'same-page' };
  await assert.rejects(() => resolveShopifyOrder(service({ resolveOrder: async () => page }), context, { orderGid: 'gid://shopify/Order/42' }), /cursor/i);
});

const posOrder = (overrides: Partial<import('../../core/oms/types.ts').OmsPosOrder> = {}) => ({
  gid: 'gid://shopify/Order/7677415391396', name: 'HCDEV#5857', createdAt: '2026-09-21T01:09:41Z', financialStatus: 'PAID', fulfillmentStatus: null, customerName: null,
  total: { amount: '171.0', currency: 'USD' }, items: [{ title: 'White Shirt', quantity: 1 }, { title: 'Hyperion Elements Jacket', quantity: 1 }], hasMoreItems: false,
  ...overrides,
});
const saleInput = { notBefore: '2026-09-21T01:09:38.000Z', total: { amount: '171.00', currency: 'USD' }, lineCount: 2 };
const now = Date.parse('2026-09-21T01:10:00Z');

test('correlates the sale to the one POS order created since the commit with the tendered total and line count', async () => {
  const older = posOrder({ gid: 'gid://shopify/Order/7677401759908', name: 'HCDEV#5856', createdAt: '2026-09-21T00:55:32Z' });
  const result = await resolveRecentPosOrder(service({ listPosOrders: async () => ({ items: [posOrder(), older], nextCursor: null }) }), context, saleInput, now);
  assert.deepEqual(result, { orderGid: 'gid://shopify/Order/7677415391396', orderName: 'HCDEV#5857' });
});

test('an order created a little before the recorded commit time still matches, to absorb clock skew', async () => {
  const skewed = posOrder({ createdAt: '2026-09-21T01:08:30Z' });
  const result = await resolveRecentPosOrder(service({ listPosOrders: async () => ({ items: [skewed], nextCursor: null }) }), context, saleInput, now);
  assert.equal(result.orderName, 'HCDEV#5857');
});

test('a different total, a different line count, or an older order never matches', async () => {
  for (const wrong of [
    posOrder({ total: { amount: '120.0', currency: 'USD' } }),
    posOrder({ total: { amount: '171.0', currency: 'CAD' } }),
    posOrder({ items: [{ title: 'White Shirt', quantity: 1 }] }),
    posOrder({ hasMoreItems: true }),
    posOrder({ createdAt: '2026-09-21T00:55:32Z' }),
    posOrder({ createdAt: null }),
  ]) {
    await assert.rejects(() => resolveRecentPosOrder(service({ listPosOrders: async () => ({ items: [wrong], nextCursor: null }) }), context, saleInput, now), /No POS order created since/);
  }
});

test('two candidate orders with the same total since the commit are refused as ambiguous', async () => {
  const twin = posOrder({ gid: 'gid://shopify/Order/7677415391400', name: 'HCDEV#5858', createdAt: '2026-09-21T01:09:50Z' });
  await assert.rejects(() => resolveRecentPosOrder(service({ listPosOrders: async () => ({ items: [twin, posOrder()], nextCursor: null }) }), context, saleInput, now), /More than one/);
});

test('the recent-order correlation stops paging at the first order older than the window and validates its input', async () => {
  let pages = 0;
  const older = posOrder({ gid: 'gid://shopify/Order/1', name: 'HCDEV#1', createdAt: '2026-09-20T00:00:00Z' });
  const result = await resolveRecentPosOrder(service({ listPosOrders: async () => { pages += 1; return { items: [posOrder(), older], nextCursor: 'more' }; } }), context, saleInput, now);
  assert.equal(result.orderName, 'HCDEV#5857');
  assert.equal(pages, 1, 'the list is newest first, so nothing older needs reading');
  await assert.rejects(() => resolveRecentPosOrder(service(), context, { ...saleInput, notBefore: 'yesterday' }, now), /commit time/);
  await assert.rejects(() => resolveRecentPosOrder(service(), context, { ...saleInput, total: { amount: '171', currency: 'usd' } }, now), /tendered total/);
  await assert.rejects(() => resolveRecentPosOrder(service(), context, { ...saleInput, lineCount: 0 }, now), /line count/);
  await assert.rejects(() => resolveRecentPosOrder(service(), { ...context, shopGid: 'gid://shopify/Shop/other' }, saleInput, now), /shop/i);
});
