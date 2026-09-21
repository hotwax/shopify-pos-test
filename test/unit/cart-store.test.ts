import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPinia, setActivePinia } from 'pinia';
import type { OmsShopifyOrderDetail, OmsVariant } from '../../shared/contracts.ts';
import { customerIsUsable, customerLabel, emptyCustomer, useCartStore } from '../../ui/stores/cart.ts';

function variant(overrides: Partial<OmsVariant> = {}): OmsVariant {
  return {
    gid: 'gid://shopify/ProductVariant/1',
    productGid: 'gid://shopify/Product/1',
    title: 'XS / Black',
    productTitle: 'Test Jacket',
    sku: 'TJ-XS',
    price: '12.50',
    compareAtPrice: null,
    availableForSale: true,
    productStatus: 'ACTIVE',
  imageUrl: 'https://cdn.example/shirt.png',
    inventoryTracked: true,
    availableAtLocation: 4,
    totalInventory: 40,
    hasOnlyDefaultVariant: false,
    productVariantCount: 3,
    ...overrides,
  };
}

function store() {
  setActivePinia(createPinia());
  return useCartStore();
}

test('adding the same variant twice increases quantity instead of duplicating the line', () => {
  const cart = store();
  cart.addVariant(variant());
  cart.addVariant(variant(), 2);

  assert.equal(cart.lines.length, 1);
  assert.equal(cart.lines[0]?.quantity, 3);
  assert.equal(cart.itemCount, 3);
});

test('the subtotal is unknown when any line has no price', () => {
  const cart = store();
  cart.addVariant(variant(), 2);
  assert.equal(cart.subtotal, '25.00');

  cart.addVariant(variant({ gid: 'gid://shopify/ProductVariant/2', price: null }));
  assert.equal(cart.subtotal, null, 'a missing price must not be treated as zero');
});

test('only variant GIDs and quantities reach the executable lines', () => {
  const cart = store();
  cart.addVariant(variant(), 2);
  cart.planning.deliveryMethod = 'Ship to customer';
  cart.setNewCustomer({ ...emptyCustomer(), firstName: 'Ada', lastName: 'Lovelace' });
  cart.addCode('discountCodes', 'SAVE10');
  cart.addCode('giftCardCodes', 'GC-1');

  assert.deepEqual(cart.executableLines, [{ variantGid: 'gid://shopify/ProductVariant/1', productGid: 'gid://shopify/Product/1', search: 'Test Jacket', quantity: 2, variantSelection: 'multi' }]);
  const serialized = JSON.stringify(cart.executableLines);
  assert.doesNotMatch(serialized, /SAVE10|GC-1|Ada|Lovelace|Ship to customer/);
});

test('planning-only fields in use are reported so the UI can say they will not run', () => {
  const cart = store();
  assert.deepEqual(cart.planningOnlyInUse, []);

  cart.planning.deliveryMethod = 'Local delivery';
  cart.addCode('discountCodes', 'SAVE10');
  cart.setNewCustomer({ ...emptyCustomer(), email: 'tester@example.com' });

  assert.deepEqual(cart.planningOnlyInUse, ['Delivery method', 'Discount codes', 'Customer']);
});

test('duplicate codes are ignored and codes can be removed', () => {
  const cart = store();
  cart.addCode('discountCodes', 'SAVE10');
  cart.addCode('discountCodes', 'SAVE10');
  cart.addCode('discountCodes', '  ');
  assert.deepEqual(cart.planning.discountCodes, ['SAVE10']);

  cart.removeCode('discountCodes', 'SAVE10');
  assert.deepEqual(cart.planning.discountCodes, []);
});

test('a quantity above the stock available at the location is flagged', () => {
  const cart = store();
  cart.addVariant(variant({ availableAtLocation: 2 }), 5);
  assert.equal(cart.overstockedLines.length, 1);

  cart.setQuantity('gid://shopify/ProductVariant/1', 2);
  assert.equal(cart.overstockedLines.length, 0);
});

test('an untracked or unread stock level is never treated as overstocked', () => {
  const cart = store();
  cart.addVariant(variant({ inventoryTracked: false, availableAtLocation: null }), 99);
  cart.addVariant(variant({ gid: 'gid://shopify/ProductVariant/2', availableAtLocation: null }), 99);

  assert.equal(cart.overstockedLines.length, 0);
});

test('setQuantity rejects a non-positive or fractional quantity', () => {
  const cart = store();
  cart.addVariant(variant(), 3);

  cart.setQuantity('gid://shopify/ProductVariant/1', 0);
  cart.setQuantity('gid://shopify/ProductVariant/1', -1);
  cart.setQuantity('gid://shopify/ProductVariant/1', 1.5);

  assert.equal(cart.lines[0]?.quantity, 3);
});

