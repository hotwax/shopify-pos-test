import assert from 'node:assert/strict';
import { X509Certificate } from 'node:crypto';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { listDevices, listDevelopmentTeamIds, probeRemoteXpcTunnel, readDeviceLockState, remoteXpcTunnelState, requiresRemoteXpc, runHostChecks, runSetupChecks, type CommandRunner } from '../../core/setup/checks.ts';
import type { DeviceProfile } from '../../shared/contracts.ts';
import { developmentCertificate, wwdrG1Certificate, wwdrG3Certificate } from './fixtures/signing-certificates.ts';

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

test('reads the team ID from the certificate team field, not the code in its name', async () => {
  const fingerprint = new X509Certificate(developmentCertificate).fingerprint.replaceAll(':', '');
  const teams = await listDevelopmentTeamIds(runner({
    'security find-identity -v -p codesigning': [
      `  1) ${fingerprint} "Apple Development: Tester (TESTER0001)"`,
      '  2) 89ABCDEF0123456789ABCDEF0123456789ABCDEF "iPhone Distribution: Release (RELEASE1234)"',
      '     2 valid identities found',
    ].join('\n'),
    'security find-certificate -a -c Apple Development -p': developmentCertificate,
  }));
  assert.deepEqual(teams, ['ABCDE12345']);
});

test('offers no team from a certificate that cannot sign', async () => {
  const teams = await listDevelopmentTeamIds(runner({
    'security find-identity -v -p codesigning': '     0 valid identities found',
    'security find-certificate -a -c Apple Development -p': developmentCertificate,
  }));
  assert.deepEqual(teams, []);
});

test('accepts only a healthy local RemoteXPC tunnel registry response', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () => new Response(JSON.stringify({ status: 'OK' }), { status: 200 })) as typeof fetch;
    assert.equal(await probeRemoteXpcTunnel(), true);
    globalThis.fetch = (async () => new Response(JSON.stringify({ status: 'DOWN' }), { status: 200 })) as typeof fetch;
    assert.equal(await probeRemoteXpcTunnel(), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('requires RemoteXPC only for iOS 18 and later', async () => {
  const detailsKey = `xcrun devicectl device info details --device ${profile.udid} --timeout 15 --json-output - --omit-deprecated-fields-in-json`;
  assert.equal(await requiresRemoteXpc(profile.udid, runner({ [detailsKey]: pairedDevice })), true);
  const legacy = JSON.stringify({ result: { deviceProperties: { osVersionNumber: '17.7' } } });
  assert.equal(await requiresRemoteXpc(profile.udid, runner({ [detailsKey]: legacy })), false);
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
    'xcodebuild -license check': '',
    [`xcrun devicectl device info details --device ${profile.udid} --timeout 15 --json-output - --omit-deprecated-fields-in-json`]: pairedDevice,
    [lockStateKey()]: unlockedDevice,
    [`xcrun devicectl device info apps --device ${profile.udid} --include-default-apps --bundle-id com.jadedpixel.pos --timeout 15 --json-output - --omit-deprecated-fields-in-json`]: posApps,
    'security find-identity -v -p codesigning': '0 valid identities found',
    'security find-identity -p codesigning': '0 identities found',
  }));
  assert.equal(checks.find(check => check.id === 'signing.identity')?.state, 'action');
  assert.ok(checks.some(check => check.state !== 'ready'));
});

