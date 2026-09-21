import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { lstat, open, readdir, readFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadCatalog } from '../core/catalog/load.ts';
import { listDevices, listDevelopmentTeamIds, probeRemoteXpcTunnel, runHostChecks, runSetupChecks } from '../core/setup/checks.ts';
import { loadDeviceProfiles, saveDeviceProfile } from '../core/storage/profiles.ts';
import { createRunStorage } from '../core/storage/runs.ts';
import { OmsError, type OmsService } from '../core/oms/types.ts';
import type { DeviceProfile, RunRequest, SetupDefaults } from '../shared/contracts.ts';
import type { RunCoordinator } from '../core/runner/coordinator.ts';
import { createLocalSession, sessionMatches, type LaunchMode } from './session.ts';
import { sendJson, sendText } from './routes.ts';
import { serveStatic } from './static.ts';
import { isValidTargetContext } from '../core/safety/environment.ts';
import { forgetOmsCredential, listSavedOmsConnections, readOmsCredential, saveOmsCredential } from '../core/storage/credentials.ts';
import { validateRunRequestAgainstCatalog } from '../core/catalog/validate.ts';
import { registry } from '../test/scenarios/registry.ts';

export interface ApiServerOptions {
  port: number;
  mode: LaunchMode;
  root: string;
  staticDir?: string;
  allowedOrigins?: string[];
  coordinator?: RunCoordinator;
  oms?: OmsService;
}

export interface ServerHandle {
  server: Server;
  port: number;
  sessionToken: string;
  url: string;
  close(): Promise<void>;
}

function loopbackHost(host: string | undefined, port: number, additionalHosts: string[] = []): boolean {
  if (!host) return false;
  const normalized = host.toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
  if (normalized === `127.0.0.1:${port}` || normalized === `localhost:${port}` || normalized === '127.0.0.1' || normalized === 'localhost') return true;
  return additionalHosts.some(candidate => candidate.toLowerCase().replace(/^\[/, '').replace(/\]$/, '') === normalized);
}

function originAllowed(origin: string | undefined, allowed: string[]): boolean {
  return !origin || allowed.includes(origin);
}