test('seeding from an order copies its customer into the planned order', () => {
  const cart = store();
  cart.startFromOrder({
    gid: 'gid://shopify/Order/9', legacyResourceId: '9', name: '#9', financialStatus: 'PAID', fulfillmentStatus: null,
    total: { amount: '10.00', currency: 'USD' }, paymentGatewayNames: ['cash'],
    customer: { gid: 'gid://shopify/Customer/5', firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com', phone: '' },
    transactions: [], agreements: [], nextCursor: null,
    lines: [{ gid: 'gid://shopify/LineItem/1', quantity: 1, refundableQuantity: 1, unitPrice: { amount: '10.00', currency: 'USD' }, variantGid: 'gid://shopify/ProductVariant/7', variantTitle: 'M', sku: 'A-M', productGid: 'gid://shopify/Product/7', productTitle: 'Copied', hasOnlyDefaultVariant: true, productVariantCount: 1 }],
  }, 'USD');
  assert.equal(cart.planning.customer?.mode, 'existing');
  assert.equal(cart.planning.customer?.gid, 'gid://shopify/Customer/5');
  assert.equal(cart.planning.customer?.firstName, 'Ada');
  // A customer is still planning-only, so it must never reach the frozen lines.
  assert.doesNotMatch(JSON.stringify(cart.executableLines), /Ada|Lovelace|ada@example/i);
});

test('an order with no customer leaves the planned customer unset', () => {
  const cart = store();
  cart.startFromOrder({
    gid: 'gid://shopify/Order/10', legacyResourceId: '10', name: '#10', financialStatus: 'PAID', fulfillmentStatus: null,
    total: { amount: '10.00', currency: 'USD' }, paymentGatewayNames: ['cash'], customer: null,
    transactions: [], agreements: [], nextCursor: null,
    lines: [{ gid: 'gid://shopify/LineItem/1', quantity: 1, refundableQuantity: 1, unitPrice: { amount: '10.00', currency: 'USD' }, variantGid: 'gid://shopify/ProductVariant/7', variantTitle: 'M', sku: 'A-M', productGid: 'gid://shopify/Product/7', productTitle: 'Copied', hasOnlyDefaultVariant: true, productVariantCount: 1 }],
  }, 'USD');
  assert.equal(cart.planning.customer, null);
});

test('seeding from an order copies only lines with an exact variant GID', () => {
  const cart = store();
  const detail = {
    gid: 'gid://shopify/Order/9',
    legacyResourceId: '9',
    name: '#1009',
    financialStatus: 'PAID',
    fulfillmentStatus: null,
    total: { amount: '30.00', currency: 'GBP' },
    paymentGatewayNames: ['cash'], customer: null,
    transactions: [],
    agreements: [],
    nextCursor: null,
    lines: [
      { gid: 'gid://shopify/LineItem/1', quantity: 2, refundableQuantity: 2, unitPrice: { amount: '10.00', currency: 'GBP' }, variantGid: 'gid://shopify/ProductVariant/7', variantTitle: 'M', sku: 'A-M', productGid: 'gid://shopify/Product/7', productTitle: 'Copied', hasOnlyDefaultVariant: true, productVariantCount: 1 },
      { gid: 'gid://shopify/LineItem/2', quantity: 1, refundableQuantity: 1, unitPrice: { amount: '10.00', currency: 'GBP' }, variantGid: null, variantTitle: null, sku: null, productGid: null, productTitle: 'Custom sale', hasOnlyDefaultVariant: null, productVariantCount: null },
    ],
  } satisfies OmsShopifyOrderDetail;

  cart.startFromOrder(detail, 'USD');

  assert.equal(cart.origin, 'order');
  assert.equal(cart.sourceOrderReference, '#1009');
  assert.equal(cart.currency, 'GBP', 'the source order currency wins over the shop default');
  assert.deepEqual(cart.executableLines, [{ variantGid: 'gid://shopify/ProductVariant/7', productGid: 'gid://shopify/Product/7', search: 'Copied', quantity: 2, variantSelection: 'single' }]);
  assert.equal(cart.skippedFromOrder(detail), 1, 'the uncopyable line must be reported, not hidden');
});

test('starting a new cart clears a cart seeded from an order', () => {
  const cart = store();
  cart.origin = 'order';
  cart.sourceOrderReference = '#1009';
  cart.addVariant(variant());
  cart.planning.deliveryMethod = 'Local delivery';

  cart.startNew('CAD');

  assert.equal(cart.origin, 'new');
  assert.equal(cart.sourceOrderReference, '');
  assert.equal(cart.currency, 'CAD');
  assert.equal(cart.isEmpty, true);
  assert.deepEqual(cart.planningOnlyInUse, []);
});



test('an existing customer is stored by GID and a new one is not', () => {
  const cart = store();
  cart.setExistingCustomer({ gid: 'gid://shopify/Customer/5', displayName: 'Ada L', firstName: 'Ada', lastName: 'L', email: 'ada@example.com', phone: null, orderCount: 3, location: 'Brooklyn' });

  assert.equal(cart.planning.customer?.mode, 'existing');
  assert.equal(cart.planning.customer?.gid, 'gid://shopify/Customer/5');

  cart.setNewCustomer({ ...emptyCustomer(), firstName: 'New', email: 'new@example.com' });
  assert.equal(cart.planning.customer?.mode, 'new');
  assert.equal(cart.planning.customer?.gid, '', 'a customer that does not exist yet must not carry a GID');
});

test('a new customer needs at least one identifying field, as Shopify requires', () => {
  assert.equal(customerIsUsable(emptyCustomer()), false);
  assert.equal(customerIsUsable({ ...emptyCustomer(), phone: '+15555550123' }), true);
  assert.equal(customerIsUsable({ ...emptyCustomer(), firstName: '   ' }), false, 'whitespace is not an identity');
  assert.equal(customerIsUsable({ ...emptyCustomer(), mode: 'existing' }), false, 'an existing customer needs its GID');
});

test('a customer never reaches the executable lines', () => {
  const cart = store();
  cart.addVariant(variant());
  cart.setExistingCustomer({ gid: 'gid://shopify/Customer/5', displayName: 'Ada L', firstName: 'Ada', lastName: 'L', email: 'ada@example.com', phone: null, orderCount: 3, location: null });

  assert.doesNotMatch(JSON.stringify(cart.executableLines), /Customer|ada@example/i);
  assert.deepEqual(cart.planningOnlyInUse, ['Customer']);
});

test('the customer label falls back rather than showing an empty name', () => {
  assert.equal(customerLabel({ ...emptyCustomer(), firstName: 'Ada', lastName: 'L' }), 'Ada L');
  assert.equal(customerLabel({ ...emptyCustomer(), email: 'ada@example.com' }), 'ada@example.com');
  assert.equal(customerLabel(emptyCustomer()), 'Unnamed customer');
});

test('clearing the customer removes it from the planning-only report', () => {
  const cart = store();
  cart.setNewCustomer({ ...emptyCustomer(), firstName: 'Ada' });
  assert.deepEqual(cart.planningOnlyInUse, ['Customer']);

  cart.clearCustomer();
  assert.deepEqual(cart.planningOnlyInUse, []);
});

test('each cart line plans the POS add-to-cart path from the product variant facts', () => {
  const cart = store();
  cart.addVariant(variant({ gid: 'gid://shopify/ProductVariant/10', productGid: 'gid://shopify/Product/10', hasOnlyDefaultVariant: true, productVariantCount: 1 }));
  cart.addVariant(variant({ gid: 'gid://shopify/ProductVariant/11', productGid: 'gid://shopify/Product/11', hasOnlyDefaultVariant: false, productVariantCount: 15 }));
  cart.addVariant(variant({ gid: 'gid://shopify/ProductVariant/12', productGid: 'gid://shopify/Product/12', hasOnlyDefaultVariant: null, productVariantCount: null }));

  assert.deepEqual(cart.lines.map(line => line.variantSelection), ['single', 'multi', 'unknown']);
  assert.deepEqual(cart.executableLines.map(line => line.variantSelection), ['single', 'multi', 'unknown']);
  assert.deepEqual(cart.unplannedSelectionLines.map(line => line.variantGid), ['gid://shopify/ProductVariant/12']);
});

test('a cart seeded from an order plans the path from the read-back variant facts', () => {
  const cart = store();
  cart.startFromOrder({
    gid: 'gid://shopify/Order/11', legacyResourceId: '11', name: '#11', financialStatus: 'PAID', fulfillmentStatus: null,
    total: { amount: '20.00', currency: 'USD' }, paymentGatewayNames: ['cash'], customer: null,
    transactions: [], agreements: [], nextCursor: null,
    lines: [
      { gid: 'gid://shopify/LineItem/1', quantity: 1, refundableQuantity: 1, unitPrice: { amount: '10.00', currency: 'USD' }, variantGid: 'gid://shopify/ProductVariant/7', variantTitle: 'Default Title', sku: null, productGid: 'gid://shopify/Product/7', productTitle: 'Plain', hasOnlyDefaultVariant: true, productVariantCount: 1 },
      { gid: 'gid://shopify/LineItem/2', quantity: 1, refundableQuantity: 1, unitPrice: { amount: '10.00', currency: 'USD' }, variantGid: 'gid://shopify/ProductVariant/8', variantTitle: 'M', sku: null, productGid: 'gid://shopify/Product/8', productTitle: 'Sized', hasOnlyDefaultVariant: false, productVariantCount: 4 },
    ],
  }, 'USD');
  assert.deepEqual(cart.executableLines.map(line => line.variantSelection), ['single', 'multi']);
});
