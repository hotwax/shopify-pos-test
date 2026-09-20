import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApiServer } from '../../server/app.ts';

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
