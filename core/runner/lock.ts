import { mkdir, open, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

export interface DeviceRunLock {
  acquired: boolean;
  owner?: { pid: number; runId: string; deviceId: string };
  release(): Promise<void>;
}

export async function acquireDeviceRunLock(root: string, deviceId: string, runId: string): Promise<DeviceRunLock> {
  if (!/^[a-zA-Z0-9._-]{1,100}$/.test(deviceId)) throw new Error('Invalid device lock ID.');
  const directory = join(resolve(root), '.runtime', 'devices');
  const path = join(directory, `${deviceId}.lock`);
  await mkdir(directory, { recursive: true });
  const nonce = randomBytes(16).toString('hex');
  const owner = { pid: process.pid, runId, deviceId, nonce };
  try {
    const handle = await open(path, 'wx');
    await handle.writeFile(JSON.stringify(owner));
    await handle.close();
    return {
      acquired: true,
      async release() {
        try {
          const current = JSON.parse(await readFile(path, 'utf8')) as typeof owner;
          if (current.nonce === nonce) await rm(path, { force: true });
        } catch { /* already released */ }
      },
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    try {
      const current = JSON.parse(await readFile(path, 'utf8')) as typeof owner;
      try { process.kill(current.pid, 0); }
      catch (probeError) {
        if ((probeError as NodeJS.ErrnoException).code === 'ESRCH') {
          await rm(path, { force: true });
          return acquireDeviceRunLock(root, deviceId, runId);
        }
      }
      return { acquired: false, owner: { pid: current.pid, runId: current.runId, deviceId: current.deviceId }, async release() {} };
    } catch {
      return { acquired: false, async release() {} };
    }
  }
}
