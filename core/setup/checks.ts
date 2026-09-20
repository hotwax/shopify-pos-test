import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { DeviceProfile, SetupCheck } from '../../shared/contracts.ts';

const execFileAsync = promisify(execFile);
export type CommandRunner = (file: string, args: string[]) => Promise<string>;

const command: CommandRunner = async (file, args) => {
  const result = await execFileAsync(file, args, { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
  return result.stdout;
};

function check(id: string, state: SetupCheck['state'], message: string, actions: string[] = []): SetupCheck {
  return { id, state, message, actions, checkedAt: new Date().toISOString() };
}

function jsonResult(value: string): Record<string, any> {
  return JSON.parse(value) as Record<string, any>;
}

function displayValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value && typeof value === 'object' && 'stringValue' in value) return String((value as { stringValue?: unknown }).stringValue ?? '');
  return '';
}

function deviceProperties(device: Record<string, any>): { hardware: Record<string, any>; connection: Record<string, any>; software: Record<string, any> } {
  const properties = device.properties ?? {};
  const state = device.state ?? properties.state ?? {};
  const software = device.deviceProperties ?? properties.deviceProperties ?? properties.software ?? {};
  return {
    hardware: device.hardwareProperties ?? properties.hardwareProperties ?? properties.hardware ?? {},
    connection: device.connectionProperties ?? properties.connectionProperties ?? properties.connection ?? {},
    software: { ...software, developerModeStatus: software.developerModeStatus ?? state.developerModeStatus },
  };
}

function versionMajor(version: string | undefined): number | null {
  const major = Number.parseInt(version?.split('.')[0] ?? '', 10);
  return Number.isFinite(major) ? major : null;
}

export interface DeviceLockState {
  passcodeRequired: boolean;
  unlockedSinceBoot: boolean;
}

export type RemoteXpcTunnelProbe = () => Promise<boolean>;

export const remoteXpcTunnelBlockedMessage = 'The iOS RemoteXPC tunnel is not running. Start it from a separate Terminal with `sudo appium driver run xcuitest tunnel-creation`, then start a fresh native run. The toolkit did not change iPad access settings.';

/**
 * Read-only check for Appium's RemoteXPC tunnel registry. The registry is a
 * host-side service; probing it never starts a tunnel, changes the iPad, or
 * prompts for a password.
 */
export const probeRemoteXpcTunnel: RemoteXpcTunnelProbe = async () => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 750);
  try {
    const response = await fetch('http://127.0.0.1:42314/remotexpc/tunnels', { signal: controller.signal });
    if (!response.ok) return false;
    const body = await response.json() as { status?: unknown };
    return body.status === 'OK';
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
};

/** Read-only OS-version classification used to decide whether RemoteXPC is required. */
export async function requiresRemoteXpc(udid: string, run: CommandRunner = command): Promise<boolean> {
  const output = await run('xcrun', ['devicectl', 'device', 'info', 'details', '--device', udid, '--timeout', '15', '--json-output', '-', '--omit-deprecated-fields-in-json']);
  const parsed = jsonResult(output);
  const device = parsed.result ?? parsed;
  const os = displayValue(deviceProperties(device).software.osVersionNumber);
  const major = versionMajor(os);
  return major !== null && major >= 18;
}

/** Read-only CoreDevice preflight. This command never unlocks or changes the iPad. */
export async function readDeviceLockState(udid: string, run: CommandRunner = command): Promise<DeviceLockState> {
  const output = await run('xcrun', ['devicectl', 'device', 'info', 'lockState', '--device', udid, '--timeout', '15', '--quiet', '--json-output', '-', '--omit-deprecated-fields-in-json']);
  const parsed = jsonResult(output);
  const result = parsed.result ?? parsed;
  if (typeof result?.passcodeRequired !== 'boolean' || typeof result?.unlockedSinceBoot !== 'boolean') {
    throw new Error('CoreDevice returned an incomplete iPad lock-state response.');
  }
  return { passcodeRequired: result.passcodeRequired, unlockedSinceBoot: result.unlockedSinceBoot };
}

