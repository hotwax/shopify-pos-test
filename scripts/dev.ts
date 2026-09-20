import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createApiServer } from '../server/app.ts';
import { createLaunchLock } from '../server/session.ts';
import { createCoordinator } from '../core/runner/coordinator.ts';
import { createWdioWorkerFactory } from '../core/runner/worker.ts';

const root = resolve(import.meta.dirname, '..');

async function waitFor(url: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  let lastError = 'unknown error';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError}`);
}

const lock = await createLaunchLock('dev', root);
if (!lock.acquired) {
  console.error(`A local host is already running (pid ${lock.owner?.pid ?? 'unknown'}).`);
  process.exitCode = 1;
} else {
  const coordinator = createCoordinator({ root, workerFactory: createWdioWorkerFactory(root) });
  const api = await createApiServer({ port: 8128, mode: 'dev', root, allowedOrigins: ['http://127.0.0.1:8127', 'http://localhost:8127'], coordinator });
  const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '8127'], { cwd: root, stdio: 'inherit' });
  const shutdown = async (code = 0) => {
    if (!vite.killed) vite.kill('SIGTERM');
    await api.close().catch(() => undefined);
    await lock.release();
    process.exit(code);
  };
  vite.once('exit', code => { void shutdown(code ?? 1); });
  process.once('SIGINT', () => { void shutdown(0); });
  process.once('SIGTERM', () => { void shutdown(0); });
  await waitFor(`${api.url}/api/health`);
  await waitFor('http://127.0.0.1:8127/');
  const browser = spawn('open', ['http://127.0.0.1:8127'], { stdio: 'ignore', detached: true });
  browser.unref();
  console.log(`API sidecar is running at ${api.url}; Vite is serving http://127.0.0.1:8127`);
}
