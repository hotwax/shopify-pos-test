import 'dotenv/config';
import { resolve } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { browser } from '@wdio/globals';
import { buildCapabilities, readDeviceConfig } from './config/device.ts';

// Validate before the Appium service starts; never auto-select another device.
const device = readDeviceConfig(process.env);

export const config: WebdriverIO.Config = {
  runner: 'local',
  hostname: '127.0.0.1',
  port: 4723,
  path: '/',
  specs: ['./test/specs/open-first-order.spec.ts'],
  maxInstances: 1,
  capabilities: [{ ...buildCapabilities(device), 'appium:derivedDataPath': resolve('.wda/DerivedData') }],
  framework: 'mocha',
  mochaOpts: { timeout: 120_000 },
  waitforTimeout: 20_000,
  connectionRetryTimeout: 240_000,
  connectionRetryCount: 0,
  specFileRetries: 0,
  logLevel: 'silent',
  reporters: ['spec'],
  afterTest: async function (_test, _context, { passed }) {
    if (passed) return;
    const directory = resolve('artifacts', `failure-${Date.now()}`);
    try {
      await mkdir(directory, { recursive: true });
    } catch {
      console.warn('Could not create the local failure evidence directory.');
      return;
    }
    // Capture independently: one unavailable channel must not hide the other
    // or replace the original test failure. Never print the source to stdout.
    for (const capture of [
      () => browser.saveScreenshot(resolve(directory, 'screen.png')),
      async () => writeFile(resolve(directory, 'source.xml'), await browser.getPageSource()),
    ]) {
      try { await capture(); }
      catch { console.warn('Could not capture one local failure artifact.'); }
    }
  },
  services: [['appium', {
    // The WDIO service detects readiness from Appium's INFO startup line.
    args: { address: '127.0.0.1', port: 4723, logLevel: 'info' },
    logPath: './artifacts/appium',
  }]],
};
