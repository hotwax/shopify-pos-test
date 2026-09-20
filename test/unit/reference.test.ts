import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readRowReference } from '../screens/reference.ts';

test('reads the exact reference without customer or order status text', () => {
  assert.equal(readRowReference('#42 • Test Customer, Sep 19, Paid, $0.00'), '#42');
  assert.equal(readRowReference('WEB-42-US • Test Customer, Paid'), 'WEB-42-US');
});

for (const label of [null, '', 'Orders', ' • Customer', '#42 • A • B', 'No orders found', '#42, Sep 19, Paid']) {
  test(`rejects missing or ambiguous reference: ${JSON.stringify(label)}`, () => {
    assert.throws(() => readRowReference(label), /reference/);
  });
}
