import assert from 'node:assert/strict';
import { test } from 'node:test';
import { verifyCreatedOrder, verifyExchangedOrder, verifyReturnedOrder } from '../../core/verification/order.ts';
import type { OmsShopifyOrderDetail } from '../../shared/contracts.ts';
import type { CreateOrderParameters, ExchangeParameters, ReturnParameters } from '../../core/safety/transaction-inputs.ts';

const expected: CreateOrderParameters = { lines: [{ variantGid: 'gid://shopify/ProductVariant/1', productGid: 'gid://shopify/Product/10256354705572', search: 'Test product', quantity: 2 }], currency: 'USD' };
const actual: OmsShopifyOrderDetail = {
  gid: 'gid://shopify/Order/1', legacyResourceId: '1', name: '#1', financialStatus: 'PAID', fulfillmentStatus: 'UNFULFILLED', total: { amount: '18.00', currency: 'USD' }, paymentGatewayNames: ['cash'], returnStatus: null, returns: [], refunds: [], fulfillments: [], customer: null, transactions: [], agreements: [], nextCursor: null,
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
  returnStatus: 'RETURNED',
  returns: [{ gid: 'gid://shopify/Return/1', name: '#R1', status: 'CLOSED', totalQuantity: 1, lines: [{ gid: 'gid://shopify/ReturnLineItem/1', quantity: 1, reason: 'UNKNOWN', reasonNote: null, customerNote: null, lineGid: actual.lines[0]!.gid }] }],
  refunds: [{ gid: 'gid://shopify/Refund/1', createdAt: '2026-09-20T12:01:00Z', total: { amount: '9.00', currency: 'USD' }, lines: [{ quantity: 1, restockType: 'RETURN', lineGid: actual.lines[0]!.gid }], transactions: [{ id: 'gid://shopify/OrderTransaction/9', kind: 'REFUND', status: 'SUCCESS', gateway: 'cash', amount: { amount: '9.00', currency: 'USD' } }] }],
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

const exchangeBase: ExchangeParameters = { ...returnParameters, replacements: [{ variantGid: 'gid://shopify/ProductVariant/2', productGid: 'gid://shopify/Product/2', search: 'Replacement', quantity: 1 }], direction: 'collect', maximumDifference: { amount: '20.00', currency: 'USD' }, collectMethod: 'cash' };
const exchangeAfter: OmsShopifyOrderDetail = {
  ...returned,
  lines: [...returned.lines, { ...actual.lines[0]!, gid: 'gid://shopify/LineItem/2', variantGid: 'gid://shopify/ProductVariant/2', refundableQuantity: 1 }],
  agreements: [{ ...returned.agreements[0]! , sales: [...returned.agreements[0]!.sales, { actionType: 'ORDER', lineType: 'PRODUCT', quantity: 1, amount: { amount: '12.00', currency: 'USD' }, lineGid: 'gid://shopify/LineItem/2', variantGid: 'gid://shopify/ProductVariant/2' }] }],
};

test('verifies replacement variants for an exchange read-back', () => {
  const result = verifyExchangedOrder(actual, exchangeAfter, exchangeBase);
  assert.equal(result.passed, true);
});

test('a wrong restock type, reason or refund tender fails the return read-back', () => {
  const noRestock = { ...returned, refunds: [{ ...returned.refunds[0]!, lines: [{ quantity: 1, restockType: 'NO_RESTOCK', lineGid: actual.lines[0]!.gid }] }] };
  const failed = verifyReturnedOrder(actual, noRestock, returnParameters);
  assert.equal(failed.passed, false);
  assert.deepEqual(failed.checks.filter(c => !c.passed).map(c => c.name), ['restock']);

  const wrongReason = { ...returned, returns: [{ ...returned.returns[0]!, lines: [{ ...returned.returns[0]!.lines[0]!, reason: 'DEFECTIVE' }] }] };
  assert.deepEqual(verifyReturnedOrder(actual, wrongReason, returnParameters).checks.filter(c => !c.passed).map(c => c.name), ['return-reason']);

  const wrongTender = { ...returned, refunds: [{ ...returned.refunds[0]!, transactions: [{ ...returned.refunds[0]!.transactions[0]!, gateway: 'gift_card' }] }] };
  assert.deepEqual(verifyReturnedOrder(actual, wrongTender, returnParameters).checks.filter(c => !c.passed).map(c => c.name), ['refund-method']);

  const toGiftCard = { ...returnParameters, refundMethod: 'gift-card' as const };
  assert.equal(verifyReturnedOrder(actual, wrongTender, toGiftCard).checks.find(c => c.name === 'refund-method')?.passed, true);
});

test('a return with no refund or no attributable return line is reported, never passed on absence', () => {
  const noEvidence = { ...returned, returns: [], refunds: [] };
  const result = verifyReturnedOrder(actual, noEvidence, returnParameters);
  assert.equal(result.passed, false);
  assert.deepEqual(result.checks.filter(c => !c.passed).map(c => c.name).sort(), ['refund-method', 'restock', 'return-reason']);

  const unverifiedLine = { ...returned, returns: [{ ...returned.returns[0]!, lines: [{ ...returned.returns[0]!.lines[0]!, lineGid: null }] }] };
  assert.equal(verifyReturnedOrder(actual, unverifiedLine, returnParameters).checks.find(c => c.name === 'return-reason')?.passed, false);
});

test('an even or collect exchange is not judged on refund evidence it cannot have', () => {
  const evenExchange = { ...exchangeBase, direction: 'even' as const, maximumDifference: { amount: '0', currency: 'USD' } };
  const names = verifyExchangedOrder(actual, exchangeAfter, evenExchange).checks.map(c => c.name);
  assert.equal(names.includes('refund-method'), false, 'no money goes back, so there is no refund tender to prove');
  assert.equal(names.includes('restock'), false, 'and no refund line carrying restockType');
  assert.equal(names.includes('return-lines'), true, 'but the returned lines are still proven');
  assert.equal(names.includes('exchange-lines'), true);
});