test('reports unpaired, unsupported and not-installed device states', async () => {
  const checks = await runSetupChecks(profile, runner({
    'xcode-select -p': '/Applications/Xcode.app/Contents/Developer',
    'xcodebuild -version': 'Xcode 27.0\nBuild version 27A266a',
    'xcodebuild -license check': '',
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
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () => { throw new Error('Connection refused'); }) as typeof fetch;
    const checks = await runSetupChecks(profile, runner({
      'xcode-select -p': '/Applications/Xcode.app/Contents/Developer',
      'xcodebuild -version': 'Xcode 27.0\nBuild version 27A266a',
    'xcodebuild -license check': '',
      [`xcrun devicectl device info details --device ${profile.udid} --timeout 15 --json-output - --omit-deprecated-fields-in-json`]: pairedDevice,
      [lockStateKey()]: lockedDevice,
      [`xcrun devicectl device info apps --device ${profile.udid} --include-default-apps --bundle-id com.jadedpixel.pos --timeout 15 --json-output - --omit-deprecated-fields-in-json`]: posApps,
      'security find-identity -v -p codesigning': '1) ABCDE Apple Development: Test',
    }));
    assert.equal(checks.find(check => check.id === 'wda.session')?.state, 'action');
    assert.equal(checks.find(check => check.id === 'pos.home')?.state, 'action');
    assert.equal(checks.find(check => check.id === 'device.unlocked')?.state, 'action');
    assert.equal(checks.find(check => check.id === 'device.remote-xpc')?.state, 'action');
    assert.match(checks.find(check => check.id === 'device.unlocked')?.message ?? '', /locked/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
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
    'xcodebuild -license check': '',
    [`xcrun devicectl device info details --device ${profile.udid} --timeout 15 --json-output - --omit-deprecated-fields-in-json`]: currentPairedDevice,
    [lockStateKey()]: unlockedDevice,
    [`xcrun devicectl device info apps --device ${profile.udid} --include-default-apps --bundle-id com.jadedpixel.pos --timeout 15 --json-output - --omit-deprecated-fields-in-json`]: posApps,
    'security find-identity -v -p codesigning': '1) ABCDE Apple Development: Test',
  }));
  assert.equal(checks.find(check => check.id === 'device.pairing')?.state, 'ready');
  assert.equal(checks.find(check => check.id === 'device.developer')?.state, 'ready');
  assert.equal(checks.find(check => check.id === 'device.os')?.state, 'ready');
});

test('runs host checks independently of an iPad profile', async () => {
  const checks = await runHostChecks(runner({
    'xcode-select -p': '/Applications/Xcode.app/Contents/Developer',
    'xcodebuild -version': 'Xcode 27.0\nBuild version 27A266a',
    'xcodebuild -license check': '',
    'security find-identity -v -p codesigning': '  1) 0123456789ABCDEF0123456789ABCDEF01234567 "Apple Development: Developer (ABCDE12345)"',
  }));
  assert.equal(checks.find(check => check.id === 'host.node')?.state, 'ready');
  assert.equal(checks.find(check => check.id === 'host.xcode')?.state, 'ready');
  assert.equal(checks.find(check => check.id === 'signing.identity')?.state, 'ready');
  assert.ok(checks.some(check => check.id === 'host.remote-xpc'));
});

const trustedIdentity = '  1) 0123456789ABCDEF0123456789ABCDEF01234567 "Apple Development: Developer (ABCDE12345)"';
const untrustedIdentities = [
  'Policy: Code Signing',
  '  Matching identities',
  trustedIdentity,
  '     1 identities found',
  '',
  '  Valid identities only',
  '     0 valid identities found',
].join('\n');
const wwdrName = 'Apple Worldwide Developer Relations Certification Authority';

function hostRunner(overrides: Record<string, string | Error> = {}): CommandRunner {
  return runner({
    'xcode-select -p': '/Applications/Xcode.app/Contents/Developer',
    'xcodebuild -version': 'Xcode 27.0\nBuild version 27A266a',
    'xcodebuild -license check': '',
    'security find-identity -v -p codesigning': trustedIdentity,
    ...overrides,
  });
}

async function hostCheck(id: string, run: CommandRunner, root?: string) {
  return (await runHostChecks(run, root)).find(check => check.id === id);
}

