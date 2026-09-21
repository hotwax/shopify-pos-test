import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describeVariantSelection, isVariantSelection, observedVariantSelection, plannedVariantSelection, variantSelectionMismatch } from '../../shared/variant-selection.ts';

test('a product with only the default variant is planned as single, one with several as multi', () => {
  assert.equal(plannedVariantSelection({ hasOnlyDefaultVariant: true, productVariantCount: 1 }), 'single');
  assert.equal(plannedVariantSelection({ hasOnlyDefaultVariant: false, productVariantCount: 4 }), 'multi');
  assert.equal(plannedVariantSelection({ hasOnlyDefaultVariant: false, productVariantCount: 15 }), 'multi');
  // An inexact (AT_LEAST) count is read as null; the product still has many variants.
  assert.equal(plannedVariantSelection({ hasOnlyDefaultVariant: false, productVariantCount: null }), 'multi');
  // The count alone can prove a picker even when the default-variant flag was not read.
  assert.equal(plannedVariantSelection({ hasOnlyDefaultVariant: null, productVariantCount: 2 }), 'multi');
});

test('unread facts and the single non-default variant shape are left for the run to observe', () => {
  assert.equal(plannedVariantSelection({ hasOnlyDefaultVariant: null, productVariantCount: null }), 'unknown');
  assert.equal(plannedVariantSelection({ hasOnlyDefaultVariant: null, productVariantCount: 1 }), 'unknown');
  // Seen in the test store ("Test white t shirt 1"): one variant titled White,
  // not the default. POS behaviour for it has not been observed.
  assert.equal(plannedVariantSelection({ hasOnlyDefaultVariant: false, productVariantCount: 1 }), 'unknown');
});

test('what POS opened after the product tap maps back to a selection', () => {
  assert.equal(observedVariantSelection('cart-line'), 'single');
  assert.equal(observedVariantSelection('variant-picker'), 'multi');
});

test('a plan that disagrees with what POS opened is reported, an unknown plan never is', () => {
  const product = 'gid://shopify/Product/1';
  assert.equal(variantSelectionMismatch('single', 'cart-line', product), null);
  assert.equal(variantSelectionMismatch('multi', 'variant-picker', product), null);
  assert.equal(variantSelectionMismatch('unknown', 'cart-line', product), null);
  assert.equal(variantSelectionMismatch('unknown', 'variant-picker', product), null);
  assert.match(variantSelectionMismatch('single', 'variant-picker', product) ?? '', /planned as a single-variant product.*rebuild the cart/);
  assert.match(variantSelectionMismatch('multi', 'cart-line', product) ?? '', /planned as a multi-variant product.*Clear the POS cart/);
});

test('only the three selection words are accepted from a request', () => {
  assert.equal(isVariantSelection('single'), true);
  assert.equal(isVariantSelection('multi'), true);
  assert.equal(isVariantSelection('unknown'), true);
  assert.equal(isVariantSelection('picker'), false);
  assert.equal(isVariantSelection(1), false);
});

test('the operator wording names the path and the variant count when known', () => {
  assert.equal(describeVariantSelection('single'), 'Single variant · adds straight to the cart');
  assert.equal(describeVariantSelection('multi', 4), 'Multi-variant · picks the exact variant from 4');
  assert.equal(describeVariantSelection('multi'), 'Multi-variant · picks the exact variant');
  assert.match(describeVariantSelection('unknown'), /watches what POS opens/);
});
