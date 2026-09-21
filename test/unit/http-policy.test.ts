import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createApiServer } from '../../server/app.ts';
import { OmsClient } from '../../core/oms/client.ts';
import { createCoordinator } from '../../core/runner/coordinator.ts';
import type { OmsService } from '../../core/oms/types.ts';

async function withServer(run: (url: string) => Promise<void>, root = process.cwd()): Promise<void> {
  const server = await createApiServer({ port: 0, mode: 'test', root });
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

test('accepts the configured localhost Vite proxy host', async () => {
  const server = await createApiServer({ port: 0, mode: 'test', root: process.cwd(), allowedOrigins: ['http://127.0.0.1:8127'] });
  try {
    const response = await fetch(`${server.url}/api/health`, { headers: { Host: '127.0.0.1:8127' } });
    assert.equal(response.status, 200);
  } finally {
    await server.close();
  }
});

test('exposes setup profiles and empty run history through the authenticated local API', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ios-testing-http-profiles-'));
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
  }, root);
});

test('exposes safe onboarding defaults without returning certificate names or hashes', async () => {
  await withServer(async url => {
    const port = new URL(url).port;
    const defaults = await fetch(`${url}/api/setup/defaults`, { headers: { Host: `127.0.0.1:${port}`, 'X-Local-Session': (await (await fetch(`${url}/api/health`, { headers: { Host: `127.0.0.1:${port}` } })).json() as { sessionToken: string }).sessionToken } });
    assert.equal(defaults.status, 200);
    const body = await defaults.json() as { developmentTeamIds: string[]; recommendedWdaBundleId: string };
    assert.ok(Array.isArray(body.developmentTeamIds));
    assert.match(body.recommendedWdaBundleId, /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/);
    assert.doesNotMatch(JSON.stringify(body), /Apple Development|BEGIN|PRIVATE KEY|[A-Fa-f0-9]{40}/);
  });
});

test('lets the UI add an OMS instance by name without accepting a caller-supplied URL', async () => {
  const oms = new OmsClient([]);
  const server = await createApiServer({ port: 0, mode: 'test', root: process.cwd(), oms });
  try {
    const port = new URL(server.url).port;
    const headers = { Host: `127.0.0.1:${port}`, 'X-Local-Session': server.sessionToken, 'Content-Type': 'application/json' };
    const add = await fetch(`${server.url}/api/oms/connections`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ instanceName: ' Test-Maarg ' }),
    });
    assert.equal(add.status, 201);
    const added = await add.json() as { connection: { id: string; label: string; origin: string; state: string } };
    assert.match(added.connection.id, /^[a-zA-Z0-9_-]+$/);
    assert.equal(added.connection.label, 'test-maarg');
    assert.equal(added.connection.origin, 'https://test-maarg.hotwax.io');
    assert.equal(added.connection.state, 'configured');
    assert.doesNotMatch(JSON.stringify(added), /password|token/i);

    const listed = await fetch(`${server.url}/api/oms/connections`, { headers });
    assert.equal(listed.status, 200);
    assert.deepEqual((await listed.json() as { connections: { origin: string }[] }).connections.map(item => item.origin), ['https://test-maarg.hotwax.io']);

    const callerSuppliedOrigin = await fetch(`${server.url}/api/oms/connections`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ instanceName: 'test-maarg', origin: 'https://attacker.example' }),
    });
    assert.equal(callerSuppliedOrigin.status, 400);
  } finally {
    await server.close();
  }
});

test('keeps OMS credentials on the localhost sidecar and exposes only named reads', async () => {
  let receivedPassword = '';
  const oms: OmsService = {
    connections: () => [{ id: 'local', label: 'Test OMS', origin: 'https://oms.example', state: 'configured' }],
    health: async () => ({ id: 'local', label: 'Test OMS', origin: 'https://oms.example', state: 'connected', userId: 'user-1' }),
    login: async (_id, credentials) => { receivedPassword = credentials.password; return { id: 'local', label: 'Test OMS', origin: 'https://oms.example', state: 'connected', userId: 'user-1' }; },
    logout: async () => undefined,
    shops: async () => [{ connectorShopId: 'shop-1', shopGid: 'gid://shopify/Shop/1', shopDomain: 'test.myshopify.com', name: 'Test', locationGid: null, currency: 'USD', timezone: 'UTC', apiVersion: '2026-01' }],
    searchVariants: async () => ({ items: [], nextCursor: null }),
    searchCustomers: async () => ({ items: [], nextCursor: null }),
    listPosOrders: async () => ({ items: [], nextCursor: null }),
    searchOrders: async () => ({ items: [], nextCursor: null }),
    resolveOrder: async () => ({ gid: 'gid://shopify/Order/1', legacyResourceId: '1', name: '#1', financialStatus: 'PAID', fulfillmentStatus: null, total: { amount: '1.00', currency: 'USD' }, paymentGatewayNames: [], returnStatus: null, returns: [], refunds: [], fulfillments: [], customer: null, transactions: [], agreements: [], lines: [], nextCursor: null }),
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

    const health = await fetch(`${server.url}/api/oms/health?connectionId=local`, { headers });
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { connection: { id: 'local', label: 'Test OMS', origin: 'https://oms.example', state: 'connected', userId: 'user-1' } });

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

test('run requests reject a partial or unsafe frozen target context', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ios-testing-http-context-'));
  const server = await createApiServer({ port: 0, mode: 'test', root, coordinator: createCoordinator({ root }) });
  try {
    const url = server.url;
    const port = new URL(url).port;
    const health = await fetch(`${url}/api/health`, { headers: { Host: `127.0.0.1:${port}` } });
    const { sessionToken, revision } = await health.json() as { sessionToken: string; revision: string };
    const headers = { Host: `127.0.0.1:${port}`, 'X-Local-Session': sessionToken, 'Content-Type': 'application/json' };
    const response = await fetch(`${url}/api/runs/start`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        scriptId: 'pos.open-first-order', deviceProfileId: 'test-ipad', parameters: {}, assertionMode: 'pos', expectedRevision: revision,
        context: { connectionId: 'local', omsOrigin: 'http://unsafe.example', userId: 'user-1', connectorShopId: 'shop-1', shopGid: 'gid://shopify/Shop/1', shopDomain: 'test.myshopify.com', locationGid: 'gid://shopify/Location/1', apiVersion: '2026-01' },
      }),
    });
    assert.equal(response.status, 400);
    assert.match((await response.json() as { error: string }).error, /context|HTTPS|origin/i);
  } finally {
    await server.close();
  }
});

