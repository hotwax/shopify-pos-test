import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OmsClient } from '../../core/oms/client.ts';
import { listPosOrdersQuery, resolveOrderQuery, searchVariantsAtLocationQuery, searchVariantsQuery } from '../../core/oms/queries/documents.ts';
import { OmsError } from '../../core/oms/types.ts';

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
}

function queuedFetch(responses: Response[]): { fetchImpl: (input: string | URL, init?: RequestInit) => Promise<Response>; calls: { input: string; init?: RequestInit }[] } {
  const calls: { input: string; init?: RequestInit }[] = [];
  return {
    calls,
    fetchImpl: async (input, init) => {
      calls.push({ input: String(input), init });
      const response = responses.shift();
      if (!response) throw new Error('No queued response');
      return response;
    },
  };
}

async function loggedIn(responses: Response[]) {
  const queued = queuedFetch(responses);
  const client = new OmsClient([{ id: 'local', label: 'Test', origin: 'https://oms.example' }], queued.fetchImpl);
  await client.login('local', { username: 'tester', password: 'secret' });
  return { client, queued };
}

test('scopes named variant reads to a currently available shop and normalizes the OMS envelope', async () => {
  const { client, queued } = await loggedIn([
    json({ loginOptions: ['BASIC'] }),
    json({ token: 'runtime-token', expirationTime: new Date(Date.now() + 60_000).toISOString() }),
    json({ userId: 'user-1' }),
    json([{ shopId: 'connector-1', shopifyShopId: 'gid://shopify/Shop/1', domain: 'test.myshopify.com', name: 'Test shop' }]),
    json({ statusCode: 200, response: { data: { productVariants: { nodes: [{ id: 'gid://shopify/ProductVariant/1', title: 'Blue', sku: 'BLUE', product: { id: 'gid://shopify/Product/1', title: 'Shirt' } }], pageInfo: { hasNextPage: true, endCursor: 'cursor-1' } } } } }),
  ]);
  const page = await client.searchVariants('local', 'connector-1', { search: 'blue' });
  // Without a location scope every commercial field is unread, which is
  // reported as null rather than as a zero price or an empty shelf.
  assert.deepEqual(page.items, [{
    gid: 'gid://shopify/ProductVariant/1', productGid: 'gid://shopify/Product/1', title: 'Blue', productTitle: 'Shirt', sku: 'BLUE',
    price: null, compareAtPrice: null, availableForSale: null, productStatus: null, imageUrl: null,
    inventoryTracked: null, availableAtLocation: null, totalInventory: null, hasOnlyDefaultVariant: null, productVariantCount: null,
  }]);
  assert.equal(page.nextCursor, 'cursor-1');
  const graphqlRequest = queued.calls.at(-1);
  assert.equal(JSON.parse(String(graphqlRequest?.init?.body)).queryText, searchVariantsQuery);
  assert.equal(JSON.parse(String(graphqlRequest?.init?.body)).shopId, 'connector-1');
  assert.equal(new Headers(graphqlRequest?.init?.headers).get('Authorization'), 'Bearer runtime-token');
});

test('normalizes the OMS numeric primary location to the verified Shopify location GID', async () => {
  const { client } = await loggedIn([
    json({ loginOptions: ['BASIC'] }),
    json({ token: 'runtime-token', expirationTime: new Date(Date.now() + 60_000).toISOString() }),
    json({ userId: 'user-1' }),
    json([
      { shopId: 'connector-1', shopifyShopId: 'gid://shopify/Shop/1', name: 'Test shop', primaryLocationId: '99908026532' },
      { shopId: 'connector-2', shopifyShopId: 'gid://shopify/Shop/2', name: 'Other shop', primaryLocationGid: 'gid://shopify/Location/2' },
      { shopId: 'connector-3', shopifyShopId: 'gid://shopify/Shop/3', name: 'Unknown shop', primaryLocationId: 'facility-1' },
    ]),
  ]);
  assert.deepEqual(await client.shops('local'), [
    { connectorShopId: 'connector-1', shopGid: 'gid://shopify/Shop/1', shopDomain: '', name: 'Test shop', locationGid: 'gid://shopify/Location/99908026532', currency: null, timezone: null, apiVersion: null },
    { connectorShopId: 'connector-2', shopGid: 'gid://shopify/Shop/2', shopDomain: '', name: 'Other shop', locationGid: 'gid://shopify/Location/2', currency: null, timezone: null, apiVersion: null },
    { connectorShopId: 'connector-3', shopGid: 'gid://shopify/Shop/3', shopDomain: '', name: 'Unknown shop', locationGid: null, currency: null, timezone: null, apiVersion: null },
  ]);
});

