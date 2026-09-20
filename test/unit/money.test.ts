import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertWithinMaximum, compareMoney, exchangeDirection } from '../../core/safety/money.ts';

test('compares money exactly without floating-point rounding', () => {
  assert.equal(compareMoney({ amount: '10.00', currency: 'USD' }, { amount: '10', currency: 'USD' }), 0);
  assert.equal(compareMoney({ amount: '10.01', currency: 'USD' }, { amount: '10.00', currency: 'USD' }), 1);
  assert.equal(compareMoney({ amount: '-0.10', currency: 'USD' }, { amount: '0', currency: 'USD' }), -1);
  assert.throws(() => compareMoney({ amount: '1', currency: 'USD' }, { amount: '1', currency: 'EUR' }));
});

test('classifies exchange direction from the final net amount', () => {
  assert.equal(exchangeDirection({ amount: '10.00', currency: 'USD' }), 'collect');
  assert.equal(exchangeDirection({ amount: '0.00', currency: 'USD' }), 'even');
  assert.equal(exchangeDirection({ amount: '-10.00', currency: 'USD' }), 'refund');
  assert.throws(() => exchangeDirection({ amount: 'NaN', currency: 'USD' }));
});

test('enforces the approved absolute amount bound', () => {
  assertWithinMaximum({ amount: '-10.00', currency: 'USD' }, { amount: '10.00', currency: 'USD' });
  assert.throws(() => assertWithinMaximum({ amount: '10.01', currency: 'USD' }, { amount: '10.00', currency: 'USD' }));
  assert.throws(() => assertWithinMaximum({ amount: '10.00', currency: 'EUR' }, { amount: '10.00', currency: 'USD' }));
});
