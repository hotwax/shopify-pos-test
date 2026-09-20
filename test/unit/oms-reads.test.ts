import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OmsClient } from '../../core/oms/client.ts';
import { resolveOrderQuery, searchVariantsQuery } from '../../core/oms/queries/documents.ts';
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
  assert.deepEqual(page.items, [{ gid: 'gid://shopify/ProductVariant/1', productGid: 'gid://shopify/Product/1', title: 'Blue', productTitle: 'Shirt', sku: 'BLUE' }]);
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
    { connectorShopId: 'connector-1', shopGid: 'gid://shopify/Shop/1', shopDomain: '', name: 'Test shop', locationGid: 'gid://shopify/Location/99908026532', currency: null, timezone: null },
    { connectorShopId: 'connector-2', shopGid: 'gid://shopify/Shop/2', shopDomain: '', name: 'Other shop', locationGid: 'gid://shopify/Location/2', currency: null, timezone: null },
    { connectorShopId: 'connector-3', shopGid: 'gid://shopify/Shop/3', shopDomain: '', name: 'Unknown shop', locationGid: null, currency: null, timezone: null },
  ]);
});

test('resolves an exact Shopify order GID into safe line detail', async () => {
  const { client, queued } = await loggedIn([
    json({ loginOptions: ['BASIC'] }),
    json({ token: 'runtime-token', expirationTime: new Date(Date.now() + 60_000).toISOString() }),
    json({ userId: 'user-1' }),
    json([{ shopId: 'connector-1', shopifyShopId: 'gid://shopify/Shop/1', name: 'Test shop' }]),
    json({ statusCode: 200, response: { data: { order: {
      id: 'gid://shopify/Order/100', legacyResourceId: '100', name: '#100', displayFinancialStatus: 'PAID', displayFulfillmentStatus: 'UNFULFILLED',
      totalPriceSet: { shopMoney: { amount: '12.50', currencyCode: 'USD' } },
      lineItems: { nodes: [{ id: 'gid://shopify/LineItem/1', quantity: 2, refundableQuantity: 2, originalUnitPriceSet: { shopMoney: { amount: '6.25', currencyCode: 'USD' } }, variant: { id: 'gid://shopify/ProductVariant/1', title: 'Blue', sku: 'BLUE', product: { id: 'gid://shopify/Product/1', title: 'Shirt' } } }], pageInfo: { hasNextPage: false } },
    } } } }),
  ]);
  const detail = await client.resolveOrder('local', 'connector-1', { gid: 'gid://shopify/Order/100' });
  assert.deepEqual(detail, {
    gid: 'gid://shopify/Order/100', legacyResourceId: '100', name: '#100', financialStatus: 'PAID', fulfillmentStatus: 'UNFULFILLED', total: { amount: '12.50', currency: 'USD' },
    lines: [{ gid: 'gid://shopify/LineItem/1', quantity: 2, refundableQuantity: 2, unitPrice: { amount: '6.25', currency: 'USD' }, variantGid: 'gid://shopify/ProductVariant/1', variantTitle: 'Blue', sku: 'BLUE', productGid: 'gid://shopify/Product/1', productTitle: 'Shirt' }], nextCursor: null,
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
