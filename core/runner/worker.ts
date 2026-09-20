import { resolve } from 'node:path';
import { loadCatalog } from '../catalog/load.ts';
import { getDeviceProfile } from '../storage/profiles.ts';
import { findAvailablePort, makeWorkerEnvironment, spawn } from './process.ts';
import type { WorkerFactory } from './coordinator.ts';
import { registry } from '../../test/scenarios/registry.ts';

export function createWdioWorkerFactory(root: string): WorkerFactory {
  return async ({ runId, request, artifactDir }) => {
    const profile = await getDeviceProfile(root, request.deviceProfileId);
    if (!profile) throw new Error('The selected device profile is not saved on this Mac.');
    const catalog = await loadCatalog(root);
    const script = catalog.scripts.find(candidate => candidate.id === request.scriptId);
    if (!script) throw new Error('The selected catalog script is unavailable.');
    const scenario = registry.find(candidate => candidate.id === script.scenario);
    if (!scenario) throw new Error('The selected scenario is unavailable.');
    const appiumPort = await findAvailablePort(4723);
    const wdaLocalPort = await findAvailablePort(8101);
    const env = makeWorkerEnvironment(profile, runId, artifactDir, appiumPort, wdaLocalPort, resolve(root, '.wda/DerivedData'));
    return spawn(resolve(root, 'node_modules/@wdio/cli/bin/wdio.js'), ['run', resolve(root, 'wdio.conf.ts')], {
      cwd: root,
      env: { ...env, WDIO_ENTRY: scenario.entry },
    });
  };
}
