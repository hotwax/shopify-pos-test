import { readFile } from 'node:fs/promises';
import { timingSafeEqual } from 'node:crypto';
import { join, resolve } from 'node:path';
import { normalizeOmsInstanceName } from '../../shared/oms-origin.ts';
import { loadOrCreateCredentialKey, omsKeychainAccount } from './credential-key.ts';
import { seal, unseal, writeOwnerOnlyJson, type Sealed } from './sealed-store.ts';

export interface SavedOmsConnection {
  id: string;
  instanceName: string;
  username: string;
  label: string;
  autoConnect: boolean;
  updatedAt: string;
}

interface StoredRecord extends SavedOmsConnection, Sealed {}

interface StoreFile {
  version: 1;
  entries: StoredRecord[];
}

const currentVersion = 1;
const maxUsernameLength = 200;
const maxPasswordLength = 400;

function pathFor(root: string): string { return join(resolve(root), '.runtime', 'oms-credentials.json'); }

function idFor(instanceName: string, username: string): string {
  return `${instanceName}::${username.toLowerCase()}`;
}

// Only the password is encrypted. The instance name and username are kept
// readable so the UI can list saved connections without unlocking anything,
// and they are bound into the ciphertext as additional authenticated data so a
// record cannot be re-pointed at a different instance or user.
function associatedData(instanceName: string, username: string): Buffer {
  return Buffer.from(`${currentVersion}:${instanceName}:${username}`, 'utf8');
}

function publicView(record: StoredRecord): SavedOmsConnection {
  const { iv: _iv, authTag: _authTag, secret: _secret, ...rest } = record;
  return rest;
}

async function readStore(root: string): Promise<StoreFile> {
  try {
    const parsed = JSON.parse(await readFile(pathFor(root), 'utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object') return { version: currentVersion, entries: [] };
    const file = parsed as StoreFile;
    if (file.version !== currentVersion || !Array.isArray(file.entries)) return { version: currentVersion, entries: [] };
    return { version: currentVersion, entries: file.entries.filter(entry => entry && typeof entry === 'object') };
  } catch { return { version: currentVersion, entries: [] }; }
}

async function writeStore(root: string, file: StoreFile): Promise<void> {
  await writeOwnerOnlyJson(pathFor(root), file);
}

export async function listSavedOmsConnections(root: string): Promise<SavedOmsConnection[]> {
  const file = await readStore(root);
  return file.entries.map(publicView).sort((a, b) => a.id.localeCompare(b.id));
}

export async function saveOmsCredential(root: string, input: { instanceName: string; username: string; password: string; label?: string; autoConnect?: boolean }): Promise<SavedOmsConnection> {
  const instanceName = normalizeOmsInstanceName(input.instanceName);
  const username = input.username.trim();
  if (!username || username.length > maxUsernameLength) throw new Error('A username is required to save a connection.');
  if (!input.password || input.password.length > maxPasswordLength) throw new Error('A password is required to save a connection.');

  const key = await loadOrCreateCredentialKey(omsKeychainAccount);
  const record: StoredRecord = {
    id: idFor(instanceName, username),
    instanceName,
    username,
    label: (input.label ?? instanceName).trim().slice(0, 120) || instanceName,
    autoConnect: input.autoConnect !== false,
    updatedAt: new Date().toISOString(),
    ...seal(key, input.password, associatedData(instanceName, username)),
  };

  const file = await readStore(root);
  await writeStore(root, { version: currentVersion, entries: [...file.entries.filter(entry => entry.id !== record.id), record] });
  return publicView(record);
}

export async function readOmsCredential(root: string, id: string): Promise<{ instanceName: string; username: string; password: string } | null> {
  const file = await readStore(root);
  const record = file.entries.find(entry => entry.id === id);
  if (!record) return null;
  const key = await loadOrCreateCredentialKey(omsKeychainAccount);
  // A tampered record fails the GCM auth tag here and is reported as unusable
  // rather than returning half-decrypted bytes.
  const password = unseal(key, record, associatedData(record.instanceName, record.username));
  return { instanceName: record.instanceName, username: record.username, password };
}

export async function forgetOmsCredential(root: string, id: string): Promise<boolean> {
  const file = await readStore(root);
  const next = file.entries.filter(entry => entry.id !== id);
  if (next.length === file.entries.length) return false;
  await writeStore(root, { version: currentVersion, entries: next });
  return true;
}

export async function autoConnectOmsCredentials(root: string): Promise<SavedOmsConnection[]> {
  return (await listSavedOmsConnections(root)).filter(entry => entry.autoConnect);
}

/** Exposed for tests: confirms two buffers match without a timing side channel. */
export function secretsMatch(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

interface AutoConnectTarget {
  addConnection?: (draft: { instanceName: string }) => { id: string };
  login: (connectionId: string, credentials: { username: string; password: string }) => Promise<unknown>;
}

/**
 * Signs in to every connection marked for auto-connect. Best effort by design:
 * a Keychain that is locked, a revoked password or an OMS that is down must
 * degrade to a manual login, never stop the server from starting.
 */
export async function autoConnectSavedOmsConnections(root: string, oms: AutoConnectTarget): Promise<{ connected: string[]; failed: { id: string; reason: string }[] }> {
  const connected: string[] = [];
  const failed: { id: string; reason: string }[] = [];
  let targets: SavedOmsConnection[] = [];
  try { targets = await autoConnectOmsCredentials(root); }
  catch (cause) { return { connected, failed: [{ id: 'store', reason: cause instanceof Error ? cause.message : 'unavailable' }] }; }

  for (const target of targets) {
    try {
      const credential = await readOmsCredential(root, target.id);
      if (!credential) { failed.push({ id: target.id, reason: 'no longer saved' }); continue; }
      if (!oms.addConnection) { failed.push({ id: target.id, reason: 'connections cannot be added' }); continue; }
      const connection = oms.addConnection({ instanceName: credential.instanceName });
      await oms.login(connection.id, { username: credential.username, password: credential.password });
      connected.push(target.id);
    } catch (cause) {
      // The reason is a category, never the credential itself.
      failed.push({ id: target.id, reason: cause instanceof Error ? cause.message : 'sign-in failed' });
    }
  }
  return { connected, failed };
}
