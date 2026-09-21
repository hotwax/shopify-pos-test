import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseStoreContextLabel } from '../../test/screens/pos.ts';

test('parses the observed POS store header without retaining staff identity', () => {
  assert.deepEqual(parseStoreContextLabel('Aditya Patel, hc-sandbox, Brooklyn, Pro'), {
    storeName: 'hc-sandbox',
    locationName: 'Brooklyn',
    plan: 'Pro',
  });
});

test('fails closed for an unrecognized or incomplete POS store header', () => {
  assert.throws(() => parseStoreContextLabel('hc-sandbox, Brooklyn'), /store context/i);
  assert.throws(() => parseStoreContextLabel('Aditya Patel, hc-sandbox, Brooklyn, Pro, extra'), /store context/i);
});
