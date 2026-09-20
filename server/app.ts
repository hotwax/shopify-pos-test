import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { execFileSync } from 'node:child_process';
import { loadCatalog } from '../core/catalog/load.ts';
import { listDevices, runSetupChecks } from '../core/setup/checks.ts';
import { loadDeviceProfiles, saveDeviceProfile } from '../core/storage/profiles.ts';
import { createRunStorage } from '../core/storage/runs.ts';
import type { DeviceProfile, RunRequest } from '../shared/contracts.ts';
import type { RunCoordinator } from '../core/runner/coordinator.ts';
import { createLocalSession, sessionMatches, type LaunchMode } from './session.ts';
import { sendJson, sendText } from './routes.ts';
import { serveStatic } from './static.ts';

export interface ApiServerOptions {
  port: number;
  mode: LaunchMode;
  root: string;
  staticDir?: string;
  allowedOrigins?: string[];
  coordinator?: RunCoordinator;
}

export interface ServerHandle {
  server: Server;
  port: number;
  sessionToken: string;
  url: string;
  close(): Promise<void>;
}

function loopbackHost(host: string | undefined, port: number): boolean {
  if (!host) return false;
  const normalized = host.toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
  return normalized === `127.0.0.1:${port}` || normalized === `localhost:${port}` || normalized === `127.0.0.1` || normalized === 'localhost';
}

function originAllowed(origin: string | undefined, allowed: string[]): boolean {
  return !origin || allowed.includes(origin);
}

function securityHeaders(response: ServerResponse): void {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'self' http://127.0.0.1:* http://localhost:*; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
}

function authenticate(request: IncomingMessage, response: ServerResponse, token: string, allowedOrigins: string[]): boolean {
  if (!originAllowed(request.headers.origin, allowedOrigins)) {
    sendJson(response, 403, { ok: false, error: 'Origin is not allowed.' });
    return false;
  }
  if (!sessionMatches(token, request.headers['x-local-session'] as string | undefined)) {
    sendJson(response, 401, { ok: false, error: 'A valid local session is required.' });
    return false;
  }
  return true;
}

async function readBody(request: IncomingMessage, limit = 64_000): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk as Buffer);
    size += buffer.length;
    if (size > limit) throw new Error('Request body is too large.');
    chunks.push(buffer);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

function validProfile(value: unknown): value is DeviceProfile {
  if (!value || typeof value !== 'object') return false;
  const profile = value as Partial<DeviceProfile>;
  return typeof profile.id === 'string' && typeof profile.udid === 'string' && typeof profile.teamId === 'string' && typeof profile.wdaBundleId === 'string';
}

function validRunRequest(value: unknown): value is RunRequest {
  if (!value || typeof value !== 'object') return false;
  const request = value as Partial<RunRequest>;
  return typeof request.scriptId === 'string' && typeof request.deviceProfileId === 'string' &&
    typeof request.assertionMode === 'string' && typeof request.expectedRevision === 'string' &&
    !!request.parameters && typeof request.parameters === 'object';
}