test('prefers the variant image, falls back to the product image and rejects non-https', async () => {
  const { client } = await loggedIn([
    json({ loginOptions: ['BASIC'] }),
    json({ token: 'runtime-token', expirationTime: new Date(Date.now() + 60_000).toISOString() }),
    json({ userId: 'user-1' }),
    json([{ shopId: 'connector-1', shopifyShopId: '1', name: 'Shop' }]),
    json({ response: { data: { productVariants: { nodes: [
      { id: 'gid://shopify/ProductVariant/1', title: 'A', product: { id: 'gid://shopify/Product/1', title: 'P', featuredImage: { url: 'https://cdn.example/product.png' } }, image: { url: 'https://cdn.example/variant.png' } },
      { id: 'gid://shopify/ProductVariant/2', title: 'B', product: { id: 'gid://shopify/Product/2', title: 'P2', featuredImage: { url: 'https://cdn.example/fallback.png' } } },
      { id: 'gid://shopify/ProductVariant/3', title: 'C', product: { id: 'gid://shopify/Product/3', title: 'P3' }, image: { url: 'http://insecure.example/x.png' } },
    ], pageInfo: { hasNextPage: false, endCursor: null } } } } }),
  ]);
  const page = await client.searchVariants('local', 'connector-1', { search: 'a', locationGid: 'gid://shopify/Location/1' });
  assert.deepEqual(page.items.map(item => item.imageUrl), ['https://cdn.example/variant.png', 'https://cdn.example/fallback.png', null]);
});

test('projects a numeric OMS shop id into a Shopify shop GID', async () => {
  const { client } = await loggedIn([
    json({ loginOptions: ['BASIC'] }),
    json({ token: 'runtime-token', expirationTime: new Date(Date.now() + 60_000).toISOString() }),
    json({ userId: 'user-1' }),
    json([
      { shopId: 'connector-1', shopifyShopId: '41965584548', name: 'Numeric' },
      { shopId: 'connector-2', shopifyShopId: 'gid://shopify/Shop/2', name: 'Already a GID' },
    ]),
  ]);
  assert.deepEqual((await client.shops('local')).map(shop => shop.shopGid), ['gid://shopify/Shop/41965584548', 'gid://shopify/Shop/2']);
});

test('reads the Shopify API version from the OMS shop record and rejects a malformed one', async () => {
  const { client } = await loggedIn([
    json({ loginOptions: ['BASIC'] }),
    json({ token: 'runtime-token', expirationTime: new Date(Date.now() + 60_000).toISOString() }),
    json({ userId: 'user-1' }),
    json([
      { shopId: 'connector-1', shopifyShopId: 'gid://shopify/Shop/1', name: 'Configured', apiVersion: '2026-01' },
      { shopId: 'connector-2', shopifyShopId: 'gid://shopify/Shop/2', name: 'Related list', shopifyConfig: [{ apiVersion: '2025-10' }] },
      { shopId: 'connector-3', shopifyShopId: 'gid://shopify/Shop/3', name: 'Malformed', apiVersion: 'latest' },
      { shopId: 'connector-4', shopifyShopId: 'gid://shopify/Shop/4', name: 'Missing' },
      { shopId: 'connector-5', shopifyShopId: 'gid://shopify/Shop/5', name: 'Conflicting', shopifyConfig: [{ apiVersion: '2025-10' }, { apiVersion: '2026-01' }] },
      { shopId: 'connector-6', shopifyShopId: 'gid://shopify/Shop/6', name: 'Agreeing', shopifyConfig: [{ apiVersion: '2026-01' }, { apiVersion: '2026-01' }] },
    ]),
  ]);
  assert.deepEqual((await client.shops('local')).map(shop => shop.apiVersion), ['2026-01', '2025-10', null, null, null, '2026-01']);
});

