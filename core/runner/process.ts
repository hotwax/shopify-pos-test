import { execFileSync, spawn as spawnProcess, type ChildProcess } from 'node:child_process';
import { mkdir, open as openFile, writeFile } from 'node:fs/promises';
import { createServer as createNetServer } from 'node:net';
import { isAbsolute, join } from 'node:path';
import { browser } from '@wdio/globals';
import type { DeviceProfile } from '../../shared/contracts.ts';
import { buildCapabilities } from '../../config/device.ts';
import { appiumLogFiltersFile } from './log-filters.ts';

export interface OwnedProcess {
  pid: number;
  child: ChildProcess;
  isAlive(): boolean;
  terminate(timeoutMs?: number): Promise<void>;
  /**
   * Runs once after the process has exited and before the coordinator reads
   * the run's artifacts. A worker that shares the host's Appium server uses it
   * to copy its own byte range of the shared log into the run's artifact log.
   */
  collectArtifacts?(): Promise<void>;
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

function matchingProcessIds(markers: string[]): number[] {
  if (process.platform === 'win32' || !markers.length) return [];
  try {
    const output = execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 });
    return output.split('\n').flatMap(line => {
      const match = /^\s*(\d+)\s+(.*)$/.exec(line);
      if (!match || !markers.every(marker => match[2].includes(marker))) return [];
      const pid = Number(match[1]);
      return Number.isSafeInteger(pid) && pid > 1 && pid !== process.pid ? [pid] : [];
    });
  } catch { return []; }
}

function signalMatchingProcesses(markers: string[], signal: NodeJS.Signals): void {
  for (const pid of matchingProcessIds(markers)) {
    try { process.kill(pid, signal); }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ESRCH' && code !== 'EPERM') throw error;
    }
  }
}

export function spawn(executable: string, args: string[], options: { cwd: string; env: Record<string, string>; cleanupMarkers?: string[] }): OwnedProcess {
  assertSafeExecutable(executable);
  if (!isAbsolute(options.cwd)) throw new Error('Worker cwd must be absolute.');
  if (!Array.isArray(args) || args.some(arg => typeof arg !== 'string' || /\0/.test(arg))) throw new Error('Worker arguments must be a safe string array.');
  const cleanupMarkers = options.cleanupMarkers ?? [];
  if (!Array.isArray(cleanupMarkers) || cleanupMarkers.length > 4 || cleanupMarkers.some(marker => typeof marker !== 'string' || !marker || marker.length > 500 || /[\0\r\n]/.test(marker))) throw new Error('Process cleanup markers are invalid.');
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
      if (this.isAlive()) killGroup(pid, 'SIGTERM');
      signalMatchingProcesses(cleanupMarkers, 'SIGTERM');
      const deadline = Date.now() + timeoutMs;
      while (this.isAlive() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
      if (this.isAlive()) killGroup(pid, 'SIGKILL');
      signalMatchingProcesses(cleanupMarkers, 'SIGKILL');
      outputSize = Math.min(outputSize, 32_768);
    },
  };
}

/**
 * Copies `source[offset..]` into `target`. The shared Appium log is one file
 * for the host's lifetime; a run's slice starts at the size the file had when
 * the worker was spawned. Bounded, so a runaway log cannot fill the artifacts.
 */
export async function copyFileTail(source: string, offset: number, target: string, maximumBytes = 64 * 1024 * 1024): Promise<number> {
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('The log offset must be a non-negative integer.');
  let handle;
  try { handle = await openFile(source, 'r'); } catch { await writeFile(target, ''); return 0; }
  try {
    const size = (await handle.stat()).size;
    const length = Math.max(0, Math.min(size - offset, maximumBytes));
    const buffer = Buffer.alloc(length);
    if (length > 0) await handle.read(buffer, 0, length, offset);
    await writeFile(target, buffer);
    return length;
  } finally { await handle.close(); }
}

export function makeWorkerEnvironment(device: DeviceProfile, runId: string, artifactDir: string, port: number, wdaLocalPort: number, wdaDerivedDataPath: string, testingRoot = process.cwd(), workerInputFile?: string): Record<string, string> {
  if (!isAbsolute(artifactDir)) throw new Error('Artifact directory must be absolute.');
  if (!isAbsolute(wdaDerivedDataPath)) throw new Error('WDA DerivedData path must be absolute.');
  if (workerInputFile !== undefined && !isAbsolute(workerInputFile)) throw new Error('Worker input file must be absolute.');
  return {
    PATH: process.env.PATH ?? '',
    HOME: process.env.HOME ?? '',
    IOS_UDID: device.udid,
    APPLE_TEAM_ID: device.teamId,
    WDA_BUNDLE_ID: device.wdaBundleId,
    WDIO_RUN_ID: runId,
    IOS_TESTING_ROOT: testingRoot,
    RUN_ARTIFACT_DIR: artifactDir,
    APPIUM_PORT: String(port),
    WDA_LOCAL_PORT: String(wdaLocalPort),
    WDA_DERIVED_DATA_PATH: wdaDerivedDataPath,
    ...(workerInputFile ? { RUN_INPUT_FILE: workerInputFile } : {}),
  };
}

export interface WdioConfigInput {
  runId: string;
  device: DeviceProfile;
  entry: string;
  artifactDir: string;
  port: number;
  wdaLocalPort: number;
  wdaDerivedDataPath: string;
  /** True when the host already runs an Appium server on `port`; the worker must not start its own. */
  sharedAppium?: boolean;
  /**
   * Runs once after the spec, with the device session still open. Used to
   * leave POS on Home with an empty cart after a mutation run, pass or fail,
   * so the next run starts from the same state. Its outcome is recorded in
   * reset.json and never changes the run's result.
   */
  afterSpec?: () => Promise<void>;
}

export function makeWdioConfig(input: WdioConfigInput): WebdriverIO.Config {
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
    // A native POS scenario spends real time waiting on the device. At 120s a
    // slow-but-healthy run was being killed mid-step and reported as "worker
    // exited without a structured result", which hid the actual failure.
    mochaOpts: { timeout: 420_000 },
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
    after: async function () {
      if (!input.afterSpec) return;
      const startedAt = Date.now();
      let outcome: { ok: boolean; message: string | null } = { ok: true, message: null };
      try { await input.afterSpec(); }
      catch (cause) { outcome = { ok: false, message: (cause instanceof Error ? cause.message : String(cause)).slice(0, 500) }; }
      try {
        await mkdir(input.artifactDir, { recursive: true });
        await writeFile(join(input.artifactDir, 'reset.json'), JSON.stringify({ ...outcome, durationMs: Date.now() - startedAt }));
      } catch { /* the reset record is evidence, never the verdict */ }
    },
    ...(input.sharedAppium ? {} : { services: [['appium', { args: { address: '127.0.0.1', port: input.port, logLevel: 'info', logFilters: appiumLogFiltersFile }, logPath: input.artifactDir }]] }),
  };
}
