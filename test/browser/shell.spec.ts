import assert from 'node:assert/strict';
import { cp, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { createApiServer } from '../../server/app.ts';

test('built localhost shell serves the SPA and its catalog API', async () => {
  const repositoryRoot = resolve(import.meta.dirname, '../..');
  const dataRoot = await mkdtemp(join(tmpdir(), 'ios-testing-shell-'));
  await cp(join(repositoryRoot, 'scripts', 'catalog'), join(dataRoot, 'scripts', 'catalog'), { recursive: true });
  const server = await createApiServer({
    port: 0,
    mode: 'serve',
    root: dataRoot,
    staticDir: join(repositoryRoot, 'dist'),
  });
  try {
    const root = await fetch(`${server.url}/`, { headers: { Host: `127.0.0.1:${server.port}` } });
    assert.equal(root.status, 200);
    assert.match(await root.text(), /HotWax POS Testing/);
    const contentSecurityPolicy = root.headers.get('content-security-policy') ?? '';
    assert.match(contentSecurityPolicy, /style-src 'self' 'unsafe-inline'/);
    assert.doesNotMatch(contentSecurityPolicy, /script-src[^;]*unsafe-inline/);

    const spaRoute = await fetch(`${server.url}/scripts`, { headers: { Host: `127.0.0.1:${server.port}` } });
    assert.equal(spaRoute.status, 200);
    assert.match(await spaRoute.text(), /<div id="app"><\/div>/);

    for (const route of ['/onboarding', '/onboarding/mac', '/onboarding/ipad', '/onboarding/oms', '/setup', '/scripts/pos.open-first-order', '/scripts/pos.inspect-screen', '/scripts/pos.inspect-cart', '/scripts/pos.inspect-product-search', '/scripts/pos.inspect-order-actions', '/scripts/pos.inspect-return-surface', '/scripts/pos.navigate-home', '/scripts/pos.inspect-location', '/scripts/pos.inspect-store-context', '/scripts/pos.create-cash-order', '/scripts/pos.return-cash-order', '/scripts/pos.exchange-cash-order', '/pos', '/connections', '/runs']) {
      const page = await fetch(`${server.url}${route}`, { headers: { Host: `127.0.0.1:${server.port}` } });
      assert.equal(page.status, 200, route);
      assert.match(await page.text(), /<div id="app"><\/div>/, route);
    }

    const catalog = await fetch(`${server.url}/api/catalog`, {
      headers: { Host: `127.0.0.1:${server.port}`, 'X-Local-Session': server.sessionToken },
    });
    assert.equal(catalog.status, 200);
    // Counted from scripts/catalog rather than pinned, so adding a scenario
    // does not fail a test that is really about the API serving the catalog.
    const catalogFiles = (await readdir(join(repositoryRoot, 'scripts', 'catalog'))).filter(name => name.endsWith('.json'));
    assert.equal((await catalog.json() as { scripts: unknown[] }).scripts.length, catalogFiles.length);

    const profiles = await fetch(`${server.url}/api/setup/profiles`, {
      headers: { Host: `127.0.0.1:${server.port}`, 'X-Local-Session': server.sessionToken },
    });
    assert.equal(profiles.status, 200);
    assert.deepEqual((await profiles.json() as { profiles: unknown[] }).profiles, []);

    const runs = await fetch(`${server.url}/api/runs`, {
      headers: { Host: `127.0.0.1:${server.port}`, 'X-Local-Session': server.sessionToken },
    });
    assert.equal(runs.status, 200);
    assert.ok(Array.isArray((await runs.json() as { runs: unknown[] }).runs));
  } finally {
    await server.close();
    await rm(dataRoot, { recursive: true, force: true });
  }
});