test('resolves an exact Shopify order GID into safe line detail', async () => {
  const { client, queued } = await loggedIn([
    json({ loginOptions: ['BASIC'] }),
    json({ token: 'runtime-token', expirationTime: new Date(Date.now() + 60_000).toISOString() }),
    json({ userId: 'user-1' }),
    json([{ shopId: 'connector-1', shopifyShopId: 'gid://shopify/Shop/1', name: 'Test shop' }]),
    json({ statusCode: 200, response: { data: { order: {
      id: 'gid://shopify/Order/100', legacyResourceId: '100', name: '#100', displayFinancialStatus: 'PAID', displayFulfillmentStatus: 'UNFULFILLED',
      paymentGatewayNames: ['cash'], returnStatus: null, returns: [], refunds: [], fulfillments: [],
      customer: null,
      transactions: [{ id: 'gid://shopify/OrderTransaction/1', kind: 'SALE', status: 'SUCCESS', gateway: 'cash', amountSet: { shopMoney: { amount: '12.50', currencyCode: 'USD' } } }],
      agreements: { nodes: [{ __typename: 'ReturnAgreement', id: 'gid://shopify/SalesAgreement/1', happenedAt: '2026-09-20T12:00:00Z', return: { id: 'gid://shopify/Return/1', name: '#R1' }, sales: { nodes: [{ actionType: 'RETURN', lineType: 'PRODUCT', quantity: -1, totalAmount: { shopMoney: { amount: '-12.50', currencyCode: 'USD' } }, lineItem: { id: 'gid://shopify/LineItem/1' } }] } }] },
      totalPriceSet: { shopMoney: { amount: '12.50', currencyCode: 'USD' } },
      lineItems: { nodes: [{ id: 'gid://shopify/LineItem/1', quantity: 2, refundableQuantity: 2, originalUnitPriceSet: { shopMoney: { amount: '6.25', currencyCode: 'USD' } }, variant: { id: 'gid://shopify/ProductVariant/1', title: 'Blue', sku: 'BLUE', product: { id: 'gid://shopify/Product/1', title: 'Shirt' } } }], pageInfo: { hasNextPage: false } },
    } } } }),
  ]);
  const detail = await client.resolveOrder('local', 'connector-1', { gid: 'gid://shopify/Order/100' });
  assert.deepEqual(detail, {
    gid: 'gid://shopify/Order/100', legacyResourceId: '100', name: '#100', financialStatus: 'PAID', fulfillmentStatus: 'UNFULFILLED', total: { amount: '12.50', currency: 'USD' },
    paymentGatewayNames: ['cash'], returnStatus: null, returns: [], refunds: [], fulfillments: [],
    customer: null,
    transactions: [{ id: 'gid://shopify/OrderTransaction/1', kind: 'SALE', status: 'SUCCESS', gateway: 'cash', amount: { amount: '12.50', currency: 'USD' } }],
    agreements: [{ id: 'gid://shopify/SalesAgreement/1', happenedAt: '2026-09-20T12:00:00Z', returnGid: 'gid://shopify/Return/1', returnName: '#R1', sales: [{ actionType: 'RETURN', lineType: 'PRODUCT', quantity: -1, amount: { amount: '-12.50', currency: 'USD' }, lineGid: 'gid://shopify/LineItem/1', variantGid: null }] }],
    lines: [{ gid: 'gid://shopify/LineItem/1', quantity: 2, refundableQuantity: 2, unitPrice: { amount: '6.25', currency: 'USD' }, variantGid: 'gid://shopify/ProductVariant/1', variantTitle: 'Blue', sku: 'BLUE', productGid: 'gid://shopify/Product/1', productTitle: 'Shirt', hasOnlyDefaultVariant: null, productVariantCount: null }], nextCursor: null,
  });
  const request = JSON.parse(String(queued.calls.at(-1)?.init?.body));
  assert.equal(request.queryText, resolveOrderQuery);
  assert.deepEqual(request.variables, { id: 'gid://shopify/Order/100', lineFirst: 50, lineAfter: null });
  await assert.rejects(() => client.resolveOrder('local', 'connector-1', { gid: 'gid://shopify/Product/1' }), (error: unknown) => error instanceof OmsError && error.code === 'invalid-data');
});

