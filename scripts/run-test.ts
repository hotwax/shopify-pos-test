import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import dotenv from 'dotenv';
import { loadCatalog } from '../core/catalog/load.ts';
import { createCoordinator } from '../core/runner/coordinator.ts';
import { findAvailablePort, makeWorkerEnvironment, spawn } from '../core/runner/process.ts';
import { isTerminalState } from '../core/runner/protocol.ts';
import { readDeviceConfig } from '../config/device.ts';
import { registry } from '../test/scenarios/registry.ts';
import { readMutationReadiness } from '../core/safety/readiness.ts';
import { assertScenarioCanRun, RunBlockedError } from '../core/runner/guards.ts';
import { readDeviceLockState } from '../core/setup/checks.ts';
import { validateRunRequestAgainstCatalog } from '../core/catalog/validate.ts';

const root = resolve(import.meta.dirname, '..');
dotenv.config({ quiet: true });
const idIndex = process.argv.indexOf('--id');
const scriptId = idIndex >= 0 ? process.argv[idIndex + 1] : 'pos.open-first-order';
if (!scriptId) throw new Error('Provide a catalog script ID with --id <id>.');

const catalog = await loadCatalog(root);
const script = catalog.scripts.find(candidate => candidate.id === scriptId);
if (!script) throw new Error(`Catalog script is unavailable: ${scriptId}`);
const request = {
  scriptId: script.id,
  deviceProfileId: 'cli-device',
  parameters: script.parameters,
  assertionMode: script.assertionMode,
  expectedRevision: 'pending',
} as const;
validateRunRequestAgainstCatalog(request, catalog.scripts, registry);
const scenario = registry.find(candidate => candidate.id === script.scenario);
if (!scenario) throw new Error(`Scenario is unavailable: ${script.scenario}`);
const device = readDeviceConfig(process.env);
assertScenarioCanRun(scenario.effect, { ...request, deviceProfileId: device.udid }, await readMutationReadiness(root));
const appiumPort = await findAvailablePort(4723);
const wdaLocalPort = await findAvailablePort(8101);
const revision = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const coordinator = createCoordinator({
  root,
  workerFactory: async ({ runId, request, artifactDir, inputFile }) => {
    const lockState = await readDeviceLockState(device.udid);
    if (lockState.passcodeRequired) {
      throw new RunBlockedError('device-locked', 'CoreDevice reports that the iPad is locked. Unlock it yourself and leave Shopify POS on Home; the toolkit did not change iPad access settings.');
    }
    const wdaDerivedDataPath = resolve(root, '.runtime', 'runs', runId, 'wda');
    const env = {
      ...makeWorkerEnvironment({ id: request.deviceProfileId, ...device }, runId, artifactDir, appiumPort, wdaLocalPort, wdaDerivedDataPath, root, inputFile),
      WDIO_ENTRY: scenario.entry,
    };
    return spawn(resolve(root, 'node_modules/@wdio/cli/bin/wdio.js'), ['run', resolve(root, 'wdio.conf.ts')], { cwd: root, env, cleanupMarkers: ['xcodebuild', wdaDerivedDataPath] });
  },
});

const accepted = await coordinator.startRun({
  scriptId: script.id,
  deviceProfileId: device.udid,
  parameters: script.parameters,
  assertionMode: script.assertionMode,
  expectedRevision: revision,
});
console.log(`Accepted run ${accepted.id} (${script.name}).`);

let current = accepted;
while (!isTerminalState(current.state)) {
  await new Promise(resolveDelay => setTimeout(resolveDelay, 250));
  current = await coordinator.getRun(accepted.id);
}
console.log(`Run ${current.id}: ${current.state}.`);
process.exitCode = current.state === 'passed' ? 0 : 1;
