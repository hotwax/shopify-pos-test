import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildMutationParameters, buildTargetContext } from '../../ui/pos-plan.ts';

const common = {
  currency: 'USD',
  maximumDifference: '20.00',
  variantGid: 'gid://shopify/ProductVariant/1',
  productGid: 'gid://shopify/Product/10256354705572',
  search: 'Test product',
  quantity: '1',
  orderGid: 'gid://shopify/Order/42',
  lineGid: 'gid://shopify/LineItem/1',
  returnQuantity: '1',
  restock: true,
  replacementVariantGid: 'gid://shopify/ProductVariant/2',
  replacementQuantity: '1',
  direction: 'collect' as const,
  note: 'nightly POS fixture',
  orderReference: '#42',
  remaining: { 'gid://shopify/LineItem/1': 2 },
};

test('builds exact create, return, and exchange parameters from the POS form', () => {
  assert.deepEqual(buildMutationParameters({ ...common, scenario: 'pos.create-cash-order' }), {
    lines: [{ variantGid: common.variantGid, productGid: common.productGid, search: common.search, quantity: 1, variantSelection: 'unknown' }], currency: 'USD', note: common.note,
  });
  assert.deepEqual(buildMutationParameters({ ...common, scenario: 'pos.return-cash-order' }), {
    orderGid: common.orderGid, orderReference: common.orderReference, lines: [{ lineGid: common.lineGid, quantity: 1, restock: true }],
  });
  assert.deepEqual(buildMutationParameters({ ...common, scenario: 'pos.exchange-cash-order' }), {
    orderGid: common.orderGid, orderReference: common.orderReference, lines: [{ lineGid: common.lineGid, quantity: 1, restock: true }],
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

test('a multi-item cart freezes every line and still rejects a duplicate variant', () => {
  const lines = [
    { variantGid: 'gid://shopify/ProductVariant/1', productGid: 'gid://shopify/Product/10256354705572', search: 'Test product', quantity: '2' },
    { variantGid: 'gid://shopify/ProductVariant/2', productGid: 'gid://shopify/Product/10256354705572', search: 'Test product', quantity: '1' },
  ];
  assert.deepEqual(buildMutationParameters({ ...common, scenario: 'pos.create-cash-order', lines }), {
    lines: [{ variantGid: 'gid://shopify/ProductVariant/1', productGid: 'gid://shopify/Product/10256354705572', search: 'Test product', quantity: 2, variantSelection: 'unknown' }, { variantGid: 'gid://shopify/ProductVariant/2', productGid: 'gid://shopify/Product/10256354705572', search: 'Test product', quantity: 1, variantSelection: 'unknown' }],
    currency: 'USD', note: common.note,
  });

  assert.throws(() => buildMutationParameters({
    ...common, scenario: 'pos.create-cash-order',
    lines: [lines[0]!, { variantGid: 'gid://shopify/ProductVariant/1', productGid: 'gid://shopify/Product/10256354705572', search: 'Test product', quantity: '1' }],
  }), /unique|duplicate/i);
});

test('freezes the planned POS add-to-cart path of each cart line into the run parameters', () => {
  const lines = [
    { variantGid: 'gid://shopify/ProductVariant/1', productGid: 'gid://shopify/Product/10256354705572', search: 'Plain tee', quantity: '1', variantSelection: 'single' },
    { variantGid: 'gid://shopify/ProductVariant/2', productGid: 'gid://shopify/Product/10256354705573', search: 'Sized tee', quantity: '1', variantSelection: 'multi' },
  ];
  const built = buildMutationParameters({ ...common, scenario: 'pos.create-cash-order', lines }) as { lines: { variantSelection?: string }[] };
  assert.deepEqual(built.lines.map(line => line.variantSelection), ['single', 'multi']);
  assert.throws(() => buildMutationParameters({ ...common, scenario: 'pos.create-cash-order', lines: [{ ...lines[0]!, variantSelection: 'nested' }] }), /single, multi or unknown/);
});
