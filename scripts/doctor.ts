import 'dotenv/config';
import { readDeviceConfig } from '../config/device.ts';
import { runSetupChecks } from '../core/setup/checks.ts';

const requiredChecks = new Set([
  'host.node',
  'host.xcode',
  'device.pairing',
  'device.developer',
  'device.os',
  'device.remote-xpc',
  'pos.installed',
  'signing.identity',
]);

async function main(): Promise<void> {
  if (process.platform !== 'darwin') throw new Error('A Mac with Xcode is required.');
  const config = readDeviceConfig(process.env);
  const checks = await runSetupChecks({ id: 'doctor', ...config });
  for (const item of checks) {
    const label = requiredChecks.has(item.id) && item.state === 'ready' ? 'PASS' : item.state === 'ready' ? 'INFO' : item.state.toUpperCase();
    console.log(`${label} ${item.id}: ${item.message}`);
    if (item.actions[0]) console.log(`  Next: ${item.actions[0]}`);
  }
  const failed = checks.filter(item => requiredChecks.has(item.id) && item.state !== 'ready');
  if (failed.length) throw new Error(`${failed.length} required readiness check(s) are not ready.`);
  console.log('Prerequisites checked. WDA provisioning, device trust/UI Automation and POS Home still require a live session.');
}

main().catch((error: unknown) => {
  console.error(`FAIL ${error instanceof Error ? error.message : 'Unknown readiness failure'}`);
  process.exitCode = 1;
});