test('exposes mutation readiness without claiming a policy-only store is safe', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ios-testing-http-readiness-'));
  const server = await createApiServer({ port: 0, mode: 'test', root });
  try {
    const port = new URL(server.url).port;
    const response = await fetch(`${server.url}/api/pos/mutation-readiness`, {
      headers: { Host: `127.0.0.1:${port}`, 'X-Local-Session': server.sessionToken },
    });
    assert.equal(response.status, 404);
  } finally {
    await server.close();
  }
});

test('lists only safe-named run artifacts, serves screenshots as PNGs, and blocks unsafe or unauthenticated reads', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ios-testing-http-artifacts-'));
  const runId = 'run-artifact-test';
  const artifactsDir = join(root, '.runtime', 'runs', runId, 'artifacts');
  await mkdir(join(artifactsDir, 'nested'), { recursive: true });
  const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);
  await writeFile(join(artifactsDir, 'cart-before-payment.png'), pngBytes);
  await writeFile(join(artifactsDir, 'progress.ndjson'), '{}\n');
  // A name a browser would never produce from this run's own writer, kept on
  // disk to prove the listing filters it out rather than merely not creating it.
  await writeFile(join(artifactsDir, 'weird name.png'), pngBytes);
  await writeFile(join(artifactsDir, 'nested', 'inner.png'), pngBytes);

  await withServer(async url => {
    const port = new URL(url).port;

    // (d) No session header is rejected the same way every other /api route is.
    const unauthenticated = await fetch(`${url}/api/runs/${runId}/artifacts`, { headers: { Host: `127.0.0.1:${port}` } });
    assert.equal(unauthenticated.status, 401);

    const health = await fetch(`${url}/api/health`, { headers: { Host: `127.0.0.1:${port}` } });
    const { sessionToken } = await health.json() as { sessionToken: string };
    const headers = { Host: `127.0.0.1:${port}`, 'X-Local-Session': sessionToken };

    // (a) The listing only reports the two safely-named regular files.
    const list = await fetch(`${url}/api/runs/${runId}/artifacts`, { headers });
    assert.equal(list.status, 200);
    const body = await list.json() as { artifacts: { name: string; kind: string; size: number; modifiedAt: string }[] };
    assert.deepEqual(body.artifacts.map(entry => entry.name).sort(), ['cart-before-payment.png', 'progress.ndjson']);
    const screenshot = body.artifacts.find(entry => entry.name === 'cart-before-payment.png');
    assert.equal(screenshot?.kind, 'screenshot');
    assert.equal(screenshot?.size, pngBytes.length);
    assert.ok(typeof screenshot?.modifiedAt === 'string' && !Number.isNaN(Date.parse(screenshot.modifiedAt)));
    assert.equal(body.artifacts.find(entry => entry.name === 'progress.ndjson')?.kind, 'file');

    // (b) The PNG is served with the right content type and the exact bytes.
    const png = await fetch(`${url}/api/runs/${runId}/artifacts/cart-before-payment.png`, { headers });
    assert.equal(png.status, 200);
    assert.equal(png.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await png.arrayBuffer()), pngBytes);

    // (c) A non-PNG file, an encoded traversal attempt, and a name containing
    // a literal slash are all rejected with 404, never a 200 or a 500.
    const nonPng = await fetch(`${url}/api/runs/${runId}/artifacts/progress.ndjson`, { headers });
    assert.equal(nonPng.status, 404);

    const encodedTraversal = await fetch(`${url}/api/runs/${runId}/artifacts/..%2F..%2Fpackage.json`, { headers });
    assert.equal(encodedTraversal.status, 404);

    const slashName = await fetch(`${url}/api/runs/${runId}/artifacts/nested/inner.png`, { headers });
    assert.equal(slashName.status, 404);
  }, root);
});
