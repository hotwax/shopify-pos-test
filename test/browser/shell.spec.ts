import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { createApiServer } from '../../server/app.ts';

test('built localhost shell serves the SPA and its catalog API', async () => {
  const server = await createApiServer({
    port: 0,
    mode: 'serve',
    root: resolve(import.meta.dirname, '../..'),
    staticDir: resolve(import.meta.dirname, '../../dist'),
  });
  try {
    const root = await fetch(`${server.url}/`, { headers: { Host: `127.0.0.1:${server.port}` } });
    assert.equal(root.status, 200);
    assert.match(await root.text(), /HotWax POS Testing/);

    const spaRoute = await fetch(`${server.url}/scripts`, { headers: { Host: `127.0.0.1:${server.port}` } });
    assert.equal(spaRoute.status, 200);
    assert.match(await spaRoute.text(), /<div id="app"><\/div>/);

    for (const route of ['/setup', '/scripts/pos.open-first-order', '/scripts/pos.inspect-screen', '/scripts/pos.inspect-cart', '/pos', '/connections', '/runs']) {
      const page = await fetch(`${server.url}${route}`, { headers: { Host: `127.0.0.1:${server.port}` } });
      assert.equal(page.status, 200, route);
      assert.match(await page.text(), /<div id="app"><\/div>/, route);
    }

    const catalog = await fetch(`${server.url}/api/catalog`, {
      headers: { Host: `127.0.0.1:${server.port}`, 'X-Local-Session': server.sessionToken },
    });
    assert.equal(catalog.status, 200);
    assert.equal((await catalog.json() as { scripts: unknown[] }).scripts.length, 3);

    const profiles = await fetch(`${server.url}/api/setup/profiles`, {
      headers: { Host: `127.0.0.1:${server.port}`, 'X-Local-Session': server.sessionToken },
    });
    assert.equal(profiles.status, 200);
    assert.deepEqual((await profiles.json() as { profiles: unknown[] }).profiles, []);

    const readiness = await fetch(`${server.url}/api/pos/mutation-readiness`, {
      headers: { Host: `127.0.0.1:${server.port}`, 'X-Local-Session': server.sessionToken },
    });
    assert.equal(readiness.status, 200);
    assert.equal((await readiness.json() as { enabled: boolean }).enabled, false);

    const runs = await fetch(`${server.url}/api/runs`, {
      headers: { Host: `127.0.0.1:${server.port}`, 'X-Local-Session': server.sessionToken },
    });
    assert.equal(runs.status, 200);
    assert.ok(Array.isArray((await runs.json() as { runs: unknown[] }).runs));
  } finally {
    await server.close();
  }
});
