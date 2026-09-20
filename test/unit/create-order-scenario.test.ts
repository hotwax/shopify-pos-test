import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { OmsShopifyOrderDetail, RunRequest } from '../../shared/contracts.ts';
import type { ScenarioContext } from '../../test/support/context.ts';
import { createCashOrder, type CreateOrderDriver } from '../../test/scenarios/create-order.ts';
import { hashIntent } from '../../core/safety/intent.ts';
import type { TransactionIntent } from '../../shared/transaction.ts';
import type { PosContextEvidence } from '../../core/safety/environment.ts';

const request: RunRequest = {
  scriptId: 'pos.create-cash-order', deviceProfileId: 'test-ipad', parameters: {}, assertionMode: 'pos-shopify', expectedRevision: 'revision-create',
  context: { connectionId: 'local', omsOrigin: 'https://oms.example', userId: 'user-1', connectorShopId: 'shop-1', shopGid: 'gid://shopify/Shop/1', shopDomain: 'test.myshopify.com', locationGid: 'gid://shopify/Location/1', apiVersion: '2026-01' },
};
const input = { lines: [{ variantGid: 'gid://shopify/ProductVariant/1', quantity: 1 }], maximumTotal: { amount: '20.00', currency: 'USD' } };
const readback: OmsShopifyOrderDetail = {
  gid: 'gid://shopify/Order/42', legacyResourceId: '42', name: '#42', financialStatus: 'PAID', fulfillmentStatus: 'UNFULFILLED', total: { amount: '12.00', currency: 'USD' }, paymentGatewayNames: ['cash'], transactions: [], agreements: [],
  lines: [{ gid: 'gid://shopify/LineItem/42', quantity: 1, refundableQuantity: 1, unitPrice: { amount: '12.00', currency: 'USD' }, variantGid: input.lines[0]!.variantGid, variantTitle: 'Blue', sku: 'BLUE', productGid: 'gid://shopify/Product/1', productTitle: 'Shirt' }], nextCursor: null,
};

function contextFor(calls: string[]): ScenarioContext {
  return {
    step: async (name, operation) => { calls.push(name); return operation(); },
    assertAllowedIntent: async () => { calls.push('context-approved'); },
    requireApproval: async (intent: TransactionIntent) => { calls.push('approval'); return { intentHash: hashIntent(intent) }; },
    recordCommitAttempt: async () => { calls.push('commit-checkpoint'); },
    recordBusinessEffect: async () => { calls.push('effect-confirmed'); },
    recordResource: async (_kind, gid) => { calls.push(`resource:${gid}`); },
    checkStopped: () => undefined,
    resolveObservedOrder: async () => { calls.push('correlate'); return { orderGid: 'gid://shopify/Order/42', orderName: '#42' }; },
    readShopifyOrder: async () => { calls.push('read-shopify-order'); return readback; },
  };
}

test('create cash order checks the final cart before approval and commit', async () => {
  const calls: string[] = [];
  const driver: CreateOrderDriver = {
    readContextEvidence: async (): Promise<PosContextEvidence> => ({ udid: 'device-1', shopGid: request.context!.shopGid, locationGid: request.context!.locationGid, observedAt: new Date().toISOString(), method: 'test', evidenceHash: 'test-evidence', online: true }),
    prepareCart: async () => { calls.push('prepare-cart'); },
    selectCash: async () => { calls.push('select-cash'); },
    readSummary: async () => ({ lines: input.lines, total: { amount: '12.00', currency: 'USD' }, tender: 'cash' }),
    commitCash: async () => { calls.push('commit'); },
    readCompletedOrderName: async () => '#42',
  };
  const result = await createCashOrder(input, request, contextFor(calls), driver, 'device-1');
  assert.deepEqual(result, { orderGid: 'gid://shopify/Order/42', orderName: '#42' });
  assert.deepEqual(calls, ['verify-pos-context', 'context-approved', 'prepare-cash-order-cart', 'prepare-cart', 'select-cash-tender', 'select-cash', 'verify-create-cart', 'approval', 'commit-checkpoint', 'commit-cash-order', 'commit', 'correlate', 'verify-shopify-create', 'read-shopify-order', 'resource:gid://shopify/Order/42', 'effect-confirmed']);
});

test('create cash order refuses a changed cart before approval or commit', async () => {
  const calls: string[] = [];
  const driver: CreateOrderDriver = {
    readContextEvidence: async (): Promise<PosContextEvidence> => ({ udid: 'device-1', shopGid: request.context!.shopGid, locationGid: request.context!.locationGid, observedAt: new Date().toISOString(), method: 'test', evidenceHash: 'test-evidence', online: true }),
    prepareCart: async () => { calls.push('prepare-cart'); },
    selectCash: async () => { calls.push('select-cash'); },
    readSummary: async () => ({ lines: [{ variantGid: 'gid://shopify/ProductVariant/2', quantity: 1 }], total: { amount: '12.00', currency: 'USD' }, tender: 'cash' }),
    commitCash: async () => { calls.push('commit'); },
    readCompletedOrderName: async () => '#42',
  };
  await assert.rejects(() => createCashOrder(input, request, contextFor(calls), driver, 'device-1'), /cart|lines/i);
  assert.deepEqual(calls, ['verify-pos-context', 'context-approved', 'prepare-cash-order-cart', 'prepare-cart', 'select-cash-tender', 'select-cash', 'verify-create-cart']);
});
