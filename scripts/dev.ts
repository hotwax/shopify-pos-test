import 'dotenv/config';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createApiServer } from '../server/app.ts';
import { createLaunchLock } from '../server/session.ts';
import { createCoordinator } from '../core/runner/coordinator.ts';
import { createWdioWorkerFactory } from '../core/runner/worker.ts';
import { createAppiumServerHost } from '../core/runner/appium-server.ts';
import { OmsClient } from '../core/oms/client.ts';
import { resolveObservedOrder, resolveRecentPosOrder, resolveShopifyOrder } from '../core/oms/correlation.ts';
import { configuredOmsConnections } from '../core/oms/config.ts';
import { autoConnectSavedOmsConnections } from '../core/storage/credentials.ts';

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
  const oms = new OmsClient(configuredOmsConnections().connections);
  // One Appium server for the host's lifetime, started on the first run, so
  // later runs reuse the WebDriverAgent already on the iPad.
  const appiumServer = createAppiumServerHost(root);
  // Same OMS bridge as server/index.ts: a mutation spec correlates the order it
  // created and reads it back through the coordinator, never with its own
  // credentials. Without these handlers a dev-mode run cannot confirm its
  // business effect and ends in needs-reconciliation.
  const coordinator = createCoordinator({
    root,
    workerFactory: createWdioWorkerFactory(root, { appiumServer }),
    resolveObservedOrder: async ({ request, observedName, runMarker }) => {
      if (!request.context) throw new Error('The run has no frozen OMS target context.');
      return resolveObservedOrder(oms, request.context, { observedName, runMarker });
    },
    resolveRecentOrder: async ({ request, notBefore, total, lineCount }) => {
      if (!request.context) throw new Error('The run has no frozen OMS target context.');
      return resolveRecentPosOrder(oms, request.context, { notBefore, total, lineCount });
    },
    readShopifyOrder: async ({ request, orderGid }) => {
      if (!request.context) throw new Error('The run has no frozen OMS target context.');
      return resolveShopifyOrder(oms, request.context, { orderGid });
    },
  });
  const api = await createApiServer({ port: 8128, mode: 'dev', root, allowedOrigins: ['http://127.0.0.1:8127', 'http://localhost:8127'], coordinator, oms });
  const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '8127'], { cwd: root, stdio: 'inherit' });
  const shutdown = async (code = 0) => {
    if (!vite.killed) vite.kill('SIGTERM');
    await appiumServer.stop().catch(() => undefined);
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
  // Saved connections sign in here so a normal start needs no login. Failures
  // are reported and left for a manual login; they never block startup.
  const autoConnected = await autoConnectSavedOmsConnections(root, oms);
  if (autoConnected.connected.length) console.log(`Signed in to ${autoConnected.connected.length} saved OMS connection(s).`);
  for (const failure of autoConnected.failed) console.warn(`Saved OMS connection ${failure.id} did not sign in: ${failure.reason}`);
}
