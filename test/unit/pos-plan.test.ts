import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildMutationParameters, buildTargetContext } from '../../ui/pos-plan.ts';

const common = {
  currency: 'USD',
  maximumTotal: '20.00',
  maximumRefund: '20.00',
  maximumDifference: '20.00',
  variantGid: 'gid://shopify/ProductVariant/1',
  quantity: '1',
  orderGid: 'gid://shopify/Order/42',
  lineGid: 'gid://shopify/LineItem/1',
  returnQuantity: '1',
  restock: true,
  replacementVariantGid: 'gid://shopify/ProductVariant/2',
  replacementQuantity: '1',
  direction: 'collect' as const,
  note: 'nightly POS fixture',
  remaining: { 'gid://shopify/LineItem/1': 2 },
};

test('builds exact create, return, and exchange parameters from the POS form', () => {
  assert.deepEqual(buildMutationParameters({ ...common, scenario: 'pos.create-cash-order' }), {
    lines: [{ variantGid: common.variantGid, quantity: 1 }], maximumTotal: { amount: '20.00', currency: 'USD' }, note: common.note,
  });
  assert.deepEqual(buildMutationParameters({ ...common, scenario: 'pos.return-cash-order' }), {
    orderGid: common.orderGid, lines: [{ lineGid: common.lineGid, quantity: 1, restock: true }], maximumRefund: { amount: '20.00', currency: 'USD' },
  });
  assert.deepEqual(buildMutationParameters({ ...common, scenario: 'pos.exchange-cash-order' }), {
    orderGid: common.orderGid, lines: [{ lineGid: common.lineGid, quantity: 1, restock: true }], maximumRefund: { amount: '20.00', currency: 'USD' },
    replacements: [{ variantGid: common.replacementVariantGid, quantity: 1 }], direction: 'collect', maximumDifference: { amount: '20.00', currency: 'USD' },
  });
});

test('rejects malformed or ineligible operator input before a run request is built', () => {
  assert.throws(() => buildMutationParameters({ ...common, scenario: 'pos.create-cash-order', variantGid: 'gid://shopify/Product/1' }), /variant/i);
  assert.throws(() => buildMutationParameters({ ...common, scenario: 'pos.return-cash-order', returnQuantity: '3' }), /eligible|quantity/i);
  assert.throws(() => buildMutationParameters({ ...common, scenario: 'pos.exchange-cash-order', direction: 'refund', maximumDifference: 'bad' }), /money|amount|maximum/i);
});

test('builds the exact frozen target context used by the runner', () => {
  assert.deepEqual(buildTargetContext({
    connectionId: 'local-oms', omsOrigin: 'https://test-maarg.hotwax.io', userId: 'aditya', connectorShopId: 'shop-1',
    shopGid: 'gid://shopify/Shop/1', shopDomain: 'sandbox.myshopify.com', locationGid: 'gid://shopify/Location/1', apiVersion: '2026-01',
  }), {
    connectionId: 'local-oms', omsOrigin: 'https://test-maarg.hotwax.io', userId: 'aditya', connectorShopId: 'shop-1',
    shopGid: 'gid://shopify/Shop/1', shopDomain: 'sandbox.myshopify.com', locationGid: 'gid://shopify/Location/1', apiVersion: '2026-01',
  });
});
