import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { loadCatalog } from '../core/catalog/load.ts';
import { createLocalSession, sessionMatches, type LaunchMode } from './session.ts';
import { sendJson, sendText } from './routes.ts';
import { serveStatic } from './static.ts';

export interface ApiServerOptions {
  port: number;
  mode: LaunchMode;
  root: string;
  staticDir?: string;
  allowedOrigins?: string[];
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

export async function createApiServer(options: ApiServerOptions): Promise<ServerHandle> {
  const session = createLocalSession();
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
      sendJson(response, 200, { ok: true, mode: options.mode, sessionToken: session.token });
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
      if (request.method === 'GET' && url.pathname === '/api/catalog') {
        const catalog = await loadCatalog(options.root);
        sendJson(response, 200, catalog);
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
