import assert from 'node:assert/strict';
import { test } from 'node:test';
import { listDevices, readDeviceLockState, runSetupChecks, type CommandRunner } from '../../core/setup/checks.ts';
import type { DeviceProfile } from '../../shared/contracts.ts';

const profile: DeviceProfile = {
  id: 'test-ipad', udid: '00008103-0000000000000000', teamId: 'ABCDE12345', wdaBundleId: 'co.example.runner',
};

function runner(values: Record<string, string | Error>): CommandRunner {
  return async (file, args) => {
    const key = `${file} ${args.join(' ')}`;
    const value = values[key];
    if (value instanceof Error) throw value;
    if (value === undefined) throw new Error(`Unexpected command: ${key}`);
    return value;
  };
}

const pairedDevice = JSON.stringify({ result: {
  hardwareProperties: { udid: profile.udid, deviceType: 'iPad', marketingName: 'iPad Pro' },
  connectionProperties: { pairingState: 'paired' },
  deviceProperties: { developerModeStatus: 'enabled', osVersionNumber: '27.0' },
} });
const currentPairedDevice = JSON.stringify({ result: {
  properties: {
    hardware: { udid: profile.udid, deviceType: 'iPad', marketingName: 'iPad Pro' },
    connection: { pairingState: 'paired' },
    software: { osVersionNumber: { stringValue: '27.0' } },
    state: { developerModeStatus: { enabled: true } },
  },
} });
const posApps = JSON.stringify({ result: { apps: [{ bundleIdentifier: 'com.jadedpixel.pos', version: '11.14.0', bundleVersion: '505086' }] } });
const unlockedDevice = JSON.stringify({ result: { passcodeRequired: false, unlockedSinceBoot: true } });
const lockedDevice = JSON.stringify({ result: { passcodeRequired: true, unlockedSinceBoot: true } });

function lockStateKey(): string {
  return `xcrun devicectl device info lockState --device ${profile.udid} --timeout 15 --quiet --json-output - --omit-deprecated-fields-in-json`;
}

test('reads CoreDevice lock state without changing the iPad', async () => {
  assert.deepEqual(await readDeviceLockState(profile.udid, runner({ [lockStateKey()]: lockedDevice })), { passcodeRequired: true, unlockedSinceBoot: true });
});

test('distinguishes full Xcode from command-line tools', async () => {
  const checks = await runSetupChecks(profile, runner({
    'xcode-select -p': '/Library/Developer/CommandLineTools',
  }));
  assert.equal(checks.find(check => check.id === 'host.xcode')?.state, 'action');
  assert.match(checks.find(check => check.id === 'host.xcode')?.message ?? '', /full Xcode/);
});

test('reports missing development identity without turning the setup green', async () => {
  const checks = await runSetupChecks(profile, runner({
    'xcode-select -p': '/Applications/Xcode.app/Contents/Developer',
    'xcodebuild -version': 'Xcode 27.0\nBuild version 27A266a',
    [`xcrun devicectl device info details --device ${profile.udid} --timeout 15 --json-output - --omit-deprecated-fields-in-json`]: pairedDevice,
    [lockStateKey()]: unlockedDevice,
    [`xcrun devicectl device info apps --device ${profile.udid} --include-default-apps --bundle-id com.jadedpixel.pos --timeout 15 --json-output - --omit-deprecated-fields-in-json`]: posApps,
    'security find-identity -v -p codesigning': '0 valid identities found',
  }));
  assert.equal(checks.find(check => check.id === 'signing.identity')?.state, 'action');
  assert.ok(checks.some(check => check.state !== 'ready'));
});

