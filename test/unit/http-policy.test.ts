import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApiServer } from '../../server/app.ts';
import type { OmsService } from '../../core/oms/types.ts';

async function withServer(run: (url: string) => Promise<void>): Promise<void> {
  const server = await createApiServer({ port: 0, mode: 'test', root: process.cwd() });
  try {
    await run(`http://127.0.0.1:${server.port}`);
  } finally {
    await server.close();
  }
}

test('serves health only on loopback with a per-launch session token', async () => {
  await withServer(async url => {
    const health = await fetch(`${url}/api/health`, {
      headers: { Host: `127.0.0.1:${new URL(url).port}` },
    });
    assert.equal(health.status, 200);
    const body = await health.json() as { ok: boolean; sessionToken: string };
    assert.equal(body.ok, true);
    assert.ok(body.sessionToken.length > 20);

    const missing = await fetch(`${url}/api/catalog`, {
      headers: { Host: `127.0.0.1:${new URL(url).port}` },
    });
    assert.equal(missing.status, 401);

    const catalog = await fetch(`${url}/api/catalog`, {
      headers: {
        Host: `127.0.0.1:${new URL(url).port}`,
        Origin: url,
        'X-Local-Session': body.sessionToken,
      },
    });
    assert.equal(catalog.status, 200);
  });
});

test('rejects hostile origins and unknown API paths', async () => {
  await withServer(async url => {
    const port = new URL(url).port;
    const health = await fetch(`${url}/api/health`, { headers: { Host: `127.0.0.1:${port}` } });
    const { sessionToken } = await health.json() as { sessionToken: string };

    const hostile = await fetch(`${url}/api/catalog`, {
      headers: {
        Host: `127.0.0.1:${port}`,
        Origin: 'https://evil.example',
        'X-Local-Session': sessionToken,
      },
    });
    assert.equal(hostile.status, 403);

    const unknown = await fetch(`${url}/api/arbitrary-shell`, {
      headers: { Host: `127.0.0.1:${port}`, 'X-Local-Session': sessionToken },
    });
    assert.equal(unknown.status, 404);
  });
});

test('exposes setup profiles and empty run history through the authenticated local API', async () => {
  await withServer(async url => {
    const port = new URL(url).port;
    const health = await fetch(`${url}/api/health`, { headers: { Host: `127.0.0.1:${port}` } });
    const { sessionToken } = await health.json() as { sessionToken: string };
    const headers = { Host: `127.0.0.1:${port}`, 'X-Local-Session': sessionToken };

    const profiles = await fetch(`${url}/api/setup/profiles`, { headers });
    assert.equal(profiles.status, 200);
    assert.deepEqual((await profiles.json() as { profiles: unknown[] }).profiles, []);

    const runs = await fetch(`${url}/api/runs`, { headers });
    assert.equal(runs.status, 200);
    assert.ok(Array.isArray((await runs.json() as { runs: unknown[] }).runs));
  });
});

test('keeps OMS credentials on the localhost sidecar and exposes only named reads', async () => {
  let receivedPassword = '';
  const oms: OmsService = {
    connections: () => [{ id: 'local', label: 'Test OMS', origin: 'https://oms.example', state: 'configured' }],
    login: async (_id, credentials) => { receivedPassword = credentials.password; return { id: 'local', label: 'Test OMS', origin: 'https://oms.example', state: 'connected', userId: 'user-1' }; },
    logout: async () => undefined,
    shops: async () => [{ connectorShopId: 'shop-1', shopGid: 'gid://shopify/Shop/1', shopDomain: 'test.myshopify.com', name: 'Test', locationGid: null, currency: 'USD', timezone: 'UTC' }],
    searchVariants: async () => ({ items: [], nextCursor: null }),
    searchOrders: async () => ({ items: [], nextCursor: null }),
    resolveOrder: async () => ({ gid: 'gid://shopify/Order/1', legacyResourceId: '1', name: '#1', financialStatus: 'PAID', fulfillmentStatus: null, total: { amount: '1.00', currency: 'USD' }, lines: [], nextCursor: null }),
    searchOrderRecords: async () => ({ items: [{ orderId: 'M1', orderName: 'M1', externalId: null, statusId: 'ORDER_APPROVED', orderDate: null, grandTotal: null, currency: null, itemCount: 0 }], nextCursor: null }),
    getOrderDetail: async () => ({ orderId: 'M1', orderName: 'M1', externalId: null, statusId: 'ORDER_APPROVED', orderDate: null, grandTotal: null, currency: null, items: [] }),
    listLocations: async () => ({ items: [], nextCursor: null }),
  };
  const server = await createApiServer({ port: 0, mode: 'test', root: process.cwd(), oms });
  try {
    const port = new URL(server.url).port;
    const headers = { Host: `127.0.0.1:${port}`, 'X-Local-Session': server.sessionToken, 'Content-Type': 'application/json' };
    const login = await fetch(`${server.url}/api/oms/login`, { method: 'POST', headers, body: JSON.stringify({ connectionId: 'local', username: 'tester', password: 'sidecar-only' }) });
    assert.equal(login.status, 200);
    assert.equal(receivedPassword, 'sidecar-only');
    assert.doesNotMatch(await login.text(), /sidecar-only/);

    const shops = await fetch(`${server.url}/api/oms/shops?connectionId=local`, { headers });
    assert.equal(shops.status, 200);
    assert.equal((await shops.json() as { shops: { connectorShopId: string }[] }).shops[0]?.connectorShopId, 'shop-1');

    const records = await fetch(`${server.url}/api/oms/orders/records`, { method: 'POST', headers, body: JSON.stringify({ connectionId: 'local' }) });
    assert.equal(records.status, 200);
    assert.equal((await records.json() as { items: { orderId: string }[] }).items[0]?.orderId, 'M1');

    const detail = await fetch(`${server.url}/api/oms/orders/detail`, { method: 'POST', headers, body: JSON.stringify({ connectionId: 'local', orderId: 'M1' }) });
    assert.equal(detail.status, 200);
    assert.equal((await detail.json() as { order: { orderId: string } }).order.orderId, 'M1');

    const shopifyDetail = await fetch(`${server.url}/api/oms/orders/shopify-detail`, { method: 'POST', headers, body: JSON.stringify({ connectionId: 'local', shopId: 'shop-1', gid: 'gid://shopify/Order/1' }) });
    assert.equal(shopifyDetail.status, 200);
    assert.equal((await shopifyDetail.json() as { order: { gid: string } }).order.gid, 'gid://shopify/Order/1');

    const unsafeShopifyDetail = await fetch(`${server.url}/api/oms/orders/shopify-detail`, { method: 'POST', headers, body: JSON.stringify({ connectionId: 'local', shopId: 'shop-1', gid: 'gid://shopify/Product/1' }) });
    assert.equal(unsafeShopifyDetail.status, 400);

    const unsafeDetail = await fetch(`${server.url}/api/oms/orders/detail`, { method: 'POST', headers, body: JSON.stringify({ connectionId: 'local', orderId: '../M1' }) });
    assert.equal(unsafeDetail.status, 400);

    const arbitrary = await fetch(`${server.url}/api/oms/graphql`, { headers });
    assert.equal(arbitrary.status, 404);
  } finally {
    await server.close();
  }
});
