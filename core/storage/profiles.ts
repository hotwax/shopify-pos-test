import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { DeviceProfile } from '../../shared/contracts.ts';

const idPattern = /^[a-zA-Z0-9_-]{1,80}$/;
const udidPattern = /^(?:[0-9a-f]{8}-[0-9a-f]{16}|[0-9a-f]{40})$/i;
const teamPattern = /^[A-Z0-9]{10}$/;
const bundlePattern = /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;

function validate(profile: DeviceProfile): DeviceProfile {
  if (!idPattern.test(profile.id)) throw new Error('Invalid device profile ID.');
  if (!udidPattern.test(profile.udid) || profile.udid === 'auto') throw new Error('Invalid device profile UDID.');
  if (!teamPattern.test(profile.teamId)) throw new Error('Invalid device profile team ID.');
  if (!bundlePattern.test(profile.wdaBundleId)) throw new Error('Invalid device profile WDA bundle ID.');
  if (profile.name !== undefined && (typeof profile.name !== 'string' || !profile.name.trim() || profile.name.length > 80)) throw new Error('Invalid device profile name.');
  for (const value of [profile.model, profile.os]) if (value !== undefined && (typeof value !== 'string' || value.length > 80)) throw new Error('Invalid device profile device details.');
  return { ...profile, ...(profile.name === undefined ? {} : { name: profile.name.trim() }) };
}

function pathFor(root: string): string { return join(resolve(root), '.runtime', 'profiles.json'); }

export async function loadDeviceProfiles(root: string): Promise<DeviceProfile[]> {
  try {
    const parsed = JSON.parse(await readFile(pathFor(root), 'utf8')) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map(item => validate(item as DeviceProfile));
  } catch { return []; }
}

export async function saveDeviceProfile(root: string, profile: DeviceProfile): Promise<void> {
  const valid = validate(profile);
  const profiles = await loadDeviceProfiles(root);
  const next = [...profiles.filter(item => item.id !== valid.id), valid].sort((a, b) => a.id.localeCompare(b.id));
  const file = pathFor(root);
  await mkdir(resolve(root, '.runtime'), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporary, JSON.stringify(next, null, 2), { flag: 'wx' });
  await rename(temporary, file);
}

export async function getDeviceProfile(root: string, id: string): Promise<DeviceProfile | undefined> {
  return (await loadDeviceProfiles(root)).find(profile => profile.id === id);
}
