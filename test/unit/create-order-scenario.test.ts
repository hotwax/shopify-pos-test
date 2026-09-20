import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { RunRequest } from '../../shared/contracts.ts';
import type { ScenarioContext } from '../../test/support/context.ts';
import { createCashOrder, type CreateOrderDriver } from '../../test/scenarios/create-order.ts';
import { hashIntent } from '../../core/safety/intent.ts';
import type { TransactionIntent } from '../../shared/transaction.ts';

const request: RunRequest = {
  scriptId: 'pos.create-cash-order', deviceProfileId: 'test-ipad', parameters: {}, assertionMode: 'pos-shopify', expectedRevision: 'revision-create',
  context: { connectionId: 'local', omsOrigin: 'https://oms.example', userId: 'user-1', connectorShopId: 'shop-1', shopGid: 'gid://shopify/Shop/1', shopDomain: 'test.myshopify.com', locationGid: 'gid://shopify/Location/1', apiVersion: '2026-01' },
};
const input = { lines: [{ variantGid: 'gid://shopify/ProductVariant/1', quantity: 1 }], maximumTotal: { amount: '20.00', currency: 'USD' } };

function contextFor(calls: string[]): ScenarioContext {
  return {
    step: async (name, operation) => { calls.push(name); return operation(); },
    requireApproval: async (intent: TransactionIntent) => { calls.push('approval'); return { intentHash: hashIntent(intent) }; },
    recordCommitAttempt: async () => { calls.push('commit-checkpoint'); },
    recordBusinessEffect: async () => { calls.push('effect-confirmed'); },
    recordResource: async (_kind, gid) => { calls.push(`resource:${gid}`); },
    checkStopped: () => undefined,
    resolveObservedOrder: async () => { calls.push('correlate'); return { orderGid: 'gid://shopify/Order/42', orderName: '#42' }; },
  };
}

test('create cash order checks the final cart before approval and commit', async () => {
  const calls: string[] = [];
  const driver: CreateOrderDriver = {
    prepareCart: async () => { calls.push('prepare-cart'); },
    selectCash: async () => { calls.push('select-cash'); },
    readSummary: async () => ({ lines: input.lines, total: { amount: '12.00', currency: 'USD' }, tender: 'cash' }),
    commitCash: async () => { calls.push('commit'); },
    readCompletedOrderName: async () => '#42',
  };
  const result = await createCashOrder(input, request, contextFor(calls), driver, 'device-1');
  assert.deepEqual(result, { orderGid: 'gid://shopify/Order/42', orderName: '#42' });
  assert.deepEqual(calls, ['prepare-cash-order-cart', 'prepare-cart', 'select-cash-tender', 'select-cash', 'verify-create-cart', 'approval', 'commit-checkpoint', 'commit-cash-order', 'commit', 'correlate', 'resource:gid://shopify/Order/42', 'effect-confirmed']);
});

test('create cash order refuses a changed cart before approval or commit', async () => {
  const calls: string[] = [];
  const driver: CreateOrderDriver = {
    prepareCart: async () => { calls.push('prepare-cart'); },
    selectCash: async () => { calls.push('select-cash'); },
    readSummary: async () => ({ lines: [{ variantGid: 'gid://shopify/ProductVariant/2', quantity: 1 }], total: { amount: '12.00', currency: 'USD' }, tender: 'cash' }),
    commitCash: async () => { calls.push('commit'); },
    readCompletedOrderName: async () => '#42',
  };
  await assert.rejects(() => createCashOrder(input, request, contextFor(calls), driver, 'device-1'), /cart|lines/i);
  assert.deepEqual(calls, ['prepare-cash-order-cart', 'prepare-cart', 'select-cash-tender', 'select-cash', 'verify-create-cart']);
});
