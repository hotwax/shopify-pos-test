import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readDeviceConfig, buildCapabilities } from '../../config/device.ts';
import { assertNativeSessionPreservesAccess } from '../../core/safety/native-session.ts';

const valid = {
  IOS_UDID: '00008103-0000000000000000',
  APPLE_TEAM_ID: 'ABCDE12345',
  WDA_BUNDLE_ID: 'co.example.iosTesting.WDARunner',
};

for (const [key, values] of Object.entries({
  IOS_UDID: [undefined, '', ' ', 'auto', '-bad-', '1234'],
  APPLE_TEAM_ID: [undefined, '', 'abcde12345', 'ABCDE1234', 'ABCDE123456'],
  WDA_BUNDLE_ID: [undefined, '', 'runner', 'co..runner', 'co.example.*', 'co.example.runner;evil'],
})) {
  for (const value of values) {
    test(`rejects ${key}=${JSON.stringify(value)} before creating a session`, () => {
      assert.throws(() => readDeviceConfig({ ...valid, [key]: value }), new RegExp(key));
    });
  }
}

test('trims configuration and targets only the explicitly selected device', () => {
  assert.deepEqual(readDeviceConfig({ ...valid, IOS_UDID: ` ${valid.IOS_UDID} ` }), {
    udid: '00008103-0000000000000000', teamId: 'ABCDE12345',
    wdaBundleId: 'co.example.iosTesting.WDARunner',
  });
});

test('preserves the installed app, session and alert decisions', () => {
  const caps = buildCapabilities(readDeviceConfig(valid));
  assert.equal(caps.platformName, 'iOS');
  assert.equal(caps['appium:automationName'], 'XCUITest');
  assert.equal(caps['appium:udid'], '00008103-0000000000000000');
  assert.equal(caps['appium:bundleId'], 'com.jadedpixel.pos');
  assert.equal(caps['appium:noReset'], true);
  assert.equal(caps['appium:fullReset'], false);
  assert.equal(caps['appium:forceAppLaunch'], false);
  assert.equal(caps['appium:shouldTerminateApp'], false);
  assert.equal(caps['appium:autoAcceptAlerts'], false);
  assert.equal(caps['appium:autoDismissAlerts'], false);
  assert.equal(caps['appium:useNewWDA'], false);
  assert.equal(caps['appium:xcodeOrgId'], 'ABCDE12345');
  assert.equal(caps['appium:updatedWDABundleId'], 'co.example.iosTesting.WDARunner');
  assert.equal('appium:app' in caps, false);
});

test('rejects capability changes that could reset POS or replace the WDA session', () => {
  const caps = buildCapabilities(readDeviceConfig(valid)) as Record<string, unknown>;
  for (const key of ['appium:fullReset', 'appium:forceAppLaunch', 'appium:shouldTerminateApp', 'appium:autoAcceptAlerts', 'appium:autoDismissAlerts', 'appium:useNewWDA']) {
    assert.throws(() => assertNativeSessionPreservesAccess({ ...caps, [key]: true }), /safety invariant/);
  }
  assert.throws(() => assertNativeSessionPreservesAccess({ ...caps, 'appium:noReset': false }), /safety invariant/);
  assert.throws(() => assertNativeSessionPreservesAccess({ ...caps, 'appium:app': '/tmp/unknown.app' }), /safety invariant/);
});

test('captures the deep native POS order hierarchy', () => {
  const caps: Record<string, unknown> = buildCapabilities(readDeviceConfig(valid));
  assert.deepEqual(caps['appium:settings'], { snapshotMaxDepth: 62 });
});
