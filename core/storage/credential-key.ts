import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { promisify } from 'node:util';

const run = promisify(execFile);

// The encryption key lives in the macOS login Keychain, never on disk beside
// the data it protects. A key stored next to its ciphertext is obfuscation,
// not encryption: anyone who can read the file can read the key too.
export const keychainService = 'hotwax-ios-testing';
export const keychainAccount = 'oms-credential-store';

export const keyLength = 32;

export class KeychainUnavailableError extends Error {
  constructor(message: string) { super(message); this.name = 'KeychainUnavailableError'; }
}

async function readKey(): Promise<Buffer | null> {
  try {
    const { stdout } = await run('security', ['find-generic-password', '-s', keychainService, '-a', keychainAccount, '-w']);
    const key = Buffer.from(stdout.trim(), 'base64');
    return key.length === keyLength ? key : null;
  } catch (cause) {
    // 44 is "item not found", which is the ordinary first-run case.
    if (typeof cause === 'object' && cause && 'code' in cause && (cause as { code?: number }).code === 44) return null;
    throw new KeychainUnavailableError('The macOS Keychain could not be read, so saved OMS connections are unavailable.');
  }
}

async function writeKey(key: Buffer): Promise<void> {
  try {
    // -U updates an existing item rather than failing. The key is passed as an
    // argument because `security` has no stdin form for it; it is visible in
    // this process's argv for the moment the command runs.
    await run('security', ['add-generic-password', '-U', '-s', keychainService, '-a', keychainAccount, '-w', key.toString('base64')]);
  } catch {
    throw new KeychainUnavailableError('The macOS Keychain could not be written, so OMS connections cannot be saved.');
  }
}

let cached: Buffer | undefined;

export async function loadOrCreateCredentialKey(): Promise<Buffer> {
  if (cached) return cached;
  const existing = await readKey();
  if (existing) { cached = existing; return existing; }
  const created = randomBytes(keyLength);
  await writeKey(created);
  cached = created;
  return created;
}

export async function credentialKeyExists(): Promise<boolean> {
  try { return (await readKey()) !== null; }
  catch { return false; }
}

/** Removes the key, which makes every stored credential permanently unreadable. */
export async function deleteCredentialKey(): Promise<void> {
  cached = undefined;
  try { await run('security', ['delete-generic-password', '-s', keychainService, '-a', keychainAccount]); }
  catch { /* nothing to delete is a success for the caller */ }
}

/** Test seam: lets the store be exercised without touching the real Keychain. */
export function setCredentialKeyForTesting(key: Buffer | undefined): void { cached = key; }
