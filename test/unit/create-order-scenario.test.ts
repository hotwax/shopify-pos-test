import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { OmsShopifyOrderDetail, RunRequest } from '../../shared/contracts.ts';
import type { ScenarioContext } from '../../test/support/context.ts';
import { confirmCashOrder, createCashOrder, createCashOrderIntent, locateCashOrderByName, locateRecentCashOrder, type CreateOrderDriver } from '../../test/scenarios/create-order.ts';
import { hashIntent } from '../../core/safety/intent.ts';
import type { PosContextEvidence } from '../../core/safety/environment.ts';

const request: RunRequest = {
  scriptId: 'pos.create-cash-order', deviceProfileId: 'test-ipad', parameters: {}, assertionMode: 'pos-shopify', expectedRevision: 'revision-create',
  context: { connectionId: 'local', omsOrigin: 'https://oms.example', userId: 'user-1', connectorShopId: 'shop-1', shopGid: 'gid://shopify/Shop/1', shopDomain: 'test.myshopify.com', locationGid: 'gid://shopify/Location/1', apiVersion: '2026-01' },
};
const input = { lines: [{ variantGid: 'gid://shopify/ProductVariant/1', productGid: 'gid://shopify/Product/10256354705572', search: 'Test product', quantity: 1 }], currency: 'USD' };
const readback: OmsShopifyOrderDetail = {
  gid: 'gid://shopify/Order/42', legacyResourceId: '42', name: '#42', financialStatus: 'PAID', fulfillmentStatus: 'UNFULFILLED', total: { amount: '12.00', currency: 'USD' }, paymentGatewayNames: ['cash'], customer: null, transactions: [], agreements: [],
  lines: [{ gid: 'gid://shopify/LineItem/42', quantity: 1, refundableQuantity: 1, unitPrice: { amount: '12.00', currency: 'USD' }, variantGid: input.lines[0]!.variantGid, variantTitle: 'Blue', sku: 'BLUE', productGid: 'gid://shopify/Product/1', productTitle: 'Shirt', hasOnlyDefaultVariant: null, productVariantCount: null }], nextCursor: null,
};

function contextFor(calls: string[]): ScenarioContext {
  return {
    step: async (name, operation) => { calls.push(name); return operation(); },
    assertAllowedIntent: async () => { calls.push('context-approved'); },
    recordCommitAttempt: async () => { calls.push('commit-checkpoint'); },
    recordBusinessEffect: async () => { calls.push('effect-confirmed'); },
    recordResource: async (_kind, gid) => { calls.push(`resource:${gid}`); },
    checkStopped: () => undefined,
    resolveObservedOrder: async () => { calls.push('correlate'); return { orderGid: 'gid://shopify/Order/42', orderName: '#42' }; },
    resolveRecentOrder: async () => { calls.push('correlate-recent'); return { orderGid: 'gid://shopify/Order/42', orderName: '#42' }; },
    readShopifyOrder: async () => { calls.push('read-shopify-order'); return readback; },
  };
}

test('create cash order checks the final cart before commit', async () => {
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
  assert.deepEqual(calls, ['verify-pos-context', 'context-approved', 'prepare-cash-order-cart', 'prepare-cart', 'select-cash-tender', 'select-cash', 'verify-create-cart', 'verify-pos-context-before-commit', 'context-approved', 'commit-checkpoint', 'commit-cash-order', 'commit', 'correlate', 'verify-shopify-create', 'read-shopify-order', 'resource:gid://shopify/Order/42', 'effect-confirmed']);
});

test('create cash order refuses a changed cart before commit', async () => {
  const calls: string[] = [];
  const driver: CreateOrderDriver = {
    readContextEvidence: async (): Promise<PosContextEvidence> => ({ udid: 'device-1', shopGid: request.context!.shopGid, locationGid: request.context!.locationGid, observedAt: new Date().toISOString(), method: 'test', evidenceHash: 'test-evidence', online: true }),
    prepareCart: async () => { calls.push('prepare-cart'); },
    selectCash: async () => { calls.push('select-cash'); },
    readSummary: async () => ({ lines: [{ variantGid: 'gid://shopify/ProductVariant/2', productGid: 'gid://shopify/Product/10256354705572', search: 'Test product', quantity: 1 }], total: { amount: '12.00', currency: 'USD' }, tender: 'cash' }),
    commitCash: async () => { calls.push('commit'); },
    readCompletedOrderName: async () => '#42',
  };
  await assert.rejects(() => createCashOrder(input, request, contextFor(calls), driver, 'device-1'), /cart|lines/i);
  assert.deepEqual(calls, ['verify-pos-context', 'context-approved', 'prepare-cash-order-cart', 'prepare-cart', 'select-cash-tender', 'select-cash', 'verify-create-cart']);
});