export async function listDevices(run: CommandRunner = command): Promise<{ udid: string; name: string; model: string; os: string }[]> {
  const output = await run('xcrun', ['devicectl', 'list', 'devices', '--json-output', '-', '--omit-deprecated-fields-in-json']);
  const result = jsonResult(output).result ?? jsonResult(output);
  const devices = Array.isArray(result.devices) ? result.devices : [];
  return devices.map((device: Record<string, any>) => {
    const properties = device.properties ?? {};
    const hardware = device.hardwareProperties ?? properties.hardwareProperties ?? properties.hardware ?? {};
    const software = device.deviceProperties ?? properties.deviceProperties ?? properties.software ?? {};
    return {
      udid: String(hardware.udid ?? device.identifier ?? ''),
      name: String(hardware.marketingName ?? properties.name ?? device.name ?? 'Unknown iPad'),
      model: String(hardware.deviceType ?? properties.platform ?? 'Unknown'),
      os: displayValue(software.osVersionNumber ?? properties.osVersionNumber) || 'Unknown',
    };
  }).filter((device: { udid: string; model: string }) => device.udid && device.model.toLowerCase().includes('ipad'));
}

export async function runSetupChecks(profile: DeviceProfile, run: CommandRunner = command): Promise<SetupCheck[]> {
  const checks: SetupCheck[] = [];
  const [nodeMajor, nodeMinor] = process.versions.node.split('.').map(Number);
  const nodeReady = (nodeMajor === 20 && nodeMinor >= 19) || (nodeMajor === 22 && nodeMinor >= 12) || nodeMajor >= 24;
  checks.push(check('host.node', nodeReady ? 'ready' : 'blocked', nodeReady ? `Node ${process.versions.node} is supported.` : 'Node 20.19+, 22.12+ or 24+ is required.', nodeReady ? [] : ['Install the supported Node.js version.']));

  let xcodeReady = false;
  try {
    const path = (await run('xcode-select', ['-p'])).trim();
    if (!path.endsWith('/Contents/Developer')) {
      checks.push(check('host.xcode', 'action', 'Command Line Tools are selected instead of full Xcode.', ['Open Xcode → Settings → Locations and select full Xcode.']));
    } else {
      const version = await run('xcodebuild', ['-version']);
      xcodeReady = /^Xcode \d+/m.test(version);
      checks.push(check('host.xcode', xcodeReady ? 'ready' : 'blocked', xcodeReady ? version.trim().replaceAll('\n', ' ') : 'Full Xcode did not report a usable version.', xcodeReady ? [] : ['Launch Xcode once and select it under Locations.']));
    }
  } catch (error) {
    checks.push(check('host.xcode', 'blocked', `Xcode could not be checked: ${error instanceof Error ? error.message : String(error)}`, ['Install full Xcode and its command-line tools.']));
  }

  let device: Record<string, any> | undefined;
  try {
    const output = await run('xcrun', ['devicectl', 'device', 'info', 'details', '--device', profile.udid, '--timeout', '15', '--json-output', '-', '--omit-deprecated-fields-in-json']);
    const parsed = jsonResult(output);
    device = parsed.result ?? parsed;
    if (!device) throw new Error('Core Device returned no device details.');
    const properties = deviceProperties(device);
    const pairingReady = properties.connection.pairingState === 'paired';
    checks.push(check('device.pairing', pairingReady ? 'ready' : 'action', pairingReady ? 'The iPad is paired with this Mac.' : 'The iPad is not paired and trusted with this Mac.', pairingReady ? [] : ['Unlock the iPad and trust this Mac.']));
    const developerStatus = properties.software.developerModeStatus;
    const developerReady = developerStatus && typeof developerStatus === 'object'
      ? Boolean((developerStatus as { enabled?: unknown }).enabled)
      : String(developerStatus).toLowerCase() === 'enabled' || String(developerStatus).toLowerCase() === 'true';
    checks.push(check('device.developer', developerReady ? 'ready' : 'action', developerReady ? 'Developer Mode is enabled.' : 'Developer Mode is not enabled.', developerReady ? [] : ['Enable Developer Mode on the iPad yourself, then restart it if Apple requests.']));
    const os = displayValue(properties.software.osVersionNumber);
    const major = versionMajor(os);
    const osReady = major !== null && major >= 17 && major <= 27;
    checks.push(check('device.os', osReady ? 'ready' : 'unsupported', osReady ? `iPadOS ${os} is in the supported baseline.` : `iPadOS ${os || 'unknown'} is outside the supported baseline.`, osReady ? [] : ['Use a supported iPadOS version or update the compatibility matrix.']));

    if (osReady && major !== null && major >= 18) {
      const tunnelReady = await probeRemoteXpcTunnel();
      checks.push(check(
        'device.remote-xpc',
        tunnelReady ? 'ready' : 'action',
        tunnelReady ? 'The Appium RemoteXPC tunnel registry is available.' : 'The Appium RemoteXPC tunnel registry is not available for this iOS 18+ device.',
        tunnelReady ? [] : ['In a separate Terminal, run `sudo appium driver run xcuitest tunnel-creation`, complete the Mac authorization if prompted, leave it running, then run setup checks again.'],
      ));
    } else if (osReady) {
      checks.push(check('device.remote-xpc', 'ready', 'This iPadOS version uses the legacy device transport; a RemoteXPC tunnel is not required.'));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    checks.push(check('device.pairing', 'action', `The selected iPad could not be read: ${message}`, ['Connect, unlock and trust the selected iPad.']));
    checks.push(check('device.developer', 'blocked', 'Developer Mode could not be verified.', ['Complete the Apple-owned device setup before continuing.']));
    checks.push(check('device.os', 'blocked', 'iPadOS could not be verified.', ['Reconnect the selected iPad and run setup checks again.']));
    checks.push(check('device.remote-xpc', 'blocked', 'The device transport could not be classified.', ['Reconnect the selected iPad and run setup checks again.']));
  }

  try {
    const lockState = await readDeviceLockState(profile.udid, run);
    const unlocked = !lockState.passcodeRequired;
    checks.push(check('device.unlocked', unlocked ? 'ready' : 'action', unlocked ? 'CoreDevice reports that the iPad is unlocked for automation.' : 'CoreDevice reports that the iPad is locked and requires its passcode.', unlocked ? [] : ['Unlock the iPad yourself and leave it awake before starting a native test.']));
  } catch (error) {
    checks.push(check('device.unlocked', 'action', `The iPad lock state could not be verified: ${error instanceof Error ? error.message : String(error)}`, ['Reconnect and unlock the selected iPad, then run setup checks again.']));
  }

  try {
    const output = await run('xcrun', ['devicectl', 'device', 'info', 'apps', '--device', profile.udid, '--include-default-apps', '--bundle-id', 'com.jadedpixel.pos', '--timeout', '15', '--json-output', '-', '--omit-deprecated-fields-in-json']);
    const apps = (jsonResult(output).result?.apps ?? []) as { bundleIdentifier?: string; version?: string; bundleVersion?: string }[];
    const pos = apps.find(app => app.bundleIdentifier === 'com.jadedpixel.pos');
    checks.push(check('pos.installed', pos ? 'ready' : 'action', pos ? `Shopify POS ${pos.version ?? 'unknown'} (${pos.bundleVersion ?? 'unknown'}) is installed.` : 'Shopify POS is not installed on the selected iPad.', pos ? [] : ['Install Shopify POS from the App Store and sign in to a test store yourself.']));
  } catch (error) {
    checks.push(check('pos.installed', 'action', `Shopify POS could not be checked: ${error instanceof Error ? error.message : String(error)}`, ['Reconnect the selected iPad and install Shopify POS yourself.']));
  }

  try {
    const identities = await run('security', ['find-identity', '-v', '-p', 'codesigning']);
    const ready = /^\s*\d+\) [A-Fa-f0-9]{40} "(?:Apple Development|iPhone Developer):/m.test(identities);
    checks.push(check('signing.identity', ready ? 'ready' : 'action', ready ? 'A valid Apple development identity is available.' : 'No valid Apple development identity is available.', ready ? [] : ['In Xcode → Settings → Apple Accounts → Manage Certificates, create Apple Development.']));
  } catch (error) {
    checks.push(check('signing.identity', 'action', `Signing identities could not be checked: ${error instanceof Error ? error.message : String(error)}`, ['Open Xcode and create an Apple Development certificate.']));
  }

  const hostReady = xcodeReady && checks.every(item => ['host.node', 'host.xcode', 'device.pairing', 'device.developer', 'device.os', 'device.unlocked', 'pos.installed', 'signing.identity'].includes(item.id) ? item.state === 'ready' : true);
  checks.push(check('wda.session', 'action', hostReady ? 'A live WDA/Appium session has not been verified in this setup run.' : 'WDA is blocked until host and device prerequisites pass.', ['If Apple asks for a password, trust or UI Automation action, complete it yourself. The toolkit will not change those settings.']));
  checks.push(check('pos.home', 'action', 'Shopify POS Home has not been verified by a live native accessibility query.', ['Open Shopify POS yourself on Home, dismiss dialogs and keep the iPad unlocked before running.']));
  return checks;
}

export async function prepareWda(_profile: DeviceProfile): Promise<void> {
  throw new Error('WDA preparation requires Apple-owned signing/trust prompts. Complete those prompts in Xcode yourself, then rerun the read-only setup checks.');
}
