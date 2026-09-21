import assert from 'node:assert/strict';
import { test } from 'node:test';
import { verifyCreatedOrder, verifyExchangedOrder, verifyReturnedOrder } from '../../core/verification/order.ts';
import type { OmsShopifyOrderDetail } from '../../shared/contracts.ts';
import type { CreateOrderParameters, ExchangeParameters, ReturnParameters } from '../../core/safety/transaction-inputs.ts';

const expected: CreateOrderParameters = { lines: [{ variantGid: 'gid://shopify/ProductVariant/1', productGid: 'gid://shopify/Product/10256354705572', search: 'Test product', quantity: 2 }], currency: 'USD' };
const actual: OmsShopifyOrderDetail = {
  gid: 'gid://shopify/Order/1', legacyResourceId: '1', name: '#1', financialStatus: 'PAID', fulfillmentStatus: 'UNFULFILLED', total: { amount: '18.00', currency: 'USD' }, paymentGatewayNames: ['cash'], customer: null, transactions: [], agreements: [], nextCursor: null,
  lines: [{ gid: 'gid://shopify/LineItem/1', quantity: 2, refundableQuantity: 2, unitPrice: { amount: '9.00', currency: 'USD' }, variantGid: 'gid://shopify/ProductVariant/1', variantTitle: 'Blue', sku: 'BLUE', productGid: 'gid://shopify/Product/1', productTitle: 'Shirt', hasOnlyDefaultVariant: null, productVariantCount: null }],
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

test('requires Shopify read-back to identify the cash gateway', () => {
  const result = verifyCreatedOrder({ ...actual, paymentGatewayNames: ['credit_card'] }, expected, 'cash');
  assert.equal(result.passed, false);
  assert.ok(result.checks.some(check => check.name === 'cash-tender' && !check.passed));
});

const returnParameters: ReturnParameters = {
  orderGid: actual.gid,
  lines: [{ lineGid: actual.lines[0]!.gid, quantity: 1, restock: true, reason: 'UNKNOWN' }],
  refundMethod: 'cash',
};

const returned: OmsShopifyOrderDetail = {
  ...actual,
  lines: [{ ...actual.lines[0]!, refundableQuantity: 1 }],
  agreements: [{ id: 'gid://shopify/SalesAgreement/1', happenedAt: '2026-09-20T12:01:00Z', returnGid: 'gid://shopify/Return/1', returnName: '#R1', sales: [{ actionType: 'RETURN', lineType: 'PRODUCT', quantity: -1, amount: { amount: '-9.00', currency: 'USD' }, lineGid: actual.lines[0]!.gid, variantGid: actual.lines[0]!.variantGid }] }],
};

test('verifies a cash return by exact refundable delta and new return agreement', () => {
  const result = verifyReturnedOrder(actual, returned, returnParameters);
  assert.equal(result.passed, true);
});

test('rejects a return read-back with no exact line delta', () => {
  const result = verifyReturnedOrder(actual, { ...returned, lines: actual.lines, agreements: [] }, returnParameters);
  assert.equal(result.passed, false);
  assert.ok(result.checks.some(check => check.name === 'return-lines' && !check.passed));
});

test('verifies replacement variants for an exchange read-back', () => {
  const exchange: ExchangeParameters = { ...returnParameters, replacements: [{ variantGid: 'gid://shopify/ProductVariant/2', productGid: 'gid://shopify/Product/2', search: 'Replacement', quantity: 1 }], direction: 'collect', maximumDifference: { amount: '20.00', currency: 'USD' }, collectMethod: 'cash' };
  const after: OmsShopifyOrderDetail = {
    ...returned,
    lines: [...returned.lines, { ...actual.lines[0]!, gid: 'gid://shopify/LineItem/2', variantGid: 'gid://shopify/ProductVariant/2', refundableQuantity: 1 }],
    agreements: [{ ...returned.agreements[0]! , sales: [...returned.agreements[0]!.sales, { actionType: 'ORDER', lineType: 'PRODUCT', quantity: 1, amount: { amount: '12.00', currency: 'USD' }, lineGid: 'gid://shopify/LineItem/2', variantGid: 'gid://shopify/ProductVariant/2' }] }],
  };
  const result = verifyExchangedOrder(actual, after, exchange);
  assert.equal(result.passed, true);
});
