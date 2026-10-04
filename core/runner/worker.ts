import { resolve } from 'node:path';
import { loadCatalog } from '../catalog/load.ts';
import { getDeviceProfile } from '../storage/profiles.ts';
import { join } from 'node:path';
import { copyFileTail, findAvailablePort, makeWorkerEnvironment, spawn } from './process.ts';
import type { WorkerFactory } from './coordinator.ts';
import type { AppiumServerHost } from './appium-server.ts';
import { registry } from '../../test/scenarios/registry.ts';
import { assertScenarioCanRun, RunBlockedError } from './guards.ts';
import { validateRunRequestAgainstCatalog } from '../catalog/validate.ts';
import { readDeviceLockState, remoteXpcTunnelBlockedMessage, remoteXpcTunnelLostMessage, remoteXpcTunnelState, requiresRemoteXpc } from '../setup/checks.ts';

export interface WorkerFactoryOptions {
  /**
   * A host-owned Appium server. When present, workers attach to it instead of
   * booting their own, and the XCUITest driver reuses the WebDriverAgent left
   * running by the previous run instead of relaunching it on the iPad.
   */
  appiumServer?: AppiumServerHost;
}

export function createWdioWorkerFactory(root: string, options: WorkerFactoryOptions = {}): WorkerFactory {
  return async ({ runId, request, artifactDir, inputFile }) => {
    const profile = await getDeviceProfile(root, request.deviceProfileId);
    if (!profile) throw new Error('The selected device profile is not saved on this Mac.');
    const catalog = await loadCatalog(root);
    const script = catalog.scripts.find(candidate => candidate.id === request.scriptId);
    if (!script) throw new Error('The selected catalog script is unavailable.');
    validateRunRequestAgainstCatalog(request, catalog.scripts, registry);
    const scenario = registry.find(candidate => candidate.id === script.scenario);
    if (!scenario) throw new Error('The selected scenario is unavailable.');
    assertScenarioCanRun(scenario.effect, request);
    const lockState = await readDeviceLockState(profile.udid);
    if (lockState.passcodeRequired) {
      throw new RunBlockedError('device-locked', 'CoreDevice reports that the iPad is locked. Unlock it yourself and leave Shopify POS on Home; the toolkit did not change iPad access settings.');
    }
    if (await requiresRemoteXpc(profile.udid)) {
      const tunnel = await remoteXpcTunnelState(profile.udid);
      if (tunnel === 'no-ipad') throw new RunBlockedError('remote-xpc-tunnel-unavailable', remoteXpcTunnelLostMessage);
      if (tunnel === 'not-running') throw new RunBlockedError('remote-xpc-tunnel-unavailable', remoteXpcTunnelBlockedMessage);
    }
    const shared = options.appiumServer ? await options.appiumServer.ensureStarted() : undefined;
    const appiumPort = shared ? shared.port : await findAvailablePort(4723);
    // The WDA port must be the same run after run: the driver finds the
    // WebDriverAgent left running by the previous session by probing this port.
    const wdaLocalPort = await findAvailablePort(8101);
    // One reusable WebDriverAgent build. A per-run DerivedData directory forced
    // a full Xcode rebuild of WDA on every run (~130MB and minutes each time).
    // The CLI and the app must agree on the runner bundle id, or they overwrite
    // each other here and the loser needs re-trusting on the iPad.
    const wdaDerivedDataPath = resolve(root, '.runtime', 'wda');
    const logBaseOffset = shared ? await options.appiumServer!.logSize() : 0;
    const env = {
      ...makeWorkerEnvironment(profile, runId, artifactDir, appiumPort, wdaLocalPort, wdaDerivedDataPath, root, inputFile),
      WDIO_ENTRY: scenario.entry,
      // Mutation scenarios leave POS on Home with an empty cart when they end,
      // pass or fail. Read-only diagnostics deliberately leave their surface
      // open for the operator to inspect.
      POS_RESET_AFTER_SPEC: scenario.effect === 'read-only' ? '0' : '1',
      ...(shared ? { APPIUM_SHARED_SERVER: '1', APPIUM_LOG_FILE: shared.logPath, APPIUM_LOG_BASE_OFFSET: String(logBaseOffset) } : {}),
    };
    const owned = spawn(resolve(root, 'node_modules/@wdio/cli/bin/wdio.js'), ['run', resolve(root, 'wdio.conf.ts')], {
      cwd: root,
      env,
      // A stopped run must not take the shared WebDriverAgent down with it.
      cleanupMarkers: shared ? [] : ['xcodebuild', wdaDerivedDataPath],
    });
    if (!shared) return owned;
    return {
      ...owned,
      isAlive: () => owned.isAlive(),
      terminate: timeoutMs => owned.terminate(timeoutMs),
      async collectArtifacts() {
        await copyFileTail(shared.logPath, logBaseOffset, join(artifactDir, 'wdio-appium.log'));
      },
    };
  };
}
