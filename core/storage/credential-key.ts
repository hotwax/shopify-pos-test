import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { promisify } from 'node:util';

const run = promisify(execFile);

// The encryption key lives in the macOS login Keychain, never on disk beside
// the data it protects. A key stored next to its ciphertext is obfuscation,
// not encryption: anyone who can read the file can read the key too.
export const keychainService = 'hotwax-ios-testing';
export const omsKeychainAccount = 'oms-credential-store';
export const posPinKeychainAccount = 'pos-pin-store';

export const keyLength = 32;
const keychainItemNotFound = 44;

export class KeychainUnavailableError extends Error {
  constructor(message: string) { super(message); this.name = 'KeychainUnavailableError'; }
}

async function readKey(account: string): Promise<Buffer | null> {
  try {
    const { stdout } = await run('security', ['find-generic-password', '-s', keychainService, '-a', account, '-w']);
    const key = Buffer.from(stdout.trim(), 'base64');
    return key.length === keyLength ? key : null;
  } catch (cause) {
    if (typeof cause === 'object' && cause && 'code' in cause && (cause as { code?: number }).code === keychainItemNotFound) return null;
    throw new KeychainUnavailableError('The macOS Keychain could not be read, so saved credentials are unavailable.');
  }
}

async function writeKey(account: string, key: Buffer): Promise<void> {
  try {
    // -U updates an existing item rather than failing. The key is passed as an
    // argument because `security` has no stdin form for it; it is visible in
    // this process's argv for the moment the command runs.
    await run('security', ['add-generic-password', '-U', '-s', keychainService, '-a', account, '-w', key.toString('base64')]);
  } catch {
    throw new KeychainUnavailableError('The macOS Keychain could not be written, so credentials cannot be saved.');
  }
}

const cached = new Map<string, Buffer>();
let testKey: Buffer | undefined;

export async function loadOrCreateCredentialKey(account: string): Promise<Buffer> {
  const known = testKey ?? cached.get(account);
  if (known) return known;
  const existing = await readKey(account);
  const key = existing ?? randomBytes(keyLength);
  if (!existing) await writeKey(account, key);
  cached.set(account, key);
  return key;
}

export function setCredentialKeyForTesting(key: Buffer | undefined): void {
  testKey = key;
  cached.clear();
}
