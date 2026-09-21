import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaultReturnReason, describeReturnReason, isReturnReason, posLabelForReason, reasonForPosLabel, returnReasons } from '../../shared/return-reason.ts';

test('the reason list is exactly the ten Shopify ReturnReason enum values', () => {
  // Read by GraphQL introspection against the live OMS proxy on 2026-09-21.
  assert.deepEqual([...returnReasons].sort(), [
    'COLOR', 'DEFECTIVE', 'NOT_AS_DESCRIBED', 'OTHER', 'SIZE_TOO_LARGE',
    'SIZE_TOO_SMALL', 'STYLE', 'UNKNOWN', 'UNWANTED', 'WRONG_ITEM',
  ]);
});

test('every reason maps to a distinct POS button label and back again', () => {
  const labels = returnReasons.map(posLabelForReason);
  assert.equal(new Set(labels).size, returnReasons.length, 'POS labels must be unique or a tap is ambiguous');
  for (const reason of returnReasons) assert.equal(reasonForPosLabel(posLabelForReason(reason)), reason);
});

test('the POS labels are the exact observed button names', () => {
  // Observed in the POS return sheet reason picker, run-1789960522048.
  assert.equal(posLabelForReason('SIZE_TOO_LARGE'), 'Too big');
  assert.equal(posLabelForReason('SIZE_TOO_SMALL'), 'Too small');
  assert.equal(posLabelForReason('UNWANTED'), 'Changed my mind');
  assert.equal(posLabelForReason('NOT_AS_DESCRIBED'), 'Item not as described');
  assert.equal(posLabelForReason('WRONG_ITEM'), 'Received the wrong item');
  assert.equal(posLabelForReason('DEFECTIVE'), 'Damaged or defective');
});

test('an unrecognised or whitespace-padded label is handled without guessing', () => {
  assert.equal(reasonForPosLabel('  Changed my mind  '), 'UNWANTED');
  assert.equal(reasonForPosLabel('Too Big'), null, 'matching is exact, not case-insensitive');
  assert.equal(reasonForPosLabel('Wrong size'), null);
});

test('only the ten enum values validate, and the default is UNKNOWN', () => {
  assert.equal(isReturnReason('UNWANTED'), true);
  assert.equal(isReturnReason('Changed my mind'), false, 'the POS label is not the contract value');
  assert.equal(isReturnReason(''), false);
  assert.equal(isReturnReason(7), false);
  assert.equal(defaultReturnReason, 'UNKNOWN');
  assert.equal(isReturnReason(defaultReturnReason), true);
});

test('the operator wording carries both vocabularies', () => {
  assert.equal(describeReturnReason('UNWANTED'), 'Changed my mind (UNWANTED)');
});
