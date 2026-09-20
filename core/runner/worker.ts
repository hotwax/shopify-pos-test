import { resolve } from 'node:path';
import { loadCatalog } from '../catalog/load.ts';
import { getDeviceProfile } from '../storage/profiles.ts';
import { findAvailablePort, makeWorkerEnvironment, spawn } from './process.ts';
import type { WorkerFactory } from './coordinator.ts';
import { registry } from '../../test/scenarios/registry.ts';
import { readMutationReadiness } from '../safety/readiness.ts';
import { assertScenarioCanRun } from './guards.ts';
import { validateRunRequestAgainstCatalog } from '../catalog/validate.ts';

export function createWdioWorkerFactory(root: string): WorkerFactory {
  return async ({ runId, request, artifactDir, inputFile }) => {
    const profile = await getDeviceProfile(root, request.deviceProfileId);
    if (!profile) throw new Error('The selected device profile is not saved on this Mac.');
    const catalog = await loadCatalog(root);
    const script = catalog.scripts.find(candidate => candidate.id === request.scriptId);
    if (!script) throw new Error('The selected catalog script is unavailable.');
    validateRunRequestAgainstCatalog(request, catalog.scripts, registry);
    const scenario = registry.find(candidate => candidate.id === script.scenario);
    if (!scenario) throw new Error('The selected scenario is unavailable.');
    assertScenarioCanRun(scenario.effect, request, await readMutationReadiness(root));
    const appiumPort = await findAvailablePort(4723);
    const wdaLocalPort = await findAvailablePort(8101);
    const wdaDerivedDataPath = resolve(root, '.runtime', 'runs', runId, 'wda');
    const env = makeWorkerEnvironment(profile, runId, artifactDir, appiumPort, wdaLocalPort, wdaDerivedDataPath, root, inputFile);
    return spawn(resolve(root, 'node_modules/@wdio/cli/bin/wdio.js'), ['run', resolve(root, 'wdio.conf.ts')], {
      cwd: root,
      env: { ...env, WDIO_ENTRY: scenario.entry },
      cleanupMarkers: ['xcodebuild', wdaDerivedDataPath],
    });
  };
}
