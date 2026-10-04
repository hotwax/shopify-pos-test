import { execFile } from 'node:child_process';
import { X509Certificate } from 'node:crypto';
import { constants } from 'node:fs';
import { access, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { DeviceProfile, SetupCheck } from '../../shared/contracts.ts';

const execFileAsync = promisify(execFile);
export type CommandRunner = (file: string, args: string[]) => Promise<string>;
const developmentIdentityLine = /^\s*\d+\) [A-Fa-f0-9]{40} "(?:Apple Development|iPhone Developer):/m;
const certificatePattern = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g;
const wwdrName = 'Apple Worldwide Developer Relations Certification Authority';
const createCertificateAction = 'In Xcode → Settings → Apple Accounts → Manage Certificates, create Apple Development.';
const projectRoot = resolve(import.meta.dirname, '../..');

export const minimumXcodeMajor = 27;
const updateXcodeAction = `Update Xcode to version ${minimumXcodeMajor} or later from the Mac App Store, open it once, then run the checks again.`;

export function tunnelCommand(root = projectRoot): string {
  return `sudo env "PATH=$PATH" node "${join(root, 'node_modules', 'appium-xcuitest-driver', 'scripts', 'tunnel-creation.mjs')}"`;
}

const command: CommandRunner = async (file, args) => {
  const result = await execFileAsync(file, args, { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
  return result.stdout;
};

async function devicectl(run: CommandRunner, args: string[]): Promise<string> {
  try {
    return await run('xcrun', ['devicectl', ...args]);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unknown option')) throw new Error(`This Xcode is too old for this toolkit. ${updateXcodeAction}`);
    throw error;
  }
}

function check(id: string, state: SetupCheck['state'], message: string, actions: string[] = [], help: Pick<SetupCheck, 'command' | 'link'> = {}): SetupCheck {
  return { id, state, message, actions, ...help, checkedAt: new Date().toISOString() };
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

export type RemoteXpcTunnelState = 'connected' | 'no-ipad' | 'not-running';

export const remoteXpcTunnelBlockedMessage = `The iOS RemoteXPC tunnel is not running. Start it from a separate Terminal with \`${tunnelCommand()}\`, then start a fresh native run. The toolkit did not change iPad access settings.`;
export const remoteXpcTunnelLostMessage = `The iOS RemoteXPC tunnel is running, but it has no connection to this iPad. In the Terminal that runs it, press Control+C, then start it again with \`${tunnelCommand()}\` while the iPad is connected and unlocked. The toolkit did not change iPad access settings.`;

async function readRemoteXpcTunnelUdids(): Promise<string[] | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 750);
  try {
    const response = await fetch('http://127.0.0.1:42314/remotexpc/tunnels', { signal: controller.signal });
    if (!response.ok) return null;
    const body = await response.json() as { status?: unknown; tunnels?: Record<string, unknown> };
    return body.status === 'OK' ? Object.keys(body.tunnels ?? {}) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function probeRemoteXpcTunnel(): Promise<boolean> {
  return (await readRemoteXpcTunnelUdids()) !== null;
}

export async function remoteXpcTunnelState(udid: string): Promise<RemoteXpcTunnelState> {
  const udids = await readRemoteXpcTunnelUdids();
  if (udids === null) return 'not-running';
  return udids.some(known => known.toLowerCase() === udid.toLowerCase()) ? 'connected' : 'no-ipad';
}

export async function requiresRemoteXpc(udid: string, run: CommandRunner = command): Promise<boolean> {
  const output = await devicectl(run, ['device', 'info', 'details', '--device', udid, '--timeout', '15', '--json-output', '-', '--omit-deprecated-fields-in-json']);
  const parsed = jsonResult(output);
  const device = parsed.result ?? parsed;
  const os = displayValue(deviceProperties(device).software.osVersionNumber);
  const major = versionMajor(os);
  return major !== null && major >= 18;
}

export async function readDeviceLockState(udid: string, run: CommandRunner = command): Promise<DeviceLockState> {
  const output = await devicectl(run, ['device', 'info', 'lockState', '--device', udid, '--timeout', '15', '--quiet', '--json-output', '-', '--omit-deprecated-fields-in-json']);
  const parsed = jsonResult(output);
  const result = parsed.result ?? parsed;
  if (typeof result?.passcodeRequired !== 'boolean' || typeof result?.unlockedSinceBoot !== 'boolean') {
    throw new Error('CoreDevice returned an incomplete iPad lock-state response.');
  }
  return { passcodeRequired: result.passcodeRequired, unlockedSinceBoot: result.unlockedSinceBoot };
}

export async function listDevices(run: CommandRunner = command): Promise<{ udid: string; name: string; model: string; os: string }[]> {
  const output = await devicectl(run, ['list', 'devices', '--json-output', '-', '--omit-deprecated-fields-in-json']);
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

export async function listDevelopmentTeamIds(run: CommandRunner = command): Promise<string[]> {
  const teams = new Set<string>();
  try {
    const xcodeOutput = await run('defaults', ['read', 'com.apple.dt.Xcode', 'IDEProvisioningTeamByIdentifier']);
    for (const match of xcodeOutput.matchAll(/teamID\s*=\s*([A-Z0-9]{10})/g)) {
      teams.add(match[1]);
    }
  } catch {}
  try {
    const signingHashes = new Set((await run('security', ['find-identity', '-v', '-p', 'codesigning'])).match(/\b[A-F0-9]{40}\b/gi)?.map(hash => hash.toUpperCase()));
    for (const certificate of certificates(await run('security', ['find-certificate', '-a', '-c', 'Apple Development', '-p']))) {
      const team = nameField(certificate.subject, 'OU');
      if (team && signingHashes.has(certificate.fingerprint.replaceAll(':', ''))) teams.add(team);
    }
  } catch {}
  return [...teams];
}

function checkNode(): SetupCheck {
  const [nodeMajor, nodeMinor] = process.versions.node.split('.').map(Number);
  const nodeReady = (nodeMajor === 20 && nodeMinor >= 19) || (nodeMajor === 22 && nodeMinor >= 12) || nodeMajor >= 24;
  return check('host.node', nodeReady ? 'ready' : 'blocked', nodeReady ? `Node ${process.versions.node} is supported.` : 'Node 20.19+, 22.12+ or 24+ is required.', nodeReady ? [] : ['Install the supported Node.js version.']);
}

async function xcodeLicenseAccepted(run: CommandRunner): Promise<boolean> {
  try {
    await run('xcodebuild', ['-license', 'check']);
    return true;
  } catch (error) {
    if (error instanceof Error && /not agreed to the Xcode license/i.test(error.message)) return false;
    throw error;
  }
}

async function checkXcode(run: CommandRunner): Promise<SetupCheck> {
  try {
    const path = (await run('xcode-select', ['-p'])).trim();
    if (!path.endsWith('/Contents/Developer')) return check('host.xcode', 'action', 'Command Line Tools are selected instead of full Xcode.', ['Open Xcode → Settings → Locations and select full Xcode.']);
    const version = (await run('xcodebuild', ['-version'])).trim();
    const release = version.match(/^Xcode (\d+)[\d.]*/m);
    if (!release) return check('host.xcode', 'blocked', 'Full Xcode did not report a usable version.', ['Launch Xcode once and select it under Locations.']);
    if (Number(release[1]) < minimumXcodeMajor) return check('host.xcode', 'action', `${release[0]} is too old. This toolkit needs Xcode ${minimumXcodeMajor} or later.`, [updateXcodeAction]);
    if (!await xcodeLicenseAccepted(run)) {
      return check(
        'host.xcode',
        'action',
        `${release[0]} is installed, but its license has not been accepted. Xcode cannot build the test helper until it is.`,
        ['Open Xcode once and click Agree. Or run this command in Terminal and type "agree" at the end. Then run the checks again.'],
        { command: 'sudo xcodebuild -license' },
      );
    }
    return check('host.xcode', 'ready', version.replaceAll('\n', ' '));
  } catch (error) {
    return check('host.xcode', 'blocked', `Xcode could not be checked: ${error instanceof Error ? error.message : String(error)}`, ['Install full Xcode and its command-line tools.']);
  }
}

function certificates(pem: string): X509Certificate[] {
  return (pem.match(certificatePattern) ?? []).map(text => new X509Certificate(text));
}

function nameField(name: string, field: string): string | undefined {
  return name.split('\n').find(line => line.startsWith(`${field}=`))?.slice(field.length + 1);
}

function isCurrent(certificate: X509Certificate): boolean {
  const now = Date.now();
  return Date.parse(certificate.validFrom) <= now && now <= Date.parse(certificate.validTo);
}

function issuerDownloadLink(issuerName: string, generation: string | undefined): string {
  return issuerName === wwdrName && generation && /^G\d+$/.test(generation)
    ? `https://www.apple.com/certificateauthority/AppleWWDRCA${generation}.cer`
    : 'https://www.apple.com/certificateauthority/';
}

function importCertificateCommand(link: string): string | undefined {
  if (!link.endsWith('.cer')) return undefined;
  return `f="$(mktemp -d)/${link.split('/').pop()}" && curl -fsSL ${link} -o "$f" && security import "$f" -t cert -k ~/Library/Keychains/login.keychain-db`;
}

async function findMissingIssuer(run: CommandRunner): Promise<{ name: string; link: string } | undefined> {
  const developmentCertificates = certificates(await run('security', ['find-certificate', '-a', '-c', 'Apple Development', '-p'])).filter(isCurrent);
  for (const certificate of developmentCertificates) {
    const issuerName = nameField(certificate.issuer, 'CN');
    if (!issuerName) continue;
    const installedIssuers = certificates(await run('security', ['find-certificate', '-a', '-c', issuerName, '-p']));
    if (installedIssuers.some(issuer => isCurrent(issuer) && certificate.checkIssued(issuer))) continue;
    const generation = nameField(certificate.issuer, 'OU');
    return { name: generation ? `${issuerName} (${generation})` : issuerName, link: issuerDownloadLink(issuerName, generation) };
  }
  return undefined;
}

async function checkSigningIdentity(run: CommandRunner): Promise<SetupCheck> {
  try {
    if (developmentIdentityLine.test(await run('security', ['find-identity', '-v', '-p', 'codesigning']))) {
      return check('signing.identity', 'ready', 'A valid Apple development identity is available in Keychain.');
    }
    if (!developmentIdentityLine.test(await run('security', ['find-identity', '-p', 'codesigning']))) {
      return check('signing.identity', 'action', 'Keychain has no Apple Development certificate with its private key.', [createCertificateAction]);
    }
    const missingIssuer = await findMissingIssuer(run);
    if (missingIssuer) {
      const command = importCertificateCommand(missingIssuer.link);
      return check(
        'signing.identity',
        'action',
        `Your Apple Development certificate is installed, but macOS cannot trust it. Apple's intermediate certificate "${missingIssuer.name}" is missing from Keychain.`,
        [command
          ? 'Run this command in Terminal. It downloads the certificate from Apple and adds it to your login keychain. Then run the checks again.'
          : 'Download the certificate from Apple. In Keychain Access, select the "login" keychain, then use File → Import Items. Then run the checks again.'],
        { link: missingIssuer.link, ...(command ? { command } : {}) },
      );
    }
    return check('signing.identity', 'action', 'Your Apple Development certificate is installed, but macOS does not trust it. It may be expired or revoked.', [createCertificateAction]);
  } catch (error) {
    return check('signing.identity', 'action', `Signing identities could not be checked: ${error instanceof Error ? error.message : String(error)}`, ['Open Xcode and create an Apple Development certificate.']);
  }
}

async function checkAppiumCache(root: string): Promise<SetupCheck> {
  const cache = join(root, 'node_modules', '.cache');
  const appiumCache = join(cache, 'appium');
  const entries = await readdir(appiumCache).catch(() => []);
  const paths = [cache, appiumCache, ...entries.map(name => join(appiumCache, name))];
  const writable = await Promise.all(paths.map(path => access(path, constants.W_OK).then(() => true, (error: NodeJS.ErrnoException) => error.code === 'ENOENT')));
  if (writable.every(Boolean)) return check('host.appium-cache', 'ready', 'Appium can write its cache folder.');
  return check(
    'host.appium-cache',
    'action',
    'Appium cannot write its cache folder because another user owns it, usually root. Every test run fails until this is fixed.',
    ['Run this command in Terminal and enter your Mac password, then run the checks again.'],
    { command: `sudo chown -R "$USER" "${cache}"` },
  );
}

export async function runSetupChecks(profile: DeviceProfile, run: CommandRunner = command, root = projectRoot): Promise<SetupCheck[]> {
  const checks: SetupCheck[] = [checkNode(), await checkXcode(run)];

  let device: Record<string, any> | undefined;
  try {
    const output = await devicectl(run, ['device', 'info', 'details', '--device', profile.udid, '--timeout', '15', '--json-output', '-', '--omit-deprecated-fields-in-json']);
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
      const tunnel = await remoteXpcTunnelState(profile.udid);
      if (tunnel === 'connected') {
        checks.push(check('device.remote-xpc', 'ready', 'The RemoteXPC tunnel is connected to this iPad.'));
      } else if (tunnel === 'no-ipad') {
        checks.push(check(
          'device.remote-xpc',
          'action',
          'The RemoteXPC tunnel is running, but it has no connection to this iPad. This happens when the iPad was unplugged, restarted or locked after the tunnel started.',
          ['In the Terminal that runs the tunnel, press Control+C. With the iPad connected and unlocked, run this command again, then run setup checks again.'],
          { command: tunnelCommand(root) },
        ));
      } else {
        checks.push(check(
          'device.remote-xpc',
          'action',
          'The Appium RemoteXPC tunnel registry is not available for this iOS 18+ device.',
          ['In a separate Terminal, run this command, complete the Mac authorization if prompted, leave it running, then run setup checks again.'],
          { command: tunnelCommand(root) },
        ));
      }
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
    const output = await devicectl(run, ['device', 'info', 'apps', '--device', profile.udid, '--include-default-apps', '--bundle-id', 'com.jadedpixel.pos', '--timeout', '15', '--json-output', '-', '--omit-deprecated-fields-in-json']);
    const apps = (jsonResult(output).result?.apps ?? []) as { bundleIdentifier?: string; version?: string; bundleVersion?: string }[];
    const pos = apps.find(app => app.bundleIdentifier === 'com.jadedpixel.pos');
    checks.push(check('pos.installed', pos ? 'ready' : 'action', pos ? `Shopify POS ${pos.version ?? 'unknown'} (${pos.bundleVersion ?? 'unknown'}) is installed.` : 'Shopify POS is not installed on the selected iPad.', pos ? [] : ['Install Shopify POS from the App Store and sign in to a test store yourself.']));
  } catch (error) {
    checks.push(check('pos.installed', 'action', `Shopify POS could not be checked: ${error instanceof Error ? error.message : String(error)}`, ['Reconnect the selected iPad and install Shopify POS yourself.']));
  }

  checks.push(await checkSigningIdentity(run), await checkAppiumCache(root));

  const hostReady = checks.every(item => ['host.node', 'host.xcode', 'device.pairing', 'device.developer', 'device.os', 'device.unlocked', 'pos.installed', 'signing.identity', 'host.appium-cache'].includes(item.id) ? item.state === 'ready' : true);
  checks.push(check('wda.session', 'action', hostReady ? 'A live WDA/Appium session has not been verified in this setup run.' : 'WDA is blocked until host and device prerequisites pass.', ['If Apple asks for a password, trust or UI Automation action, complete it yourself. The toolkit will not change those settings.']));
  checks.push(check('pos.home', 'action', 'Shopify POS Home has not been verified by a live native accessibility query.', ['Open Shopify POS yourself on Home, dismiss dialogs and keep the iPad unlocked before running.']));
  return checks;
}

export async function prepareWda(_profile: DeviceProfile): Promise<void> {
  throw new Error('WDA preparation requires Apple-owned signing/trust prompts. Complete those prompts in Xcode yourself, then rerun the read-only setup checks.');
}

export async function runHostChecks(run: CommandRunner = command, root = projectRoot): Promise<SetupCheck[]> {
  const checks = [checkNode(), await checkXcode(run), await checkSigningIdentity(run), await checkAppiumCache(root)];
  const tunnelReady = await probeRemoteXpcTunnel();
  checks.push(check(
    'host.remote-xpc',
    tunnelReady ? 'ready' : 'action',
    tunnelReady ? 'The Appium RemoteXPC tunnel registry is running.' : 'The Appium RemoteXPC tunnel registry is not running on port 42314.',
    tunnelReady ? [] : ['In a separate Terminal, run this command, complete the Mac authorization if prompted, and leave it running.'],
    tunnelReady ? {} : { command: tunnelCommand(root) },
  ));
  return checks;
}