function securityHeaders(response: ServerResponse): void {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Referrer-Policy', 'no-referrer');
  // Ionic applies a small amount of runtime styling for overlays and controls.
  // Keep scripts, connections and all other resource classes restricted while
  // allowing that required style path; no inline script is enabled here.
  response.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' http://127.0.0.1:* http://localhost:*; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
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

const recommendedWdaBundleId = 'co.hotwax.iosTesting.WDARunner';

function validRunRequest(value: unknown): value is RunRequest {
  if (!value || typeof value !== 'object') return false;
  const request = value as Partial<RunRequest>;
  return typeof request.scriptId === 'string' && typeof request.deviceProfileId === 'string' &&
    typeof request.assertionMode === 'string' && typeof request.expectedRevision === 'string' &&
    !!request.parameters && typeof request.parameters === 'object' &&
    (request.context === undefined || isValidTargetContext(request.context));
}

function boundedText(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length <= max;
}

interface RunArtifact { name: string; kind: 'screenshot' | 'file'; size: number; modifiedAt: string }

// Matches exactly what the run pipeline itself writes into an artifacts
// directory: no path separators, no leading dot-segments. This is checked
// again below with a resolved-path containment check before any file read,
// since a name arriving on the wire is untrusted even after this test passes.
const safeArtifactName = /^[A-Za-z0-9._-]+$/;

function validArtifactName(name: string): boolean {
  return safeArtifactName.test(name) && name !== '.' && name !== '..';
}

function sendPng(response: ServerResponse, buffer: Buffer): void {
  response.statusCode = 200;
  response.setHeader('Content-Type', 'image/png');
  response.setHeader('Cache-Control', 'no-store');
  response.end(buffer);
}

function validConnectionId(value: unknown): value is string { return boundedText(value, 80) && /^[a-zA-Z0-9_-]+$/.test(value); }

function validConnectionDraft(value: unknown): value is { instanceName: string } {
  if (!value || typeof value !== 'object') return false;
  const body = value as Record<string, unknown>;
  return Object.keys(body).every(key => key === 'instanceName') && boundedText(body.instanceName, 64) && !!body.instanceName.trim();
}

function validShopRead(value: unknown): value is { connectionId: string; shopId: string; search?: string; cursor?: string; locationGid?: string } {
  if (!value || typeof value !== 'object') return false;
  const body = value as Record<string, unknown>;
  return validConnectionId(body.connectionId) && boundedText(body.shopId, 160) &&
    (body.search === undefined || boundedText(body.search, 200)) && (body.cursor === undefined || boundedText(body.cursor, 512)) &&
    (body.locationGid === undefined || (typeof body.locationGid === 'string' && /^gid:\/\/shopify\/Location\/[A-Za-z0-9_-]{1,64}$/.test(body.locationGid)));
}

function validOrderRead(value: unknown): value is { connectionId: string; search?: string; cursor?: string } {
  if (!value || typeof value !== 'object') return false;
  const body = value as Record<string, unknown>;
  return validConnectionId(body.connectionId) &&
    (body.search === undefined || boundedText(body.search, 200)) &&
    (body.cursor === undefined || boundedText(body.cursor, 512));
}

function validOrderDetail(value: unknown): value is { connectionId: string; orderId: string } {
  if (!value || typeof value !== 'object') return false;
  const body = value as Record<string, unknown>;
  return validConnectionId(body.connectionId) && boundedText(body.orderId, 120) && /^[A-Za-z0-9_.-]+$/.test(body.orderId);
}

function validShopifyOrderDetail(value: unknown): value is { connectionId: string; shopId: string; gid: string; cursor?: string } {
  if (!value || typeof value !== 'object') return false;
  const body = value as Record<string, unknown>;
  return validConnectionId(body.connectionId) && boundedText(body.shopId, 160) &&
    boundedText(body.gid, 200) && /^gid:\/\/shopify\/Order\/[A-Za-z0-9_-]+$/.test(body.gid) &&
    (body.cursor === undefined || boundedText(body.cursor, 512));
}

function sendOmsError(response: ServerResponse, error: unknown): void {
  if (error instanceof OmsError) {
    const status = error.code === 'authentication' ? 401 : error.code === 'authorization' ? 403 : error.code === 'rate-limited' ? 429 : error.code === 'configuration' ? 503 : error.code === 'invalid-data' ? 400 : 502;
    sendJson(response, status, { ok: false, error: error.message, code: error.code });
    return;
  }
  sendJson(response, 502, { ok: false, error: 'The OMS request failed.' });
}

export async function createApiServer(options: ApiServerOptions): Promise<ServerHandle> {
  const session = createLocalSession();
  let revision = 'unversioned';
  try { revision = execFileSync('git', ['-C', options.root, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { /* source may not be a Git checkout */ }
  const server = createServer(async (request, response) => {
    securityHeaders(response);
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : options.port;
    const configuredProxyHosts = (options.allowedOrigins ?? []).flatMap(origin => {
      try {
        const parsed = new URL(origin);
        return parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost' ? [parsed.host] : [];
      } catch { return []; }
    });
    if (!loopbackHost(request.headers.host, port, configuredProxyHosts)) {
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
      if (request.method === 'GET' && url.pathname === '/api/setup/host') {
        try { sendJson(response, 200, { checks: await runHostChecks() }); }
        catch (error) { sendJson(response, 500, { ok: false, error: error instanceof Error ? error.message : 'Could not run host checks.' }); }
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/setup/tunnel') {
        sendJson(response, 200, { ok: true, running: await probeRemoteXpcTunnel() });
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/setup/defaults') {
        let developmentTeamIds: string[] = [];
        try { developmentTeamIds = await listDevelopmentTeamIds(); } catch { /* the UI explains how to create a development identity */ }
        const defaults: SetupDefaults = { developmentTeamIds, recommendedWdaBundleId };
        sendJson(response, 200, defaults);
        return;
      }
      if (url.pathname.startsWith('/api/oms/')) {
        if (!options.oms) { sendJson(response, 503, { ok: false, error: 'The local OMS sidecar is unavailable.' }); return; }
        try {
          if (request.method === 'GET' && url.pathname === '/api/oms/connections') {
            sendJson(response, 200, { connections: options.oms.connections() });
            return;
          }
          if (request.method === 'POST' && url.pathname === '/api/oms/connections') {
            const body = await readBody(request);
            if (!validConnectionDraft(body) || !options.oms.addConnection) {
              sendJson(response, 400, { ok: false, error: 'A valid HotWax instance name is required.' });
              return;
            }
            try { sendJson(response, 201, { connection: options.oms.addConnection({ instanceName: body.instanceName.trim() }) }); }
            catch (error) { sendOmsError(response, error); }
            return;
          }
          if (request.method === 'GET' && url.pathname === '/api/oms/health') {
            const connectionId = url.searchParams.get('connectionId');
            if (!validConnectionId(connectionId) || !options.oms.health) { sendJson(response, 400, { ok: false, error: 'A valid OMS connection is required.' }); return; }
            sendJson(response, 200, { connection: await options.oms.health(connectionId) });
            return;
          }
          if (request.method === 'POST' && url.pathname === '/api/oms/login') {
            const body = await readBody(request) as Record<string, unknown>;
            if (!validConnectionId(body.connectionId) || !boundedText(body.username, 256) || !body.username.trim() || !boundedText(body.password, 256) || !body.password) {
              sendJson(response, 400, { ok: false, error: 'A connection ID, username and password are required.' });
              return;
            }
            sendJson(response, 200, { connection: await options.oms.login(body.connectionId, { username: body.username, password: body.password }) });
            return;
          }
          // Saved connections. The password is encrypted at rest with a key held
          // in the macOS Keychain and is never returned to the browser.
          if (request.method === 'GET' && url.pathname === '/api/oms/saved') {
            try { sendJson(response, 200, { saved: await listSavedOmsConnections(options.root) }); }
            catch (error) { sendJson(response, 503, { ok: false, error: error instanceof Error ? error.message : 'Saved connections are unavailable.' }); }
            return;
          }
          if (request.method === 'POST' && url.pathname === '/api/oms/saved') {
            const body = await readBody(request) as Record<string, unknown>;
            if (!boundedText(body.instanceName, 80) || !boundedText(body.username, 256) || !body.username.trim() || !boundedText(body.password, 256) || !body.password) {
              sendJson(response, 400, { ok: false, error: 'An instance name, username and password are required.' });
              return;
            }
            try {
              sendJson(response, 201, { saved: await saveOmsCredential(options.root, {
                instanceName: body.instanceName,
                username: body.username,
                password: body.password,
                autoConnect: body.autoConnect !== false,
              }) });
            } catch (error) { sendJson(response, 400, { ok: false, error: error instanceof Error ? error.message : 'The connection could not be saved.' }); }
            return;
          }
          if (request.method === 'POST' && url.pathname === '/api/oms/saved/forget') {
            const body = await readBody(request) as Record<string, unknown>;
            if (!boundedText(body.id, 300) || !body.id) { sendJson(response, 400, { ok: false, error: 'A saved connection ID is required.' }); return; }
            sendJson(response, 200, { removed: await forgetOmsCredential(options.root, body.id) });
            return;
          }
          // Signs in using a stored password. The secret is decrypted here and
          // sent only to the OMS; it never crosses back to the browser.
          if (request.method === 'POST' && url.pathname === '/api/oms/saved/connect') {
            const body = await readBody(request) as Record<string, unknown>;
            if (!boundedText(body.id, 300) || !body.id) { sendJson(response, 400, { ok: false, error: 'A saved connection ID is required.' }); return; }
            let credential: Awaited<ReturnType<typeof readOmsCredential>>;
            try { credential = await readOmsCredential(options.root, String(body.id)); }
            catch { sendJson(response, 409, { ok: false, error: 'The saved password could not be decrypted. Save the connection again.' }); return; }
            if (!credential) { sendJson(response, 404, { ok: false, error: 'That saved connection no longer exists.' }); return; }
            if (!options.oms.addConnection) { sendJson(response, 400, { ok: false, error: 'This server cannot add OMS connections.' }); return; }
            try {
              const connection = options.oms.addConnection({ instanceName: credential.instanceName });
              sendJson(response, 200, { connection: await options.oms.login(connection.id, { username: credential.username, password: credential.password }) });
            } catch (error) { sendOmsError(response, error); }
            return;
          }
          if (request.method === 'POST' && url.pathname === '/api/oms/logout') {
            const body = await readBody(request) as Record<string, unknown>;
            if (!validConnectionId(body.connectionId)) { sendJson(response, 400, { ok: false, error: 'A valid connection ID is required.' }); return; }
            await options.oms.logout(body.connectionId);
            sendJson(response, 200, { ok: true });
            return;
          }
          if (request.method === 'GET' && url.pathname === '/api/oms/shops') {
            const connectionId = url.searchParams.get('connectionId');
            if (!validConnectionId(connectionId)) { sendJson(response, 400, { ok: false, error: 'A valid connection ID is required.' }); return; }
            sendJson(response, 200, { shops: await options.oms.shops(connectionId) });
            return;
          }
          if (request.method === 'POST' && url.pathname === '/api/oms/variants/search') {
            const body = await readBody(request);
            if (!validShopRead(body)) { sendJson(response, 400, { ok: false, error: 'A valid connection, shop and bounded search are required.' }); return; }
            sendJson(response, 200, await options.oms.searchVariants(body.connectionId, body.shopId, { search: body.search ?? '', cursor: body.cursor, locationGid: body.locationGid }));
            return;
          }
          if (request.method === 'POST' && url.pathname === '/api/oms/orders/pos-recent') {
            const body = await readBody(request);
            if (!validShopRead(body)) { sendJson(response, 400, { ok: false, error: 'A valid connection and shop are required.' }); return; }
            sendJson(response, 200, await options.oms.listPosOrders(body.connectionId, body.shopId, { cursor: body.cursor }));
            return;
          }
          if (request.method === 'POST' && url.pathname === '/api/oms/customers/search') {
            const body = await readBody(request);
            if (!validShopRead(body)) { sendJson(response, 400, { ok: false, error: 'A valid connection, shop and bounded search are required.' }); return; }
            sendJson(response, 200, await options.oms.searchCustomers(body.connectionId, body.shopId, { search: body.search ?? '', cursor: body.cursor }));
            return;
          }
          if (request.method === 'POST' && url.pathname === '/api/oms/orders/search') {
            const body = await readBody(request);
            if (!validShopRead(body)) { sendJson(response, 400, { ok: false, error: 'A valid connection, shop and bounded search are required.' }); return; }
            sendJson(response, 200, await options.oms.searchOrders(body.connectionId, body.shopId, { search: body.search ?? '', cursor: body.cursor }));
            return;
          }
          if (request.method === 'POST' && url.pathname === '/api/oms/orders/shopify-detail') {
            const body = await readBody(request);
            if (!validShopifyOrderDetail(body)) { sendJson(response, 400, { ok: false, error: 'A valid connection, shop and exact Shopify order GID are required.' }); return; }
            sendJson(response, 200, { order: await options.oms.resolveOrder(body.connectionId, body.shopId, { gid: body.gid, cursor: body.cursor }) });
            return;
          }
          if (request.method === 'POST' && url.pathname === '/api/oms/orders/records') {
            const body = await readBody(request);
            if (!validOrderRead(body)) { sendJson(response, 400, { ok: false, error: 'A valid connection and bounded OMS order search are required.' }); return; }
            sendJson(response, 200, await options.oms.searchOrderRecords(body.connectionId, { search: body.search ?? '', cursor: body.cursor }));
            return;
          }
          if (request.method === 'POST' && url.pathname === '/api/oms/orders/detail') {
            const body = await readBody(request);
            if (!validOrderDetail(body)) { sendJson(response, 400, { ok: false, error: 'A valid connection and OMS order ID are required.' }); return; }
            sendJson(response, 200, { order: await options.oms.getOrderDetail(body.connectionId, body.orderId) });
            return;
          }
          if (request.method === 'POST' && url.pathname === '/api/oms/locations/list') {
            const body = await readBody(request);
            if (!validShopRead(body)) { sendJson(response, 400, { ok: false, error: 'A valid connection, shop and bounded search are required.' }); return; }
            sendJson(response, 200, await options.oms.listLocations(body.connectionId, body.shopId, { cursor: body.cursor }));
            return;
          }
        } catch (error) { sendOmsError(response, error); return; }
        sendJson(response, 404, { ok: false, error: 'Unknown OMS route.' });
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
      // Two shapes are matched: the original single-action routes (no further
      // segments allowed after the action), and `/artifacts` with an optional
      // `/<name>` segment. Keeping these as separate alternatives, rather than
      // one shared optional trailing segment, means `/events/whatever` still
      // fails to match at all instead of silently reusing the `events` route.
      const runMatch = url.pathname.match(/^\/api\/runs\/([a-zA-Z0-9_-]+)(?:\/(events|stop|progress|logs)|\/(artifacts)(?:\/([^/]+))?)?$/);
      if (runMatch) {
        const runId = runMatch[1];
        const action = runMatch[2] ?? runMatch[3];
        const artifactName = runMatch[4];
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
        if (action === 'progress' && request.method === 'GET') {
          const file = join(resolve(options.root), '.runtime', 'runs', runId, 'artifacts', 'progress.ndjson');
          let entries: unknown[] = [];
          try {
            entries = (await readFile(file, 'utf8')).split('\n').filter(Boolean).slice(-200).map(line => {
              try { return JSON.parse(line) as unknown; } catch { return null; }
            }).filter(Boolean);
          } catch { /* a run that has not reported yet simply has no progress */ }
          sendJson(response, 200, { entries });
          return;
        }
        if (action === 'logs' && request.method === 'GET') {
          const from = Math.max(0, Number(url.searchParams.get('from') ?? '0') || 0);
          const rawTo = Number(url.searchParams.get('to') ?? '0') || 0;
          // A window is capped so one expanded step can never stream the whole
          // multi-megabyte driver log into the browser.
          const to = rawTo > from ? Math.min(rawTo, from + 400_000) : from + 400_000;
          const file = join(resolve(options.root), '.runtime', 'runs', runId, 'artifacts', 'wdio-appium.log');
          let lines: string[] = [];
          let truncated = false;
          try {
            const handle = await open(file, 'r');
            try {
              const length = Math.max(0, to - from);
              const buffer = Buffer.alloc(length);
              const { bytesRead } = await handle.read(buffer, 0, length, from);
              const text = buffer.subarray(0, bytesRead).toString('utf8');
              // Drop the ANSI colouring Appium writes for a terminal.
              lines = text.split('\n').map(line => line.replace(/\u001b\[[0-9;]*m/g, '')).filter(line => line.trim());
              truncated = rawTo > from && rawTo - from > 400_000;
              if (lines.length > 500) { lines = lines.slice(-500); truncated = true; }
            } finally { await handle.close(); }
          } catch { /* a run with no driver log simply has no detail */ }
          sendJson(response, 200, { lines, truncated });
          return;
        }
        if (action === 'artifacts' && !artifactName && request.method === 'GET') {
          const dir = join(resolve(options.root), '.runtime', 'runs', runId, 'artifacts');
          const artifacts: RunArtifact[] = [];
          try {
            const names = await readdir(dir);
            for (const name of names) {
              if (!validArtifactName(name)) continue;
              try {
                const info = await lstat(join(dir, name));
                if (!info.isFile()) continue;
                artifacts.push({
                  name,
                  kind: name.toLowerCase().endsWith('.png') ? 'screenshot' : 'file',
                  size: info.size,
                  modifiedAt: info.mtime.toISOString(),
                });
              } catch { /* a file that vanished between readdir and stat is simply skipped */ }
            }
          } catch { /* a run with no artifacts directory yet simply has none */ }
          sendJson(response, 200, { artifacts });
          return;
        }
        if (action === 'artifacts' && artifactName && request.method === 'GET') {
          const dir = join(resolve(options.root), '.runtime', 'runs', runId, 'artifacts');
          const notFound = () => sendJson(response, 404, { ok: false, error: 'Artifact was not found.' });
          if (!validArtifactName(artifactName) || !artifactName.toLowerCase().endsWith('.png')) { notFound(); return; }
          const filePath = resolve(dir, artifactName);
          // Belt and braces on top of the name check above: the resolved file
          // must still land inside this run's own artifacts directory.
          if (filePath !== dir && !filePath.startsWith(`${dir}${sep}`)) { notFound(); return; }
          try {
            const info = await lstat(filePath);
            if (!info.isFile()) { notFound(); return; }
            sendPng(response, await readFile(filePath));
          } catch { notFound(); }
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
          if (!validRunRequest(body)) {
            if (body && typeof body === 'object' && 'context' in body && !isValidTargetContext((body as Record<string, unknown>).context)) {
              sendJson(response, 400, { ok: false, error: 'The frozen target context is invalid. Select an HTTPS OMS origin, exact shop and location GIDs, and API version.' });
            } else sendJson(response, 400, { ok: false, error: 'A valid named script run request is required.' });
            return;
          }
          if (body.expectedRevision.length > 100 || body.scriptId.length > 100 || body.deviceProfileId.length > 100) { sendJson(response, 400, { ok: false, error: 'Run request is too large.' }); return; }
          const catalog = await loadCatalog(options.root);
          try {
            validateRunRequestAgainstCatalog(body, catalog.scripts, registry);
          } catch (error) {
            sendJson(response, 400, { ok: false, error: error instanceof Error ? error.message : 'The run request does not match the selected catalog script.' });
            return;
          }
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