test('asks for a newer Xcode when the selected Xcode is older than the toolkit needs', async () => {
  const xcode = await hostCheck('host.xcode', hostRunner({ 'xcodebuild -version': 'Xcode 26.6\nBuild version 17F113' }));
  assert.equal(xcode?.state, 'action');
  assert.match(xcode?.message ?? '', /Xcode 26\.6 is too old/);
  assert.match(xcode?.actions[0] ?? '', /Update Xcode to version 27 or later/);
});

test('explains an old Xcode instead of showing the raw devicectl option error', async () => {
  await assert.rejects(
    listDevices(runner({
      'xcrun devicectl list devices --json-output - --omit-deprecated-fields-in-json': new Error("Command failed: xcrun devicectl list devices\nError: Unknown option '--omit-deprecated-fields-in-json'"),
    })),
    /Update Xcode to version 27 or later/,
  );
});

test('asks to create a certificate when Keychain has no Apple Development identity', async () => {
  const signing = await hostCheck('signing.identity', hostRunner({
    'security find-identity -v -p codesigning': '     0 valid identities found',
    'security find-identity -p codesigning': '     0 identities found',
  }));
  assert.equal(signing?.state, 'action');
  assert.match(signing?.actions[0] ?? '', /Manage Certificates/);
  assert.equal(signing?.link, undefined);
});

test('links to the missing Apple intermediate certificate when the identity is not trusted', async () => {
  const signing = await hostCheck('signing.identity', hostRunner({
    'security find-identity -v -p codesigning': '     0 valid identities found',
    'security find-identity -p codesigning': untrustedIdentities,
    'security find-certificate -a -c Apple Development -p': developmentCertificate,
    [`security find-certificate -a -c ${wwdrName} -p`]: wwdrG1Certificate,
  }));
  assert.equal(signing?.state, 'action');
  assert.match(signing?.message ?? '', /intermediate certificate/);
  assert.equal(signing?.link, 'https://www.apple.com/certificateauthority/AppleWWDRCAG3.cer');
  assert.match(signing?.command ?? '', /curl -fsSL https:\/\/www\.apple\.com\/certificateauthority\/AppleWWDRCAG3\.cer .*security import .* -k ~\/Library\/Keychains\/login\.keychain-db/);
});

test('links to the intermediate certificate when Keychain has none with its name', async () => {
  const signing = await hostCheck('signing.identity', hostRunner({
    'security find-identity -v -p codesigning': '     0 valid identities found',
    'security find-identity -p codesigning': untrustedIdentities,
    'security find-certificate -a -c Apple Development -p': developmentCertificate,
    [`security find-certificate -a -c ${wwdrName} -p`]: '',
  }));
  assert.equal(signing?.link, 'https://www.apple.com/certificateauthority/AppleWWDRCAG3.cer');
});

test('asks for a new certificate when the identity and its issuer are installed but not trusted', async () => {
  const signing = await hostCheck('signing.identity', hostRunner({
    'security find-identity -v -p codesigning': '     0 valid identities found',
    'security find-identity -p codesigning': untrustedIdentities,
    'security find-certificate -a -c Apple Development -p': developmentCertificate,
    [`security find-certificate -a -c ${wwdrName} -p`]: `${wwdrG1Certificate}${wwdrG3Certificate}`,
  }));
  assert.equal(signing?.state, 'action');
  assert.match(signing?.message ?? '', /expired or revoked/);
  assert.match(signing?.actions[0] ?? '', /Manage Certificates/);
  assert.equal(signing?.link, undefined);
});

