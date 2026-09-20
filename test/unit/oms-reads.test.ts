import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OmsClient } from '../../core/oms/client.ts';
import { searchVariantsQuery } from '../../core/oms/queries/documents.ts';
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