test('preserves GraphQL errors and rejects a shop that is not in the live shop list', async () => {
  const { client } = await loggedIn([
    json({ loginOptions: ['BASIC'] }),
    json({ token: 'runtime-token', expirationTime: new Date(Date.now() + 60_000).toISOString() }),
    json({ userId: 'user-1' }),
    json({ shops: [{ shopId: 'connector-1' }] }),
  ]);
  await assert.rejects(() => client.searchOrders('local', 'other-shop', { search: '' }), (error: unknown) => error instanceof OmsError && error.code === 'authorization');

  const queued = queuedFetch([
    json({ loginOptions: ['BASIC'] }),
    json({ token: 'runtime-token', expirationTime: new Date(Date.now() + 60_000).toISOString() }),
    json({ userId: 'user-1' }),
    json({ shops: [{ shopId: 'connector-1' }] }),
    json({ statusCode: 200, response: { data: { orders: { nodes: [], pageInfo: { hasNextPage: false } } }, errors: [{ message: 'denied' }] } }),
  ]);
  const second = new OmsClient([{ id: 'local', label: 'Test', origin: 'https://oms.example' }], queued.fetchImpl);
  await second.login('local', { username: 'tester', password: 'secret' });
  await assert.rejects(() => second.searchOrders('local', 'connector-1', { search: '' }), (error: unknown) => error instanceof OmsError && error.code === 'graphql');
});

test('maps HTTP 429 and bounds caller-controlled pagination input', async () => {
  const { client } = await loggedIn([
    json({ loginOptions: ['BASIC'] }),
    json({ token: 'runtime-token', expirationTime: new Date(Date.now() + 60_000).toISOString() }),
    json({ userId: 'user-1' }),
    json({ shops: [{ shopId: 'connector-1' }] }),
    json({ errorCode: 'RATE_LIMITED' }, 429),
  ]);
  await assert.rejects(() => client.listLocations('local', 'connector-1', { cursor: 'x'.repeat(513) }), (error: unknown) => error instanceof OmsError && error.code === 'invalid-data');
  await assert.rejects(() => client.listLocations('local', 'connector-1', {}), (error: unknown) => error instanceof OmsError && error.code === 'rate-limited');
});