test('gives a tunnel command that runs the driver script directly, so Appium never writes as root', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () => { throw new Error('Connection refused'); }) as typeof fetch;
    const tunnel = await hostCheck('host.remote-xpc', hostRunner(), '/Users/tester/pos testing');
    assert.equal(tunnel?.state, 'action');
    assert.equal(tunnel?.command, 'sudo env "PATH=$PATH" node "/Users/tester/pos testing/node_modules/appium-xcuitest-driver/scripts/tunnel-creation.mjs"');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('asks to fix an Appium cache folder this user cannot write', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ios-testing-cache-'));
  const cache = join(root, 'node_modules', '.cache');
  const appiumCache = join(cache, 'appium');
  await mkdir(appiumCache, { recursive: true });
  await writeFile(join(appiumCache, 'extensions.yaml'), 'drivers: {}\n');
  await chmod(appiumCache, 0o555);
  try {
    const cacheCheck = await hostCheck('host.appium-cache', hostRunner(), root);
    assert.equal(cacheCheck?.state, 'action');
    assert.equal(cacheCheck?.command, `sudo chown -R "$USER" "${cache}"`);
  } finally {
    await chmod(appiumCache, 0o755);
    await rm(root, { recursive: true, force: true });
  }
});

test('lets Appium create its cache folder when it does not exist yet', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ios-testing-cache-'));
  try {
    assert.equal((await hostCheck('host.appium-cache', hostRunner(), root))?.state, 'ready');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('asks to accept the Xcode license before the app can build its test helper', async () => {
  const xcode = await hostCheck('host.xcode', hostRunner({
    'xcodebuild -license check': new Error("Command failed: xcodebuild -license check\nYou have not agreed to the Xcode license agreements. Please run 'sudo xcodebuild -license' from within a Terminal window to review and agree to the Xcode and Apple SDKs license."),
  }));
  assert.equal(xcode?.state, 'action');
  assert.match(xcode?.message ?? '', /license/i);
  assert.equal(xcode?.command, 'sudo xcodebuild -license');
});

async function deviceTunnelCheck(tunnels: Record<string, unknown>) {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () => new Response(JSON.stringify({ status: 'OK', tunnels }), { status: 200 })) as typeof fetch;
    const checks = await runSetupChecks(profile, runner({
      'xcode-select -p': '/Applications/Xcode.app/Contents/Developer',
      'xcodebuild -version': 'Xcode 27.0\nBuild version 27A266a',
      'xcodebuild -license check': '',
      [`xcrun devicectl device info details --device ${profile.udid} --timeout 15 --json-output - --omit-deprecated-fields-in-json`]: pairedDevice,
      [lockStateKey()]: unlockedDevice,
      [`xcrun devicectl device info apps --device ${profile.udid} --include-default-apps --bundle-id com.jadedpixel.pos --timeout 15 --json-output - --omit-deprecated-fields-in-json`]: posApps,
      'security find-identity -v -p codesigning': trustedIdentity,
    }), '/Users/tester/pos testing');
    return checks.find(check => check.id === 'device.remote-xpc');
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test('reports a running tunnel that has lost its connection to this iPad', async () => {
  const tunnel = await deviceTunnelCheck({ '00008120-0000000000000009': {} });
  assert.equal(tunnel?.state, 'action');
  assert.match(tunnel?.message ?? '', /no connection to this iPad/);
  assert.match(tunnel?.actions[0] ?? '', /Control\+C/);
  assert.match(tunnel?.command ?? '', /tunnel-creation\.mjs/);
});

test('accepts a tunnel that is connected to this iPad', async () => {
  assert.equal((await deviceTunnelCheck({ [profile.udid]: {} }))?.state, 'ready');
});

test('tells a run why the tunnel blocks it', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () => new Response(JSON.stringify({ status: 'OK', tunnels: {} }), { status: 200 })) as typeof fetch;
    assert.equal(await remoteXpcTunnelState(profile.udid), 'no-ipad');
    globalThis.fetch = (async () => new Response(JSON.stringify({ status: 'OK', tunnels: { [profile.udid.toLowerCase()]: {} } }), { status: 200 })) as typeof fetch;
    assert.equal(await remoteXpcTunnelState(profile.udid), 'connected');
    globalThis.fetch = (async () => { throw new Error('Connection refused'); }) as typeof fetch;
    assert.equal(await remoteXpcTunnelState(profile.udid), 'not-running');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
