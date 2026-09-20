import { OmsError, canonicalOrigin, type OmsConnectionConfig } from './types.ts';

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

interface Session {
  token: string;
  userId: string;
  expiresAt: string;
}

function jsonBody(body: unknown): Record<string, any> {
  if (!body || typeof body !== 'object') return {};
  return body as Record<string, any>;
}

function expiration(value: unknown): string {
  const date = typeof value === 'number' ? new Date(value < 10_000_000_000 ? value * 1000 : value) : new Date(String(value ?? ''));
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date(Date.now() + 60 * 60 * 1000).toISOString();
}

async function parseJson(response: Response): Promise<unknown> {
  try { return await response.json(); } catch { return {}; }
}

async function request(origin: string, path: string, init: RequestInit, fetchImpl: FetchLike): Promise<{ response: Response; body: Record<string, any> }> {
  const safeOrigin = canonicalOrigin(origin);
  let response: Response;
  try {
    response = await fetchImpl(`${safeOrigin}${path}`, { ...init, redirect: 'manual' });
  } catch {
    throw new OmsError('transport', 'The OMS request could not be completed.');
  }
  if (response.status >= 300 && response.status < 400) throw new OmsError('transport', 'The OMS returned a redirect; credentials were not forwarded.');
  return { response, body: jsonBody(await parseJson(response)) };
}

function classifyStatus(status: number): OmsError['code'] {
  return status === 401 ? 'authentication' : status === 403 ? 'authorization' : status === 429 ? 'rate-limited' : 'transport';
}

export class OmsSessionStore {
  private readonly sessions = new Map<string, Session>();

  constructor(private readonly fetchImpl: FetchLike = fetch) {}

  async login(connection: OmsConnectionConfig, credentials: { username: string; password: string }): Promise<{ userId: string; expiresAt: string }> {
    if (!credentials.username.trim() || !credentials.password) throw new OmsError('authentication', 'Username and password are required.');
    const options = await request(connection.origin, '/rest/s1/admin/checkLoginOptions', { method: 'GET', headers: { Accept: 'application/json' } }, this.fetchImpl);
    if (!options.response.ok) throw new OmsError(classifyStatus(options.response.status), 'The OMS login options could not be read.', options.response.status);
    if (!JSON.stringify(options.body).toLowerCase().includes('basic')) throw new OmsError('authentication', 'This OMS does not advertise the supported BASIC login mode.');

    const login = await request(connection.origin, '/rest/s1/admin/login', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: credentials.username, password: credentials.password }),
    }, this.fetchImpl);
    if (!login.response.ok) throw new OmsError(classifyStatus(login.response.status), 'The OMS rejected the login.', login.response.status);
    const token = String(login.body.token ?? login.body.data?.token ?? login.body.result?.token ?? '');
    if (!token) throw new OmsError('authentication', 'The OMS login response did not contain a session token.');
    const expiresAt = expiration(login.body.expirationTime ?? login.body.data?.expirationTime ?? login.body.result?.expirationTime);

    const profile = await request(connection.origin, '/rest/s1/admin/user/profile', { method: 'GET', headers: { Accept: 'application/json', Authorization: `Bearer ${token}` } }, this.fetchImpl);
    if (!profile.response.ok) throw new OmsError(classifyStatus(profile.response.status), 'The OMS user profile could not be read.', profile.response.status);
    const userId = String(profile.body.userId ?? profile.body.user?.userId ?? profile.body.user?.id ?? profile.body.username ?? '');
    if (!userId) throw new OmsError('authentication', 'The OMS profile did not identify the authenticated user.');
    this.sessions.set(connection.id, { token, userId, expiresAt });
    return { userId, expiresAt };
  }

  async logout(connection: OmsConnectionConfig): Promise<void> {
    const session = this.sessions.get(connection.id);
    this.sessions.delete(connection.id);
    if (!session) return;
    try {
      await request(connection.origin, '/rest/s1/admin/logout', { method: 'POST', headers: { Accept: 'application/json', Authorization: `Bearer ${session.token}` } }, this.fetchImpl);
    } catch { /* local logout still clears the in-memory session */ }
  }

  status(connectionId: string): { state: 'configured' | 'connected' | 'expired'; userId?: string; expiresAt?: string } {
    const session = this.sessions.get(connectionId);
    if (!session) return { state: 'configured' };
    if (Date.parse(session.expiresAt) <= Date.now()) {
      this.sessions.delete(connectionId);
      return { state: 'expired', expiresAt: session.expiresAt };
    }
    return { state: 'connected', userId: session.userId, expiresAt: session.expiresAt };
  }

  clear(connectionId: string): void {
    this.sessions.delete(connectionId);
  }

  token(connectionId: string): string {
    const session = this.sessions.get(connectionId);
    if (!session || Date.parse(session.expiresAt) <= Date.now()) {
      this.sessions.delete(connectionId);
      throw new OmsError('authentication', 'Log in to the OMS connection again.');
    }
    return session.token;
  }
}
