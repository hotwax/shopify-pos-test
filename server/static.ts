import { createReadStream } from 'node:fs';
import { access, realpath, stat } from 'node:fs/promises';
import { extname, join, relative, resolve, sep } from 'node:path';
import type { ServerResponse } from 'node:http';

const contentTypes: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function inside(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${sep}`);
}

export async function serveStatic(root: string, pathname: string, response: ServerResponse): Promise<boolean> {
  const publicRoot = await realpath(root);
  const requested = resolve(publicRoot, pathname.replace(/^\//, ''));
  if (!inside(publicRoot, requested)) return false;
  let file = requested;
  try {
    const info = await stat(file);
    if (info.isDirectory()) file = join(file, 'index.html');
  } catch { /* SPA fallback below */ }
  try {
    await access(file);
  } catch {
    file = join(publicRoot, 'index.html');
    try { await access(file); } catch { return false; }
  }
  const resolved = await realpath(file);
  if (!inside(publicRoot, resolved)) return false;
  response.statusCode = 200;
  response.setHeader('Content-Type', contentTypes[extname(resolved)] ?? 'application/octet-stream');
  response.setHeader('Cache-Control', 'no-store');
  createReadStream(resolved).pipe(response);
  return true;
}
