import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertCreatePrecommit, assertExchangePrecommit, assertReturnPrecommit } from '../../core/safety/transaction-flow.ts';
import type { CreateOrderParameters, ExchangeParameters, ReturnParameters } from '../../core/safety/transaction-inputs.ts';

const create: CreateOrderParameters = { lines: [{ variantGid: 'gid://shopify/ProductVariant/1', productGid: 'gid://shopify/Product/10256354705572', search: 'Test product', quantity: 1 }], currency: 'USD' };
const returned: ReturnParameters = { orderGid: 'gid://shopify/Order/1', lines: [{ lineGid: 'gid://shopify/LineItem/1', quantity: 1, restock: true, reason: 'UNKNOWN' as const }], refundMethod: 'cash' };
const exchange: ExchangeParameters = { ...returned, replacements: [{ variantGid: 'gid://shopify/ProductVariant/2', productGid: 'gid://shopify/Product/2', search: 'Replacement', quantity: 1 }], direction: 'collect', maximumDifference: { amount: '10.00', currency: 'USD' }, collectMethod: 'cash' };

test('requires the observed create cart and cash tender to match before commit', () => {
  assert.doesNotThrow(() => assertCreatePrecommit({ lines: create.lines, total: { amount: '12.00', currency: 'USD' }, tender: 'cash' }, create));
  assert.throws(() => assertCreatePrecommit({ lines: [{ variantGid: 'gid://shopify/ProductVariant/2', quantity: 1 }], total: { amount: '12.00', currency: 'USD' }, tender: 'cash' }, create), /cart|line/i);
  assert.throws(() => assertCreatePrecommit({ lines: create.lines, total: { amount: '12.00', currency: 'USD' }, tender: 'card' }, create), /cash/i);
});

test('requires exact return lines, restock choice, cash refund and bound', () => {
  assert.doesNotThrow(() => assertReturnPrecommit({ lines: returned.lines, refund: { amount: '5.00', currency: 'USD' }, tender: 'cash' }, returned));
  assert.throws(() => assertReturnPrecommit({ lines: [{ ...returned.lines[0]!, restock: false }], refund: { amount: '5.00', currency: 'USD' }, tender: 'cash' }, returned), /restock/i);
  assert.throws(() => assertReturnPrecommit({ lines: returned.lines, refund: { amount: '-1.00', currency: 'USD' }, tender: 'cash' }, returned), /negative/i);
});

test('requires exchange lines, cash and the approved actual direction', () => {
  assert.doesNotThrow(() => assertExchangePrecommit({ returnLines: exchange.lines, purchaseLines: exchange.replacements, netDue: { amount: '3.00', currency: 'USD' }, tender: 'cash' }, exchange));
  assert.throws(() => assertExchangePrecommit({ returnLines: exchange.lines, purchaseLines: exchange.replacements, netDue: { amount: '-3.00', currency: 'USD' }, tender: 'cash' }, exchange), /direction/i);
});
