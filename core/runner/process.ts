import { spawn as spawnProcess, type ChildProcess } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer as createNetServer } from 'node:net';
import { isAbsolute, join } from 'node:path';
import { browser } from '@wdio/globals';
import type { DeviceProfile } from '../../shared/contracts.ts';
import { buildCapabilities } from '../../config/device.ts';

export interface OwnedProcess {
  pid: number;
  child: ChildProcess;
  isAlive(): boolean;
  terminate(timeoutMs?: number): Promise<void>;
}

export async function findAvailablePort(preferred: number): Promise<number> {
  if (!Number.isInteger(preferred) || preferred < 0 || preferred > 65_535) throw new Error('Invalid preferred local port.');
  return new Promise<number>((resolve, reject) => {
    const server = createNetServer();
    const onError = (error: NodeJS.ErrnoException) => {
      server.close();
      if (error.code === 'EADDRINUSE' && preferred !== 0) {
        void findAvailablePort(0).then(resolve, reject);
      } else reject(error);
    };
    server.once('error', onError);
    server.listen(preferred, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

function assertSafeExecutable(executable: string): void {
  if (!executable || /[;&|<>`$\n\r]/.test(executable)) throw new Error('Invalid executable; use a fixed executable path.');
}

function assertSafeEnvironment(env: Record<string, string>): void {
  for (const [key, value] of Object.entries(env)) {
    if (!/^[A-Z_][A-Z0-9_]*$/i.test(key) || /password|token|secret|api[_-]?key/i.test(key) || /[\0\r\n]/.test(value)) {
      throw new Error('Unsafe environment; credentials and arbitrary process environment are not allowed.');
    }
  }
}

function killGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    if (process.platform === 'win32') process.kill(pid, signal);
    else process.kill(-pid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
  }
}

export function spawn(executable: string, args: string[], options: { cwd: string; env: Record<string, string> }): OwnedProcess {
  assertSafeExecutable(executable);
  if (!isAbsolute(options.cwd)) throw new Error('Worker cwd must be absolute.');
  if (!Array.isArray(args) || args.some(arg => typeof arg !== 'string' || /\0/.test(arg))) throw new Error('Worker arguments must be a safe string array.');
  assertSafeEnvironment(options.env);
  const child = spawnProcess(executable, args, {
    cwd: options.cwd,
    env: { ...options.env },
    shell: false,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (!child.pid) throw new Error('Worker did not provide a process ID.');
  const pid = child.pid;
  let outputSize = 0;
  for (const stream of [child.stdout, child.stderr]) {
    stream?.on('data', chunk => { outputSize = Math.min(outputSize + Buffer.byteLength(String(chunk)), 32_768); });
  }
  return {
    pid,
    child,
    isAlive: () => child.exitCode === null && child.signalCode === null,
    async terminate(timeoutMs = 5_000) {
      if (!this.isAlive()) return;
      killGroup(pid, 'SIGTERM');
      const deadline = Date.now() + timeoutMs;
      while (this.isAlive() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
      if (this.isAlive()) killGroup(pid, 'SIGKILL');
      outputSize = Math.min(outputSize, 32_768);
    },
  };
}

export function makeWorkerEnvironment(device: DeviceProfile, runId: string, artifactDir: string, port: number, wdaLocalPort: number, wdaDerivedDataPath: string): Record<string, string> {
  if (!isAbsolute(artifactDir)) throw new Error('Artifact directory must be absolute.');
  if (!isAbsolute(wdaDerivedDataPath)) throw new Error('WDA DerivedData path must be absolute.');
  return {
    PATH: process.env.PATH ?? '',
    HOME: process.env.HOME ?? '',
    IOS_UDID: device.udid,
    APPLE_TEAM_ID: device.teamId,
    WDA_BUNDLE_ID: device.wdaBundleId,
    WDIO_RUN_ID: runId,
    RUN_ARTIFACT_DIR: artifactDir,
    APPIUM_PORT: String(port),
    WDA_LOCAL_PORT: String(wdaLocalPort),
    WDA_DERIVED_DATA_PATH: wdaDerivedDataPath,
  };
}

export function makeWdioConfig(input: { runId: string; device: DeviceProfile; entry: string; artifactDir: string; port: number; wdaLocalPort: number; wdaDerivedDataPath: string }): WebdriverIO.Config {
  const capabilities = buildCapabilities({
    udid: input.device.udid,
    teamId: input.device.teamId,
    wdaBundleId: input.device.wdaBundleId,
  });
  return {
    runner: 'local',
    hostname: '127.0.0.1',
    port: input.port,
    path: '/',
    specs: [input.entry],
    maxInstances: 1,
    capabilities: [{ ...capabilities, 'appium:derivedDataPath': input.wdaDerivedDataPath, 'appium:wdaLocalPort': input.wdaLocalPort }],
    framework: 'mocha',
    mochaOpts: { timeout: 120_000 },
    waitforTimeout: 20_000,
    connectionRetryTimeout: 240_000,
    connectionRetryCount: 0,
    specFileRetries: 0,
    logLevel: 'silent',
    reporters: ['spec'],
    afterTest: async function (_test, _context, { passed, error }) {
      await mkdir(input.artifactDir, { recursive: true });
      if (!passed) {
        try { await browser.saveScreenshot(join(input.artifactDir, `failure-${Date.now()}.png`)); } catch { /* evidence is best effort */ }
        try { await writeFile(join(input.artifactDir, `failure-${Date.now()}.xml`), await browser.getPageSource()); } catch { /* evidence is best effort */ }
      }
      await writeFile(join(input.artifactDir, 'result.json'), JSON.stringify({ passed, message: error?.message?.slice(0, 500) ?? null }));
    },
    services: [['appium', { args: { address: '127.0.0.1', port: input.port, logLevel: 'info' }, logPath: input.artifactDir }]],
  };
}
