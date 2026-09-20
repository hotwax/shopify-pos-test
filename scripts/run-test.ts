import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import dotenv from 'dotenv';
import { loadCatalog } from '../core/catalog/load.ts';
import { createCoordinator } from '../core/runner/coordinator.ts';
import { findAvailablePort, makeWorkerEnvironment, spawn } from '../core/runner/process.ts';
import { isTerminalState } from '../core/runner/protocol.ts';
import { readDeviceConfig } from '../config/device.ts';
import { registry } from '../test/scenarios/registry.ts';

const root = resolve(import.meta.dirname, '..');
dotenv.config({ quiet: true });
const idIndex = process.argv.indexOf('--id');
const scriptId = idIndex >= 0 ? process.argv[idIndex + 1] : 'pos.open-first-order';
if (!scriptId) throw new Error('Provide a catalog script ID with --id <id>.');

const catalog = await loadCatalog(root);
const script = catalog.scripts.find(candidate => candidate.id === scriptId);
if (!script) throw new Error(`Catalog script is unavailable: ${scriptId}`);
const scenario = registry.find(candidate => candidate.id === script.scenario);
if (!scenario) throw new Error(`Scenario is unavailable: ${script.scenario}`);
const device = readDeviceConfig(process.env);
const appiumPort = await findAvailablePort(4723);
const wdaLocalPort = await findAvailablePort(8101);
const revision = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const coordinator = createCoordinator({
  root,
  workerFactory: async ({ runId, request, artifactDir }) => {
    const env = {
      ...makeWorkerEnvironment({ id: request.deviceProfileId, ...device }, runId, artifactDir, appiumPort, wdaLocalPort, resolve(root, '.wda/DerivedData')),
      WDIO_ENTRY: scenario.entry,
    };
    return spawn(resolve(root, 'node_modules/@wdio/cli/bin/wdio.js'), ['run', resolve(root, 'wdio.conf.ts')], { cwd: root, env });
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
