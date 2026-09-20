import 'dotenv/config';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readDeviceConfig } from '../config/device.ts';

const run = promisify(execFile);
async function command(file: string, args: string[]): Promise<string> {
  const { stdout } = await run(file, args, { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
  return stdout;
}

async function main() {
  if (process.platform !== 'darwin') throw new Error('A Mac with Xcode is required.');
  const config = readDeviceConfig(process.env);
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (!((major === 20 && minor >= 19) || (major === 22 && minor >= 12) || major >= 24)) {
    throw new Error('Node version is unsupported; see package.json engines.');
  }
  console.log(`PASS Node ${process.versions.node}; explicit device/signing configuration`);
  const xcodePath = (await command('xcode-select', ['-p'])).trim();
  if (!xcodePath.endsWith('/Contents/Developer')) throw new Error('Select full Xcode, not Command Line Tools, in Xcode Settings → Locations.');
  console.log(`PASS ${(await command('xcodebuild', ['-version'])).trim().replaceAll('\n', ' ')}`);

  const scratch = await mkdtemp(join(tmpdir(), 'ios-testing-doctor-'));
  try {
    const details = join(scratch, 'device.json');
    await command('xcrun', ['devicectl', 'device', 'info', 'details', '--device', config.udid, '--timeout', '15', '--json-output', details]);
    const device = JSON.parse(await readFile(details, 'utf8')).result;
    if (device?.hardwareProperties?.udid !== config.udid || device?.hardwareProperties?.deviceType !== 'iPad') {
      throw new Error('IOS_UDID did not resolve to the intended physical iPad.');
    }
    if (device.connectionProperties?.pairingState !== 'paired') throw new Error('Unlock the iPad and Trust this Mac.');
    if (device.deviceProperties?.developerModeStatus !== 'enabled') throw new Error('Enable Developer Mode on the iPad and complete its restart/confirmation.');
    console.log(`PASS paired iPad, Developer Mode enabled, iPadOS ${device.deviceProperties.osVersionNumber}`);

    const appsFile = join(scratch, 'apps.json');
    await command('xcrun', ['devicectl', 'device', 'info', 'apps', '--device', config.udid, '--include-default-apps', '--bundle-id', 'com.jadedpixel.pos', '--timeout', '15', '--json-output', appsFile]);
    const apps = JSON.parse(await readFile(appsFile, 'utf8')).result?.apps;
    const pos = apps?.find((app: { bundleIdentifier: string }) => app.bundleIdentifier === 'com.jadedpixel.pos');
    if (!pos) throw new Error('Shopify POS is not installed on the selected iPad. Install it from the App Store.');
    console.log(`PASS Shopify POS ${pos.version} (${pos.bundleVersion}) installed`);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
  const identities = await command('security', ['find-identity', '-v', '-p', 'codesigning']);
  if (!/^\s*\d+\) [A-Fa-f0-9]{40} "(?:Apple Development|iPhone Developer):/m.test(identities)) {
    throw new Error('No valid development signing identity. In Xcode → Settings → Apple Accounts → Manage Certificates, create Apple Development. If it exists but is invalid, check its certificate chain in Keychain Access; see README.');
  }
  console.log('PASS valid development signing identity available');
  console.log('Prerequisites checked. WDA provisioning, device trust/UI Automation and POS Home still require a live session.');
}

main().catch((error: unknown) => {
  console.error(`FAIL ${error instanceof Error ? error.message : 'Unknown readiness failure'}`);
  process.exitCode = 1;
});
