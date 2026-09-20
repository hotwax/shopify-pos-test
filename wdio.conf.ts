import 'dotenv/config';
import { resolve } from 'node:path';
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
  services: [['appium', {
    args: { address: '127.0.0.1', port: 4723, logLevel: 'error' },
    logPath: './artifacts/appium',
  }]],
};
