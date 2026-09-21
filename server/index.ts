import 'dotenv/config';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createApiServer } from './app.ts';
import { createLaunchLock } from './session.ts';
import { createCoordinator } from '../core/runner/coordinator.ts';
import { createWdioWorkerFactory } from '../core/runner/worker.ts';
import { createAppiumServerHost } from '../core/runner/appium-server.ts';
import { OmsClient } from '../core/oms/client.ts';
import { resolveObservedOrder, resolveRecentPosOrder, resolveShopifyOrder } from '../core/oms/correlation.ts';
import { configuredOmsConnections } from '../core/oms/config.ts';
import { autoConnectSavedOmsConnections } from '../core/storage/credentials.ts';

const root = resolve(import.meta.dirname, '..');
const open = process.argv.includes('--open');
const lock = await createLaunchLock('serve', root);
if (!lock.acquired) {
  console.error(`A local host is already running (pid ${lock.owner?.pid ?? 'unknown'}).`);
  process.exitCode = 1;
} else {
  const oms = new OmsClient(configuredOmsConnections().connections);
  // One Appium server for the host's lifetime, started on the first run, so
  // later runs reuse the WebDriverAgent already on the iPad.
  const appiumServer = createAppiumServerHost(root);
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
  const server = await createApiServer({ port: 8127, mode: 'serve', root, staticDir: resolve(root, 'dist'), coordinator, oms });
  console.log(`HotWax POS Testing is running at ${server.url}`);
  // Saved connections sign in here so a normal start needs no login. Failures
  // are reported and left for a manual login; they never block startup.
  const autoConnected = await autoConnectSavedOmsConnections(root, oms);
  if (autoConnected.connected.length) console.log(`Signed in to ${autoConnected.connected.length} saved OMS connection(s).`);
  for (const failure of autoConnected.failed) console.warn(`Saved OMS connection ${failure.id} did not sign in: ${failure.reason}`);
  if (open) {
    const child = spawn('open', [server.url], { stdio: 'ignore', detached: true });
    child.unref();
  }
  const shutdown = async () => { await appiumServer.stop().catch(() => undefined); await server.close().catch(() => undefined); await lock.release(); process.exit(0); };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}
