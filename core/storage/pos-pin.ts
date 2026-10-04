import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { loadOrCreateCredentialKey, posPinKeychainAccount } from './credential-key.ts';
import type { SavedPosPin } from '../../shared/contracts.ts';
import { seal, unseal, writeOwnerOnlyJson, type Sealed } from './sealed-store.ts';

interface StoredPin extends SavedPosPin, Sealed {}

interface StoreFile {
  version: 1;
  entries: StoredPin[];
}

const currentVersion = 1;
const pinPattern = /^\d{4,6}$/;
const udidPattern = /^(?:[0-9a-f]{8}-[0-9a-f]{16}|[0-9a-f]{40})$/i;

function pathFor(root: string): string { return join(resolve(root), '.runtime', 'pos-pins.json'); }

function associatedData(udid: string): Buffer {
  return Buffer.from(`${currentVersion}:pos-pin:${udid}`, 'utf8');
}

function exactUdid(udid: string): string {
  if (!udidPattern.test(udid)) throw new Error('A POS PIN must belong to an exact iPad UDID.');
  return udid;
}

async function readStore(root: string): Promise<StoreFile> {
  try {
    const file = JSON.parse(await readFile(pathFor(root), 'utf8')) as Partial<StoreFile>;
    if (file.version !== currentVersion || !Array.isArray(file.entries)) return { version: currentVersion, entries: [] };
    return { version: currentVersion, entries: file.entries };
  } catch { return { version: currentVersion, entries: [] }; }
}

export async function savePosPin(root: string, udid: string, pin: string): Promise<SavedPosPin> {
  exactUdid(udid);
  if (!pinPattern.test(pin)) throw new Error('A Shopify POS PIN is 4 to 6 digits.');
  const key = await loadOrCreateCredentialKey(posPinKeychainAccount);
  const record: StoredPin = { udid, updatedAt: new Date().toISOString(), ...seal(key, pin, associatedData(udid)) };
  const file = await readStore(root);
  await writeOwnerOnlyJson(pathFor(root), { version: currentVersion, entries: [...file.entries.filter(entry => entry.udid !== udid), record] });
  return { udid, updatedAt: record.updatedAt };
}

export async function savedPosPin(root: string, udid: string): Promise<SavedPosPin | null> {
  const record = (await readStore(root)).entries.find(entry => entry.udid === exactUdid(udid));
  return record ? { udid: record.udid, updatedAt: record.updatedAt } : null;
}

export async function readPosPin(root: string, udid: string): Promise<string | null> {
  const record = (await readStore(root)).entries.find(entry => entry.udid === exactUdid(udid));
  if (!record) return null;
  return unseal(await loadOrCreateCredentialKey(posPinKeychainAccount), record, associatedData(udid));
}

export async function forgetPosPin(root: string, udid: string): Promise<boolean> {
  const file = await readStore(root);
  const entries = file.entries.filter(entry => entry.udid !== exactUdid(udid));
  if (entries.length === file.entries.length) return false;
  await writeOwnerOnlyJson(pathFor(root), { version: currentVersion, entries });
  return true;
}
