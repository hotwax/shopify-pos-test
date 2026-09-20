import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertExchangeDirection, validateCreateOrder, validateExchange, validateReturn } from '../../core/safety/transaction-inputs.ts';

test('accepts exact cash-order variant IDs and rejects product IDs or duplicates', () => {
  assert.deepEqual(validateCreateOrder({ lines: [{ variantGid: 'gid://shopify/ProductVariant/1', quantity: 2 }], maximumTotal: { amount: '20.00', currency: 'USD' } }), {
    lines: [{ variantGid: 'gid://shopify/ProductVariant/1', quantity: 2 }], maximumTotal: { amount: '20.00', currency: 'USD' },
  });
  assert.throws(() => validateCreateOrder({ lines: [{ variantGid: 'gid://shopify/Product/1', quantity: 1 }], maximumTotal: { amount: '20.00', currency: 'USD' } }), /variant/i);
  assert.throws(() => validateCreateOrder({ lines: [{ variantGid: 'gid://shopify/ProductVariant/1', quantity: 1 }, { variantGid: 'gid://shopify/ProductVariant/1', quantity: 1 }], maximumTotal: { amount: '20.00', currency: 'USD' } }), /duplicate/i);
});

test('accepts only exact eligible return lines and bounded quantities', () => {
  const result = validateReturn({ orderGid: 'gid://shopify/Order/1', lines: [{ lineGid: 'gid://shopify/LineItem/1', quantity: 1, restock: true }], maximumRefund: { amount: '10.00', currency: 'USD' } }, { 'gid://shopify/LineItem/1': 2 });
  assert.equal(result.lines[0]?.quantity, 1);
  assert.throws(() => validateReturn({ orderGid: 'gid://shopify/Order/1', lines: [{ lineGid: 'gid://shopify/LineItem/2', quantity: 1, restock: true }], maximumRefund: { amount: '10.00', currency: 'USD' } }, { 'gid://shopify/LineItem/1': 2 }), /eligible|source/i);
  assert.throws(() => validateReturn({ orderGid: 'gid://shopify/Order/1', lines: [{ lineGid: 'gid://shopify/LineItem/1', quantity: 3, restock: true }], maximumRefund: { amount: '10.00', currency: 'USD' } }, { 'gid://shopify/LineItem/1': 2 }), /remaining/i);
});

test('requires the selected exchange direction to match the actual net amount', () => {
  const exchange = validateExchange({ orderGid: 'gid://shopify/Order/1', lines: [{ lineGid: 'gid://shopify/LineItem/1', quantity: 1, restock: true }], maximumRefund: { amount: '10.00', currency: 'USD' }, replacements: [{ variantGid: 'gid://shopify/ProductVariant/2', quantity: 1 }], direction: 'collect', maximumDifference: { amount: '10.00', currency: 'USD' } }, { 'gid://shopify/LineItem/1': 1 });
  assert.equal(exchange.direction, 'collect');
  assert.doesNotThrow(() => assertExchangeDirection({ amount: '2.00', currency: 'USD' }, 'collect', { amount: '10.00', currency: 'USD' }));
  assert.throws(() => assertExchangeDirection({ amount: '-2.00', currency: 'USD' }, 'collect', { amount: '10.00', currency: 'USD' }), /direction/i);
  assert.throws(() => assertExchangeDirection({ amount: '11.00', currency: 'USD' }, 'collect', { amount: '10.00', currency: 'USD' }), /maximum/i);
});
