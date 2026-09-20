import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { OmsShopifyOrderDetail, RunRequest } from '../../shared/contracts.ts';
import type { ScenarioContext } from '../../test/support/context.ts';
import { hashIntent } from '../../core/safety/intent.ts';
import type { TransactionIntent } from '../../shared/transaction.ts';
import { exchangeCashOrder, type ExchangeOrderDriver } from '../../test/scenarios/exchange-order.ts';
import type { PosContextEvidence } from '../../core/safety/environment.ts';

const request: RunRequest = {
  scriptId: 'pos.exchange-cash-order', deviceProfileId: 'test-ipad', parameters: {}, assertionMode: 'pos-shopify-oms', expectedRevision: 'revision-exchange',
  context: { connectionId: 'local', omsOrigin: 'https://oms.example', userId: 'user-1', connectorShopId: 'shop-1', shopGid: 'gid://shopify/Shop/1', shopDomain: 'test.myshopify.com', locationGid: 'gid://shopify/Location/1', apiVersion: '2026-01' },
};
const input = { orderGid: 'gid://shopify/Order/42', lines: [{ lineGid: 'gid://shopify/LineItem/1', quantity: 1, restock: true }], maximumRefund: { amount: '20.00', currency: 'USD' }, replacements: [{ variantGid: 'gid://shopify/ProductVariant/2', quantity: 1 }], direction: 'collect' as const, maximumDifference: { amount: '20.00', currency: 'USD' } };
const before: OmsShopifyOrderDetail = {
  gid: input.orderGid, legacyResourceId: '42', name: '#42', financialStatus: 'PAID', fulfillmentStatus: 'UNFULFILLED', total: { amount: '20.00', currency: 'USD' }, paymentGatewayNames: ['cash'], transactions: [], agreements: [],
  lines: [{ gid: 'gid://shopify/LineItem/1', quantity: 2, refundableQuantity: 2, unitPrice: { amount: '10.00', currency: 'USD' }, variantGid: 'gid://shopify/ProductVariant/1', variantTitle: 'Blue', sku: 'BLUE', productGid: 'gid://shopify/Product/1', productTitle: 'Shirt' }], nextCursor: null,
};
const after: OmsShopifyOrderDetail = {
  ...before,
  lines: [{ ...before.lines[0]!, refundableQuantity: 1 }, { gid: 'gid://shopify/LineItem/2', quantity: 1, refundableQuantity: 1, unitPrice: { amount: '12.00', currency: 'USD' }, variantGid: 'gid://shopify/ProductVariant/2', variantTitle: 'Red', sku: 'RED', productGid: 'gid://shopify/Product/2', productTitle: 'Shirt' }],
  agreements: [{ id: 'gid://shopify/SalesAgreement/1', happenedAt: '2026-09-20T12:01:00Z', returnGid: 'gid://shopify/Return/1', returnName: '#R1', sales: [{ actionType: 'RETURN', lineType: 'PRODUCT', quantity: -1, amount: { amount: '-10.00', currency: 'USD' }, lineGid: before.lines[0]!.gid, variantGid: before.lines[0]!.variantGid }, { actionType: 'ORDER', lineType: 'PRODUCT', quantity: 1, amount: { amount: '12.00', currency: 'USD' }, lineGid: 'gid://shopify/LineItem/2', variantGid: 'gid://shopify/ProductVariant/2' }] }],
};

function contextFor(calls: string[]): ScenarioContext {
  return {
    step: async (name, operation) => { calls.push(name); return operation(); },
    assertAllowedIntent: async () => { calls.push('context-approved'); },
    requireApproval: async (intent: TransactionIntent) => { calls.push('approval'); return { intentHash: hashIntent(intent) }; },
    recordCommitAttempt: async () => { calls.push('commit-checkpoint'); }, recordBusinessEffect: async () => { calls.push('effect-confirmed'); },
    recordResource: async (kind, gid) => { calls.push(`resource:${kind}:${gid}`); }, checkStopped: () => undefined,
    resolveObservedOrder: async () => { throw new Error('exchange flow must not create a new order'); },
    readShopifyOrder: async orderGid => { calls.push(`read:${orderGid}`); return calls.includes('commit') ? after : before; },
  };
}

test('cash exchange verifies the approved direction and reads back both return and replacement sales', async () => {
  const calls: string[] = [];
  const driver: ExchangeOrderDriver = {
    readContextEvidence: async (): Promise<PosContextEvidence> => ({ udid: 'device-1', shopGid: request.context!.shopGid, locationGid: request.context!.locationGid, observedAt: new Date().toISOString(), method: 'test', evidenceHash: 'test-evidence', online: true }),
    prepareExchange: async () => { calls.push('prepare-exchange'); }, selectCash: async () => { calls.push('select-cash'); },
    readSummary: async () => ({ returnLines: input.lines, purchaseLines: input.replacements, netDue: { amount: '2.00', currency: 'USD' }, tender: 'cash' }),
    commitCash: async () => { calls.push('commit'); },
  };
  const result = await exchangeCashOrder(input, request, contextFor(calls), driver, 'device-1');
  assert.deepEqual(result, { sourceOrderGid: input.orderGid, affectedIds: { 'shopify-order': [input.orderGid], 'shopify-return': ['gid://shopify/Return/1'], 'shopify-agreement': ['gid://shopify/SalesAgreement/1'] }, netDue: { amount: '2.00', currency: 'USD' } });
  assert.deepEqual(calls, ['read-exchange-source', `read:${input.orderGid}`, 'verify-pos-context', 'context-approved', 'prepare-exchange-cart', 'prepare-exchange', 'select-cash-exchange', 'select-cash', 'verify-exchange-summary', 'approval', 'verify-pos-context-before-commit', 'context-approved', 'commit-checkpoint', 'commit-exchange-cash', 'commit', 'read-shopify-exchange', `read:${input.orderGid}`, 'verify-shopify-exchange', `resource:shopify-order:${input.orderGid}`, 'resource:shopify-return:gid://shopify/Return/1', 'resource:shopify-agreement:gid://shopify/SalesAgreement/1', 'effect-confirmed']);
});

test('exchange blocks direction drift before approval', async () => {
  const calls: string[] = [];
  const driver: ExchangeOrderDriver = {
    readContextEvidence: async (): Promise<PosContextEvidence> => ({ udid: 'device-1', shopGid: request.context!.shopGid, locationGid: request.context!.locationGid, observedAt: new Date().toISOString(), method: 'test', evidenceHash: 'test-evidence', online: true }),
    prepareExchange: async () => { calls.push('prepare-exchange'); }, selectCash: async () => { calls.push('select-cash'); },
    readSummary: async () => ({ returnLines: input.lines, purchaseLines: input.replacements, netDue: { amount: '-2.00', currency: 'USD' }, tender: 'cash' }), commitCash: async () => { calls.push('commit'); },
  };
  await assert.rejects(() => exchangeCashOrder(input, request, contextFor(calls), driver, 'device-1'), /direction/i);
  assert.deepEqual(calls, ['read-exchange-source', `read:${input.orderGid}`, 'verify-pos-context', 'context-approved', 'prepare-exchange-cart', 'prepare-exchange', 'select-cash-exchange', 'select-cash', 'verify-exchange-summary']);
});
