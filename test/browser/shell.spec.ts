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

    const catalog = await fetch(`${server.url}/api/catalog`, {
      headers: { Host: `127.0.0.1:${server.port}`, 'X-Local-Session': server.sessionToken },
    });
    assert.equal(catalog.status, 200);
    assert.equal((await catalog.json() as { scripts: unknown[] }).scripts.length, 1);
  } finally {
    await server.close();
  }
});