test('confirming a located order reads it back, records the resource and then confirms the effect, in that order', async () => {
  const calls: string[] = [];
  const intentHash = hashIntent(createCashOrderIntent(input, request, 'device-1'));
  const context = contextFor(calls);
  const order = await locateCashOrderByName(context, ' HCDEV#42 ', intentHash);
  const result = await confirmCashOrder({ parameters: input, context, intentHash, order, tender: 'cash' });
  assert.deepEqual(result, { orderGid: 'gid://shopify/Order/42', orderName: '#42' });
  assert.deepEqual(calls, ['correlate', 'verify-shopify-create', 'read-shopify-order', 'resource:gid://shopify/Order/42', 'effect-confirmed']);
});

test('a read-back that does not match the approved lines leaves the effect unconfirmed and records no resource', async () => {
  const calls: string[] = [];
  const context = { ...contextFor(calls), readShopifyOrder: async () => { calls.push('read-shopify-order'); return { ...readback, lines: [{ ...readback.lines[0]!, variantGid: 'gid://shopify/ProductVariant/999' }] }; } };
  const intentHash = hashIntent(createCashOrderIntent(input, request, 'device-1'));
  await assert.rejects(() => confirmCashOrder({ parameters: input, context, intentHash, order: { orderGid: 'gid://shopify/Order/42', orderName: '#42' }, tender: 'cash' }), /read-back failed: lines/);
  assert.deepEqual(calls, ['verify-shopify-create', 'read-shopify-order']);
});

test('an empty or oversized observed order reference is refused before any correlation', async () => {
  const calls: string[] = [];
  const intentHash = hashIntent(createCashOrderIntent(input, request, 'device-1'));
  await assert.rejects(() => locateCashOrderByName(contextFor(calls), '   ', intentHash), /order reference/);
  await assert.rejects(() => locateCashOrderByName(contextFor(calls), 'x'.repeat(121), intentHash), /order reference/);
  assert.deepEqual(calls, []);
});

test('the recent-order lookup retries a miss while Shopify catches up, but never retries an ambiguous match', async () => {
  const calls: string[] = [];
  let attempt = 0;
  const context = { ...contextFor(calls), resolveRecentOrder: async () => {
    attempt += 1;
    if (attempt < 3) throw new Error('No POS order created since 2026-09-21T01:09:38.000Z matches the tendered total 171.00 USD with 2 line(s).');
    return { orderGid: 'gid://shopify/Order/42', orderName: 'HCDEV#42' };
  } };
  const slept: number[] = [];
  const located = await locateRecentCashOrder(context, { notBefore: '2026-09-21T01:09:38.000Z', total: { amount: '171.00', currency: 'USD' }, lineCount: 2 }, { attempts: 5, delayMs: 3_000, sleep: async ms => { slept.push(ms); } });
  assert.deepEqual(located, { orderGid: 'gid://shopify/Order/42', orderName: 'HCDEV#42' });
  assert.deepEqual(slept, [3_000, 3_000]);

  let ambiguousAttempts = 0;
  const ambiguous = { ...contextFor([]), resolveRecentOrder: async () => { ambiguousAttempts += 1; throw new Error('More than one POS order created since the commit matches the tendered total; the sale must be reconciled by hand.'); } };
  await assert.rejects(() => locateRecentCashOrder(ambiguous, { notBefore: '2026-09-21T01:09:38.000Z', total: { amount: '171.00', currency: 'USD' }, lineCount: 2 }, { attempts: 5, sleep: async () => undefined }), /More than one/);
  assert.equal(ambiguousAttempts, 1);

  const missing = { ...contextFor([]), resolveRecentOrder: async () => { throw new Error('No POS order created since the commit matches.'); } };
  await assert.rejects(() => locateRecentCashOrder(missing, { notBefore: '2026-09-21T01:09:38.000Z', total: { amount: '171.00', currency: 'USD' }, lineCount: 2 }, { attempts: 3, sleep: async () => undefined }), /No POS order/);
});