test('reads paginated OMS order records and sanitizes return detail fields', async () => {
  const { client, queued } = await loggedIn([
    json({ loginOptions: ['BASIC'] }),
    json({ token: 'runtime-token', expirationTime: new Date(Date.now() + 60_000).toISOString() }),
    json({ userId: 'user-1' }),
    json([{
      orderId: 'M100', orderName: '100', externalId: 'external-100', statusId: 'ORDER_APPROVED',
      orderDate: '2026-09-20', grandTotal: 12.5, currencyUom: 'USD',
      contents: [{ orderItemSeqId: '01' }], shipGroups: []
    }]),
    json({ orderDetail: {
      orderId: 'M100', orderName: '100', orderExternalId: 'external-100', orderStatusId: 'ORDER_APPROVED',
      orderDate: '2026-09-20', grandTotal: 12.5, currencyUom: 'USD', shipGroups: [{ shipGroupSeqId: '00001', facilityId: 'STORE_1', items: [{
        orderItemSeqId: '01', productId: 'PROD_1', internalName: 'Blue shirt', sku: 'BLUE', quantity: 2,
        shippedQuantity: 2, returnableQuantity: 1, alreadyReturnedQuantity: 1, unitPrice: 6.25, itemStatusId: 'ITEM_COMPLETED'
      }] }]
    } }),
  ]);

  const page = await client.searchOrderRecords('local', {});
  assert.deepEqual(page.items, [{ orderId: 'M100', orderName: '100', externalId: 'external-100', statusId: 'ORDER_APPROVED', orderDate: '2026-09-20', grandTotal: '12.5', currency: 'USD', itemCount: 1 }]);
  assert.equal(page.nextCursor, null);

  const detail = await client.getOrderDetail('local', 'M100');
  assert.deepEqual(detail, {
    orderId: 'M100', orderName: '100', externalId: 'external-100', statusId: 'ORDER_APPROVED', orderDate: '2026-09-20', grandTotal: '12.5', currency: 'USD',
    items: [{ orderItemSeqId: '01', productId: 'PROD_1', productName: 'Blue shirt', sku: 'BLUE', quantity: 2, shippedQuantity: 2, returnableQuantity: 1, alreadyReturnedQuantity: 1, unitPrice: '6.25', shipGroupSeqId: '00001', facilityId: 'STORE_1', itemStatusId: 'ITEM_COMPLETED' }]
  });
  assert.match(queued.calls.at(-2)?.input ?? '', /pageSize=25/);
  assert.match(queued.calls.at(-1)?.input ?? '', /oms\/orders\/M100$/);
});

test('uses exact OMS identifier fallbacks and rejects unsafe order detail paths', async () => {
  const { client, queued } = await loggedIn([
    json({ loginOptions: ['BASIC'] }),
    json({ token: 'runtime-token', expirationTime: new Date(Date.now() + 60_000).toISOString() }),
    json({ userId: 'user-1' }),
    json([]),
    json([{ orderId: 'M100', orderName: '100', statusId: 'ORDER_APPROVED' }]),
  ]);
  const page = await client.searchOrderRecords('local', { search: '100' });
  assert.equal(page.items[0]?.orderId, 'M100');
  assert.match(queued.calls.at(-2)?.input ?? '', /orderId=100/);
  assert.match(queued.calls.at(-1)?.input ?? '', /orderName=100/);
  await assert.rejects(() => client.getOrderDetail('local', '../M100'), (error: unknown) => error instanceof OmsError && error.code === 'invalid-data');
});

test('a location-scoped variant read returns price and the stock available at that location', async () => {
  const { client, queued } = await loggedIn([
    json({ loginOptions: ['BASIC'] }),
    json({ token: 'runtime-token', expirationTime: new Date(Date.now() + 60_000).toISOString() }),
    json({ userId: 'user-1' }),
    json([{ shopId: 'connector-1', shopifyShopId: 'gid://shopify/Shop/1', domain: 'test.myshopify.com', name: 'Test shop' }]),
    json({ statusCode: 200, response: { data: { productVariants: { nodes: [{
      id: 'gid://shopify/ProductVariant/1', title: 'Blue', sku: 'BLUE', price: '12.50', compareAtPrice: '15.00',
      availableForSale: true, inventoryQuantity: 40,
      product: { id: 'gid://shopify/Product/1', title: 'Shirt', status: 'ACTIVE' },
      inventoryItem: { tracked: true, inventoryLevel: { quantities: [{ name: 'available', quantity: 4 }] } },
    }], pageInfo: { hasNextPage: false, endCursor: null } } } } }),
  ]);

  const page = await client.searchVariants('local', 'connector-1', { search: 'blue', locationGid: 'gid://shopify/Location/9' });

  assert.deepEqual(page.items, [{
    gid: 'gid://shopify/ProductVariant/1', productGid: 'gid://shopify/Product/1', title: 'Blue', productTitle: 'Shirt', sku: 'BLUE',
    price: '12.50', compareAtPrice: '15.00', availableForSale: true, productStatus: 'ACTIVE', imageUrl: null,
    inventoryTracked: true, availableAtLocation: 4, totalInventory: 40, hasOnlyDefaultVariant: null, productVariantCount: null,
  }]);

  const body = JSON.parse(String(queued.calls.at(-1)?.init?.body));
  assert.equal(body.queryText, searchVariantsAtLocationQuery);
  assert.equal(body.variables.locationId, 'gid://shopify/Location/9');
});

