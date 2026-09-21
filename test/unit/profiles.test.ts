import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { loadDeviceProfiles, saveDeviceProfile } from '../../core/storage/profiles.ts';
import type { DeviceProfile } from '../../shared/contracts.ts';

const profile: DeviceProfile = { id: 'test-ipad', udid: '00008103-0000000000000000', teamId: 'ABCDE12345', wdaBundleId: 'co.example.runner' };

test('saves and reloads device profile metadata atomically', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ios-testing-profiles-'));
  const saved = { ...profile, name: 'Brooklyn POS iPad', model: 'iPad Pro', os: '27.0' };
  await saveDeviceProfile(root, saved);
  assert.deepEqual(await loadDeviceProfiles(root), [saved]);
});

test('rejects profile values that could escape the local profile store', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ios-testing-profiles-'));
  await assert.rejects(() => saveDeviceProfile(root, { ...profile, id: '../unsafe' }), /profile/);
  await assert.rejects(() => saveDeviceProfile(root, { ...profile, udid: 'auto' }), /UDID/);
});
