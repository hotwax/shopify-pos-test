import { mkdir, rename, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { findAvailablePort, spawn, type OwnedProcess } from './process.ts';

/**
 * One Appium server for the life of the local host, instead of one per run.
 *
 * The saving is not the 2.5 s server boot. With `useNewWDA: false` the
 * XCUITest driver keeps xcodebuild (and so WebDriverAgent on the iPad) alive
 * after a session ends, and the next session probes it and reuses it when the
 * bundle id and version match. That only works while the server process that
 * spawned xcodebuild is still alive, which a per-run server never is. Measured
 * WDA launch on the iPad: about 9.5 s per run.
 *
 * The server still binds to 127.0.0.1 only. Its log is one file per host
 * lifetime; each run copies its own byte range into the run's artifact log so
 * failure classification and step logs keep working unchanged.
 */
export interface AppiumServerHost {
  ensureStarted(): Promise<{ port: number; logPath: string }>;
  logSize(): Promise<number>;
  isRunning(): boolean;
  stop(): Promise<void>;
}

export function createAppiumServerHost(root: string, options: { preferredPort?: number; startupTimeoutMs?: number } = {}): AppiumServerHost {
  const directory = join(resolve(root), '.runtime', 'appium');
  const logPath = join(directory, 'server.log');
  let owned: OwnedProcess | undefined;
  let port = 0;
  let starting: Promise<{ port: number; logPath: string }> | undefined;

  async function statusOk(candidatePort: number): Promise<boolean> {
    try {
      const response = await fetch(`http://127.0.0.1:${candidatePort}/status`, { signal: AbortSignal.timeout(2_000) });
      return response.ok;
    } catch { return false; }
  }

  async function start(): Promise<{ port: number; logPath: string }> {
    await mkdir(directory, { recursive: true });
    // Keep exactly one previous log so a crash of the last host stays readable.
    await rename(logPath, join(directory, 'server.previous.log')).catch(() => undefined);
    port = await findAvailablePort(options.preferredPort ?? 4723);
    owned = spawn(process.execPath, [
      resolve(root, 'node_modules/appium/build/lib/main.js'), 'server',
      '--address', '127.0.0.1', '--port', String(port),
      '--log', logPath, '--log-level', 'info', '--log-timestamp', '--log-no-colors',
    ], { cwd: resolve(root), env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' } });
    const deadline = Date.now() + (options.startupTimeoutMs ?? 30_000);
    while (Date.now() < deadline) {
      if (!owned.isAlive()) throw new Error('The shared Appium server exited during startup; see .runtime/appium/server.log.');
      if (await statusOk(port)) return { port, logPath };
      await new Promise(resolvePause => setTimeout(resolvePause, 250));
    }
    await owned.terminate().catch(() => undefined);
    owned = undefined;
    throw new Error('The shared Appium server did not answer its status check in time.');
  }

  return {
    async ensureStarted() {
      if (owned?.isAlive() && await statusOk(port)) return { port, logPath };
      if (owned && !owned.isAlive()) owned = undefined;
      starting ??= start().finally(() => { starting = undefined; });
      return starting;
    },
    async logSize() {
      try { return (await stat(logPath)).size; } catch { return 0; }
    },
    isRunning() { return Boolean(owned?.isAlive()); },
    async stop() {
      const current = owned;
      owned = undefined;
      if (current) await current.terminate();
    },
  };
}