test('an item with no stock record at the location reads as unknown, never as zero', async () => {
  const { client } = await loggedIn([
    json({ loginOptions: ['BASIC'] }),
    json({ token: 'runtime-token', expirationTime: new Date(Date.now() + 60_000).toISOString() }),
    json({ userId: 'user-1' }),
    json([{ shopId: 'connector-1', shopifyShopId: 'gid://shopify/Shop/1', domain: 'test.myshopify.com', name: 'Test shop' }]),
    json({ statusCode: 200, response: { data: { productVariants: { nodes: [{
      id: 'gid://shopify/ProductVariant/1', title: 'Blue', sku: null, price: '1.00',
      product: { id: 'gid://shopify/Product/1', title: 'Shirt' },
      inventoryItem: { tracked: true, inventoryLevel: null },
    }], pageInfo: { hasNextPage: false, endCursor: null } } } } }),
  ]);

  const page = await client.searchVariants('local', 'connector-1', { search: 'blue', locationGid: 'gid://shopify/Location/9' });
  assert.equal(page.items[0]?.availableAtLocation, null);
});

test('a variant read rejects a location scope that is not an exact Shopify location GID', async () => {
  const { client } = await loggedIn([
    json({ loginOptions: ['BASIC'] }),
    json({ token: 'runtime-token', expirationTime: new Date(Date.now() + 60_000).toISOString() }),
    json({ userId: 'user-1' }),
  ]);

  await assert.rejects(() => client.searchVariants('local', 'connector-1', { search: 'blue', locationGid: '99908026532' }), /exact Shopify location GID/i);
});

test('recent POS orders are read newest first with a capped item preview', async () => {
  const { client, queued } = await loggedIn([
    json({ loginOptions: ['BASIC'] }),
    json({ token: 'runtime-token', expirationTime: new Date(Date.now() + 60_000).toISOString() }),
    json({ userId: 'user-1' }),
    json([{ shopId: 'connector-1', shopifyShopId: 'gid://shopify/Shop/1', domain: 'test.myshopify.com', name: 'Test shop' }]),
    json({ statusCode: 200, response: { data: { orders: { nodes: [{
      id: 'gid://shopify/Order/9', name: '#1009', createdAt: '2026-09-19T10:00:00Z',
      displayFinancialStatus: 'PAID', displayFulfillmentStatus: 'FULFILLED',
      customer: { displayName: 'Ada Lovelace' },
      totalPriceSet: { shopMoney: { amount: '84.00', currencyCode: 'USD' } },
      lineItems: { nodes: [{ title: 'Jacket', quantity: 2 }], pageInfo: { hasNextPage: true } },
    }], pageInfo: { hasNextPage: false, endCursor: null } } } } }),
  ]);

  const page = await client.listPosOrders('local', 'connector-1');

  assert.deepEqual(page.items, [{
    gid: 'gid://shopify/Order/9', name: '#1009', createdAt: '2026-09-19T10:00:00Z',
    financialStatus: 'PAID', fulfillmentStatus: 'FULFILLED', customerName: 'Ada Lovelace',
    total: { amount: '84.00', currency: 'USD' },
    items: [{ title: 'Jacket', quantity: 2 }],
    hasMoreItems: true,
  }]);
  assert.equal(JSON.parse(String(queued.calls.at(-1)?.init?.body)).queryText, listPosOrdersQuery);
});

