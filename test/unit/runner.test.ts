import assert from 'node:assert/strict';
import { test } from 'node:test';

test('lets the WDIO service observe Appium startup', async () => {
  // Import only the runner configuration; this does not start Appium or a device.
  const previous = { ...process.env };
  try {
    Object.assign(process.env, {
      IOS_UDID: '00008103-0000000000000000',
      APPLE_TEAM_ID: 'ABCDE12345',
      WDA_BUNDLE_ID: 'co.example.iosTesting.WDARunner',
    });
    const { config } = await import('../../wdio.conf.ts');
    const service = config.services?.[0] as [string, { args: { address: string; logLevel: string } }];
    assert.equal(service[0], 'appium');
    assert.equal(service[1].args.address, '127.0.0.1');
    // Installed @wdio/appium-service waits for an INFO-level startup message.
    // 'error' suppresses it and times out the service readiness check.
    assert.equal(service[1].args.logLevel, 'info');
  } finally {
    for (const key of ['IOS_UDID', 'APPLE_TEAM_ID', 'WDA_BUNDLE_ID']) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});
