import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeOrderReference, readOrderRowSummary, readRowReference } from '../screens/reference.ts';

test('reads the exact reference without customer or order status text', () => {
  assert.equal(readRowReference('#42 • Test Customer, Sep 19, Paid, $0.00'), '#42');
  assert.equal(readRowReference('WEB-42-US • Test Customer, Paid'), 'WEB-42-US');
});

for (const label of [null, '', 'Orders', ' • Customer', '#42 • A • B', 'No orders found', '#42, Sep 19, Paid']) {
  test(`rejects missing or ambiguous reference: ${JSON.stringify(label)}`, () => {
    assert.throws(() => readRowReference(label), /reference/);
  });
}

test('normalizes an explicitly selected order reference without changing its identity', () => {
  assert.equal(normalizeOrderReference('  #42  '), '#42');
  assert.equal(normalizeOrderReference('WEB-42-US'), 'WEB-42-US');
});

for (const value of ['', '   ', 'A\nB', 'A\0B', 'x'.repeat(121)]) {
  test(`rejects an unsafe explicit order reference: ${JSON.stringify(value)}`, () => {
    assert.throws(() => normalizeOrderReference(value), /order reference/i);
  });
}

test('reads the newest-order row with or without a customer, keeping the row total', () => {
  assert.deepEqual(readOrderRowSummary('HCDEV#5856, Sep 20 at 7:55 PM, Paid, Unfulfilled, $171.00'), { reference: 'HCDEV#5856', amountLabel: '$171.00' });
  assert.deepEqual(readOrderRowSummary('HCDEV#4989 • DIVYANSH BHARDWAJ, Apr 24 at 11:24 PM, Paid, Fulfilled, $240.00'), { reference: 'HCDEV#4989', amountLabel: '$240.00' });
});

for (const label of [null, '', 'Orders', '#42', '#42, Paid', '#42 • A • B, Sep 19, Paid, $1.00', '#42, Sep 19, Paid, twelve dollars', 'x'.repeat(121) + ', Sep 19, Paid, $1.00']) {
  test(`rejects an unreadable newest-order row: ${JSON.stringify(label)}`, () => {
    assert.throws(() => readOrderRowSummary(label), /row summary/);
  });
}
