import { resolve } from 'node:path';
import { makeWdioConfig } from './core/runner/process.ts';
import { readDeviceConfig } from './config/device.ts';

// The CLI and GUI use the same config factory. Device values are read from the
// local worker environment only; they are never sent to the browser.
const device = readDeviceConfig(process.env);
const runId = process.env.WDIO_RUN_ID ?? `cli-${Date.now()}`;
const artifactDir = resolve(process.env.RUN_ARTIFACT_DIR ?? resolve('artifacts', runId));
const entry = process.env.WDIO_ENTRY ?? './test/specs/open-first-order.spec.ts';
const port = Number(process.env.APPIUM_PORT ?? '4723');
const wdaLocalPort = Number(process.env.WDA_LOCAL_PORT ?? '8100');
const wdaDerivedDataPath = resolve(process.env.WDA_DERIVED_DATA_PATH ?? '.wda/DerivedData');
if (!Number.isInteger(port) || port < 1024 || port > 65_535) throw new Error('APPIUM_PORT must be a valid local port.');
if (!Number.isInteger(wdaLocalPort) || wdaLocalPort < 1024 || wdaLocalPort > 65_535) throw new Error('WDA_LOCAL_PORT must be a valid local port.');

const sharedAppium = process.env.APPIUM_SHARED_SERVER === '1';
// Set by the worker factory for scenarios that change the cart or the store,
// so POS is left on Home with an empty cart whatever the spec's outcome.
const afterSpec = process.env.POS_RESET_AFTER_SPEC === '1'
  ? async () => { const { posReset } = await import('./test/screens/pos-reset.ts'); await posReset.clearCartAndReturnHome(); }
  : undefined;

export const config: WebdriverIO.Config = makeWdioConfig({ runId, device: { id: 'local', ...device }, entry, artifactDir, port, wdaLocalPort, wdaDerivedDataPath, sharedAppium, afterSpec });