export async function createApiServer(options: ApiServerOptions): Promise<ServerHandle> {
  const session = createLocalSession();
  let revision = 'unversioned';
  try { revision = execFileSync('git', ['-C', options.root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { /* source may not be a Git checkout */ }
  const server = createServer(async (request, response) => {
    securityHeaders(response);
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : options.port;
    if (!loopbackHost(request.headers.host, port)) {
      sendJson(response, 403, { ok: false, error: 'Loopback host required.' });
      return;
    }
    const url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`);
    if (request.method === 'GET' && url.pathname === '/api/health') {
      sendJson(response, 200, { ok: true, mode: options.mode, sessionToken: session.token, revision });
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      const allowedOrigins = options.allowedOrigins ?? [
        `http://127.0.0.1:${port}`,
        `http://localhost:${port}`,
        'http://127.0.0.1:8127',
        'http://localhost:8127',
      ];
      if (!authenticate(request, response, session.token, allowedOrigins)) return;
      if (request.method === 'GET' && url.pathname === '/api/setup/devices') {
        try { sendJson(response, 200, { devices: await listDevices() }); }
        catch (error) { sendJson(response, 200, { devices: [], error: error instanceof Error ? error.message : 'Could not list devices.' }); }
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/setup/profiles') {
        sendJson(response, 200, { profiles: await loadDeviceProfiles(options.root) });
        return;
      }
      if (request.method === 'POST' && url.pathname === '/api/setup/check') {
        try {
          const body = await readBody(request);
          if (!validProfile(body)) { sendJson(response, 400, { ok: false, error: 'A complete device profile is required.' }); return; }
          sendJson(response, 200, { checks: await runSetupChecks(body) });
        } catch (error) { sendJson(response, 400, { ok: false, error: error instanceof Error ? error.message : 'Setup check failed.' }); }
        return;
      }
      if (request.method === 'POST' && url.pathname === '/api/setup/profile') {
        try {
          const body = await readBody(request);
          if (!validProfile(body)) { sendJson(response, 400, { ok: false, error: 'A complete device profile is required.' }); return; }
          await saveDeviceProfile(options.root, body);
          sendJson(response, 200, { ok: true, profiles: await loadDeviceProfiles(options.root) });
        } catch (error) { sendJson(response, 400, { ok: false, error: error instanceof Error ? error.message : 'Profile could not be saved.' }); }
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/catalog') {
        const catalog = await loadCatalog(options.root);
        sendJson(response, 200, catalog);
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/runs') {
        sendJson(response, 200, { runs: options.coordinator ? await options.coordinator.listRuns() : await createRunStorage(options.root).list() });
        return;
      }
      const runMatch = url.pathname.match(/^\/api\/runs\/([a-zA-Z0-9_-]+)(?:\/(events|stop))?$/);
      if (runMatch) {
        const runId = runMatch[1];
        const action = runMatch[2];
        if (action === 'events' && request.method === 'GET') {
          const coordinator = options.coordinator;
          if (!coordinator) { sendJson(response, 503, { ok: false, error: 'Run coordinator is unavailable.' }); return; }
          response.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
          const unsubscribe = coordinator.subscribeRun(runId, Number(url.searchParams.get('after') ?? '0'), event => response.write(`data: ${JSON.stringify(event)}\n\n`));
          request.on('close', unsubscribe);
          return;
        }
        if (action === 'stop' && request.method === 'POST') {
          if (!options.coordinator) { sendJson(response, 503, { ok: false, error: 'Run coordinator is unavailable.' }); return; }
          await options.coordinator.requestStop(runId);
          sendJson(response, 202, { ok: true, requested: true });
          return;
        }
        if (!action && request.method === 'GET') {
          try { sendJson(response, 200, await (options.coordinator ? options.coordinator.getRun(runId) : createRunStorage(options.root).get(runId))); }
          catch { sendJson(response, 404, { ok: false, error: 'Run was not found.' }); }
          return;
        }
      }
      if (request.method === 'POST' && url.pathname === '/api/runs/start') {
        if (!options.coordinator) { sendJson(response, 503, { ok: false, error: 'Run coordinator is unavailable.' }); return; }
        try {
          const body = await readBody(request);
          if (!validRunRequest(body)) { sendJson(response, 400, { ok: false, error: 'A valid named script run request is required.' }); return; }
          if (body.expectedRevision.length > 100 || body.scriptId.length > 100 || body.deviceProfileId.length > 100) { sendJson(response, 400, { ok: false, error: 'Run request is too large.' }); return; }
          sendJson(response, 202, await options.coordinator.startRun(body));
        } catch (error) { sendJson(response, 400, { ok: false, error: error instanceof Error ? error.message : 'Run could not be started.' }); }
        return;
      }
      sendJson(response, 404, { ok: false, error: 'Unknown API route.' });
      return;
    }
    if (options.mode === 'serve' && options.staticDir && request.method === 'GET' && await serveStatic(options.staticDir, url.pathname, response)) return;
    sendText(response, 404, 'Not found');
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => { server.off('listening', onListening); reject(error); };
    const onListening = () => { server.off('error', onError); resolve(); };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(options.port, '127.0.0.1');
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : options.port;
  return {
    server,
    port,
    sessionToken: session.token,
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
  };
}