test('reports unpaired, unsupported and not-installed device states', async () => {
  const checks = await runSetupChecks(profile, runner({
    'xcode-select -p': '/Applications/Xcode.app/Contents/Developer',
    'xcodebuild -version': 'Xcode 27.0\nBuild version 27A266a',
    [`xcrun devicectl device info details --device ${profile.udid} --timeout 15 --json-output - --omit-deprecated-fields-in-json`]: JSON.stringify({ result: {
      hardwareProperties: { udid: profile.udid, deviceType: 'iPad' },
      connectionProperties: { pairingState: 'unpaired' },
      deviceProperties: { developerModeStatus: 'enabled', osVersionNumber: '99.0' },
    } }),
    [lockStateKey()]: unlockedDevice,
    [`xcrun devicectl device info apps --device ${profile.udid} --include-default-apps --bundle-id com.jadedpixel.pos --timeout 15 --json-output - --omit-deprecated-fields-in-json`]: JSON.stringify({ result: { apps: [] } }),
    'security find-identity -v -p codesigning': '1) ABCDE Apple Development: Test',
  }));
  assert.equal(checks.find(check => check.id === 'device.pairing')?.state, 'action');
  assert.equal(checks.find(check => check.id === 'device.os')?.state, 'unsupported');
  assert.equal(checks.find(check => check.id === 'pos.installed')?.state, 'action');
});

test('never marks WDA or POS Home ready without a user-owned live session', async () => {
  const checks = await runSetupChecks(profile, runner({
    'xcode-select -p': '/Applications/Xcode.app/Contents/Developer',
    'xcodebuild -version': 'Xcode 27.0\nBuild version 27A266a',
    [`xcrun devicectl device info details --device ${profile.udid} --timeout 15 --json-output - --omit-deprecated-fields-in-json`]: pairedDevice,
    [lockStateKey()]: lockedDevice,
    [`xcrun devicectl device info apps --device ${profile.udid} --include-default-apps --bundle-id com.jadedpixel.pos --timeout 15 --json-output - --omit-deprecated-fields-in-json`]: posApps,
    'security find-identity -v -p codesigning': '1) ABCDE Apple Development: Test',
  }));
  assert.equal(checks.find(check => check.id === 'wda.session')?.state, 'action');
  assert.equal(checks.find(check => check.id === 'pos.home')?.state, 'action');
  assert.equal(checks.find(check => check.id === 'device.unlocked')?.state, 'action');
  assert.match(checks.find(check => check.id === 'device.unlocked')?.message ?? '', /locked/i);
});

test('parses device discovery without exposing process output beyond safe identity fields', async () => {
  const devices = await listDevices(runner({
    'xcrun devicectl list devices --json-output - --omit-deprecated-fields-in-json': JSON.stringify({ result: { devices: [
      { hardwareProperties: { udid: profile.udid, marketingName: 'iPad Pro', deviceType: 'iPad' }, deviceProperties: { osVersionNumber: '27.0' } },
    ] } }),
  }));
  assert.deepEqual(devices, [{ udid: profile.udid, name: 'iPad Pro', model: 'iPad', os: '27.0' }]);
});

test('parses the current CoreDevice properties shape without changing device settings', async () => {
  const checks = await runSetupChecks(profile, runner({
    'xcode-select -p': '/Applications/Xcode.app/Contents/Developer',
    'xcodebuild -version': 'Xcode 27.0\nBuild version 27A266a',
    [`xcrun devicectl device info details --device ${profile.udid} --timeout 15 --json-output - --omit-deprecated-fields-in-json`]: currentPairedDevice,
    [lockStateKey()]: unlockedDevice,
    [`xcrun devicectl device info apps --device ${profile.udid} --include-default-apps --bundle-id com.jadedpixel.pos --timeout 15 --json-output - --omit-deprecated-fields-in-json`]: posApps,
    'security find-identity -v -p codesigning': '1) ABCDE Apple Development: Test',
  }));
  assert.equal(checks.find(check => check.id === 'device.pairing')?.state, 'ready');
  assert.equal(checks.find(check => check.id === 'device.developer')?.state, 'ready');
  assert.equal(checks.find(check => check.id === 'device.os')?.state, 'ready');
});
