import assert from 'node:assert/strict';
import { test } from 'node:test';
import { verifyCreatedOrder } from '../../core/verification/order.ts';
import type { OmsShopifyOrderDetail } from '../../shared/contracts.ts';
import type { CreateOrderParameters } from '../../core/safety/transaction-inputs.ts';

const expected: CreateOrderParameters = { lines: [{ variantGid: 'gid://shopify/ProductVariant/1', quantity: 2 }], maximumTotal: { amount: '20.00', currency: 'USD' } };
const actual: OmsShopifyOrderDetail = {
  gid: 'gid://shopify/Order/1', legacyResourceId: '1', name: '#1', financialStatus: 'PAID', fulfillmentStatus: 'UNFULFILLED', total: { amount: '18.00', currency: 'USD' }, nextCursor: null,
  lines: [{ gid: 'gid://shopify/LineItem/1', quantity: 2, refundableQuantity: 2, unitPrice: { amount: '9.00', currency: 'USD' }, variantGid: 'gid://shopify/ProductVariant/1', variantTitle: 'Blue', sku: 'BLUE', productGid: 'gid://shopify/Product/1', productTitle: 'Shirt' }],
};

test('verifies exact create-order lines, cash tender, currency and amount bound', () => {
  const result = verifyCreatedOrder(actual, expected, 'cash');
  assert.equal(result.passed, true);
  assert.ok(result.checks.every(check => check.passed));
});

test('reports mismatched lines, tender and total without claiming success', () => {
  const result = verifyCreatedOrder({ ...actual, total: { amount: '21.00', currency: 'EUR' }, lines: [{ ...actual.lines[0]!, variantGid: 'gid://shopify/ProductVariant/2' }] }, expected, 'card');
  assert.equal(result.passed, false);
  assert.ok(result.checks.some(check => check.name === 'lines' && !check.passed));
  assert.ok(result.checks.some(check => check.name === 'cash-tender' && !check.passed));
  assert.ok(result.checks.some(check => check.name === 'total' && !check.passed));
});
