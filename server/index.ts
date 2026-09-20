import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createApiServer } from './app.ts';
import { createLaunchLock } from './session.ts';
import { createCoordinator } from '../core/runner/coordinator.ts';
import { createWdioWorkerFactory } from '../core/runner/worker.ts';
import { OmsClient } from '../core/oms/client.ts';
import { configuredOmsConnections } from '../core/oms/config.ts';

const root = resolve(import.meta.dirname, '..');
const open = process.argv.includes('--open');
const lock = await createLaunchLock('serve', root);
if (!lock.acquired) {
  console.error(`A local host is already running (pid ${lock.owner?.pid ?? 'unknown'}).`);
  process.exitCode = 1;
} else {
  const coordinator = createCoordinator({ root, workerFactory: createWdioWorkerFactory(root) });
  const oms = new OmsClient(configuredOmsConnections().connections);
  const server = await createApiServer({ port: 8127, mode: 'serve', root, staticDir: resolve(root, 'dist'), coordinator, oms });
  console.log(`HotWax POS Testing is running at ${server.url}`);
  if (open) {
    const child = spawn('open', [server.url], { stdio: 'ignore', detached: true });
    child.unref();
  }
  const shutdown = async () => { await server.close().catch(() => undefined); await lock.release(); process.exit(0); };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}
