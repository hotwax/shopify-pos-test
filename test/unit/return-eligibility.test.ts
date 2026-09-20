import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readReturnEligibility } from '../../core/verification/return-eligibility.ts';
import type { OmsShopifyOrderDetail } from '../../shared/contracts.ts';

const order: OmsShopifyOrderDetail = {
  gid: 'gid://shopify/Order/1', legacyResourceId: '1', name: '#1', financialStatus: 'PAID', fulfillmentStatus: 'UNFULFILLED', total: { amount: '10.00', currency: 'USD' }, nextCursor: null,
  lines: [
    { gid: 'gid://shopify/LineItem/1', quantity: 2, refundableQuantity: 1, unitPrice: { amount: '5.00', currency: 'USD' }, variantGid: 'gid://shopify/ProductVariant/1', variantTitle: 'Blue', sku: 'BLUE', productGid: 'gid://shopify/Product/1', productTitle: 'Shirt' },
    { gid: 'gid://shopify/LineItem/2', quantity: 1, refundableQuantity: 0, unitPrice: { amount: '5.00', currency: 'USD' }, variantGid: 'gid://shopify/ProductVariant/2', variantTitle: 'Red', sku: 'RED', productGid: 'gid://shopify/Product/2', productTitle: 'Shirt' },
  ],
};

test('returns only Shopify-provided remaining refundable quantities for a fully loaded cash order', () => {
  assert.deepEqual(readReturnEligibility(order, 'cash'), {
    eligible: true,
    reasons: [],
    tender: 'cash',
    lines: [{ lineGid: 'gid://shopify/LineItem/1', remaining: 1 }],
  });
});

test('blocks unknown tender, incomplete pagination and no refundable lines', () => {
  assert.equal(readReturnEligibility(order, 'unknown').eligible, false);
  assert.match(readReturnEligibility(order, 'card').reasons.join(' '), /cash/i);
  assert.match(readReturnEligibility({ ...order, nextCursor: 'more' }, 'cash').reasons.join(' '), /load/i);
  assert.match(readReturnEligibility({ ...order, lines: order.lines.map(line => ({ ...line, refundableQuantity: 0 })) }, 'cash').reasons.join(' '), /eligible/i);
});

test('does not infer eligibility from impossible or missing quantities', () => {
  const result = readReturnEligibility({ ...order, lines: [{ ...order.lines[0]!, quantity: 1, refundableQuantity: 2 }] }, 'cash');
  assert.equal(result.eligible, false);
  assert.match(result.reasons.join(' '), /invalid/i);
});
