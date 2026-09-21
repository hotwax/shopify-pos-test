import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OmsSessionStore } from '../../core/oms/auth.ts';
import { canonicalOrigin, OmsError } from '../../core/oms/types.ts';

function json(value: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

test('canonicalizes only credential-safe HTTPS OMS origins', () => {
  assert.equal(canonicalOrigin('https://oms.example/'), 'https://oms.example');
  assert.throws(() => canonicalOrigin('http://oms.example'), (error: unknown) => error instanceof OmsError && error.code === 'configuration');
  assert.throws(() => canonicalOrigin('https://user:pass@oms.example'), (error: unknown) => error instanceof OmsError && error.code === 'configuration');
  assert.throws(() => canonicalOrigin('https://oms.example/rest/s1'), (error: unknown) => error instanceof OmsError && error.code === 'configuration');
});

test('keeps the bearer session in memory and clears it on logout', async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl = async (input: string | URL, init?: RequestInit): Promise<Response> => {
    calls.push({ url: String(input), init });
    if (calls.length === 1) return json({ loginOptions: ['BASIC'] });
    if (calls.length === 2) return json({ token: 'runtime-only-token', expirationTime: new Date(Date.now() + 60_000).toISOString() });
    if (calls.length === 3) return json({ userId: 'user-1' });
    return json({ ok: true });
  };
  const store = new OmsSessionStore(fetchImpl);
  const session = await store.login({ id: 'local', label: 'Test', origin: 'https://oms.example' }, { username: 'tester', password: 'not-stored' });
  assert.equal(session.userId, 'user-1');
  assert.equal(store.status('local').state, 'connected');
  assert.equal(store.token('local'), 'runtime-only-token');
  await store.logout({ id: 'local', label: 'Test', origin: 'https://oms.example' });
  assert.equal(store.status('local').state, 'configured');
  assert.equal(calls[1]?.init?.body, JSON.stringify({ username: 'tester', password: 'not-stored' }));
  assert.equal(calls[3]?.init?.headers && new Headers(calls[3].init.headers).get('Authorization'), 'Bearer runtime-only-token');
});

test('does not follow an OMS redirect during login', async () => {
  const store = new OmsSessionStore(async () => new Response(null, { status: 302, headers: { Location: 'https://other.example/login' } }));
  await assert.rejects(() => store.login({ id: 'local', label: 'Test', origin: 'https://oms.example' }, { username: 'tester', password: 'secret' }), (error: unknown) => error instanceof OmsError && error.code === 'transport');
});
