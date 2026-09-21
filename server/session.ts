import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, open, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export type LaunchMode = 'dev' | 'serve' | 'test';

export function validateLaunchMode(mode: string): LaunchMode {
  if (mode === 'dev' || mode === 'serve' || mode === 'test') return mode;
  throw new Error(`Unsupported local launcher mode: ${mode}`);
}

export interface LaunchLock {
  acquired: boolean;
  owner?: { pid: number; mode: LaunchMode; createdAt: string };
  release(): Promise<void>;
}

function lockPath(root: string): string {
  return join(resolve(root), '.runtime', 'localhost.lock');
}

export async function createLaunchLock(mode: string, root = process.cwd()): Promise<LaunchLock> {
  const validMode = validateLaunchMode(mode);
  const file = lockPath(root);
  await mkdir(join(resolve(root), '.runtime'), { recursive: true });
  const nonce = randomBytes(16).toString('hex');
  const owner = { pid: process.pid, mode: validMode, createdAt: new Date().toISOString(), nonce };

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const handle = await open(file, 'wx');
      await handle.writeFile(JSON.stringify(owner));
      await handle.close();
      return {
        acquired: true,
        async release() {
          try {
            const current = JSON.parse(await readFile(file, 'utf8')) as typeof owner;
            if (current.nonce === nonce) await rm(file, { force: true });
          } catch { /* the owner already released or the file is gone */ }
        },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      try {
        const current = JSON.parse(await readFile(file, 'utf8')) as typeof owner;
        if (current.pid > 0) {
          try { process.kill(current.pid, 0); } catch (probeError) {
            if ((probeError as NodeJS.ErrnoException).code === 'ESRCH') {
              await rm(file, { force: true });
              continue;
            }
          }
        }
        return {
          acquired: false,
          owner: { pid: current.pid, mode: current.mode, createdAt: current.createdAt },
          async release() { /* a non-owner never removes another process's lock */ },
        };
      } catch {
        await rm(file, { force: true });
      }
    }
  }
  return { acquired: false, async release() {} };
}

export function sessionMatches(expected: string, provided: string | undefined): boolean {
  if (!provided || !expected || provided.length !== expected.length) return false;
  return timingSafeEqual(createHash('sha256').update(expected).digest(), createHash('sha256').update(provided).digest());
}

export function createLocalSession(): { token: string; origin: string; expiresAt: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, origin: 'loopback', expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString() };
}