test('a POS order with no customer or total reads as unknown rather than blank values', async () => {
  const { client } = await loggedIn([
    json({ loginOptions: ['BASIC'] }),
    json({ token: 'runtime-token', expirationTime: new Date(Date.now() + 60_000).toISOString() }),
    json({ userId: 'user-1' }),
    json([{ shopId: 'connector-1', shopifyShopId: 'gid://shopify/Shop/1', domain: 'test.myshopify.com', name: 'Test shop' }]),
    json({ statusCode: 200, response: { data: { orders: { nodes: [{
      id: 'gid://shopify/Order/9', name: '#1009',
      lineItems: { nodes: [], pageInfo: { hasNextPage: false } },
    }], pageInfo: { hasNextPage: false, endCursor: null } } } } }),
  ]);

  const order = (await client.listPosOrders('local', 'connector-1')).items[0];
  assert.equal(order?.customerName, null);
  assert.equal(order?.total, null);
  assert.deepEqual(order?.items, []);
  assert.equal(order?.hasMoreItems, false);
});

test('reads the product variant facts POS add-to-cart planning depends on, and trusts only an exact count', async () => {
  const { client } = await loggedIn([
    json({ loginOptions: ['BASIC'] }),
    json({ token: 'runtime-token', expirationTime: new Date(Date.now() + 60_000).toISOString() }),
    json({ userId: 'user-1' }),
    json([{ shopId: 'connector-1', shopifyShopId: 'gid://shopify/Shop/1', domain: 'test.myshopify.com', name: 'Test shop' }]),
    json({ statusCode: 200, response: { data: { productVariants: { nodes: [
      { id: 'gid://shopify/ProductVariant/1', title: 'Default Title', product: { id: 'gid://shopify/Product/1', title: 'Plain', hasOnlyDefaultVariant: true, variantsCount: { count: 1, precision: 'EXACT' } } },
      { id: 'gid://shopify/ProductVariant/2', title: 'S', product: { id: 'gid://shopify/Product/2', title: 'Sized', hasOnlyDefaultVariant: false, variantsCount: { count: 4, precision: 'EXACT' } } },
      { id: 'gid://shopify/ProductVariant/3', title: 'S', product: { id: 'gid://shopify/Product/3', title: 'Huge', hasOnlyDefaultVariant: false, variantsCount: { count: 250, precision: 'AT_LEAST' } } },
    ], pageInfo: { hasNextPage: false, endCursor: null } } } } }),
  ]);
  const page = await client.searchVariants('local', 'connector-1', { search: 'x', locationGid: 'gid://shopify/Location/1' });
  assert.deepEqual(page.items.map(item => [item.hasOnlyDefaultVariant, item.productVariantCount]), [[true, 1], [false, 4], [false, null]]);
});

test('the order read-back carries the same product variant facts for every line', async () => {
  const { client } = await loggedIn([
    json({ loginOptions: ['BASIC'] }),
    json({ token: 'runtime-token', expirationTime: new Date(Date.now() + 60_000).toISOString() }),
    json({ userId: 'user-1' }),
    json([{ shopId: 'connector-1', shopifyShopId: 'gid://shopify/Shop/1', name: 'Test shop' }]),
    json({ statusCode: 200, response: { data: { order: {
      id: 'gid://shopify/Order/101', legacyResourceId: '101', name: '#101', displayFinancialStatus: 'PAID', displayFulfillmentStatus: null,
      paymentGatewayNames: ['cash'], returnStatus: null, returns: [], refunds: [], fulfillments: [], customer: null, transactions: [], agreements: { nodes: [] },
      totalPriceSet: { shopMoney: { amount: '10.00', currencyCode: 'USD' } },
      lineItems: { nodes: [{ id: 'gid://shopify/LineItem/1', quantity: 1, refundableQuantity: 1, originalUnitPriceSet: { shopMoney: { amount: '10.00', currencyCode: 'USD' } }, variant: { id: 'gid://shopify/ProductVariant/1', title: 'M', sku: null, product: { id: 'gid://shopify/Product/1', title: 'Sized', hasOnlyDefaultVariant: false, variantsCount: { count: 3, precision: 'EXACT' } } } }], pageInfo: { hasNextPage: false } },
    } } } }),
  ]);
  const detail = await client.resolveOrder('local', 'connector-1', { gid: 'gid://shopify/Order/101' });
  assert.equal(detail.lines[0]?.hasOnlyDefaultVariant, false);
  assert.equal(detail.lines[0]?.productVariantCount, 3);
});
