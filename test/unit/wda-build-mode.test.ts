import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeWdioConfig, makeWorkerEnvironment } from '../../core/runner/process.ts';

const device = { id: 'test-ipad', udid: '00008103-0000000000000000', teamId: 'ABCDE12345', wdaBundleId: 'co.example.WDARunner' };
const input = { runId: 'test', device, entry: '/tmp/inspect.ts', artifactDir: '/tmp/artifacts', port: 4723, wdaLocalPort: 8101, wdaDerivedDataPath: '/tmp/wda', sharedAppium: true };

test('Xcode-default recovery changes only the build-directory capability', () => {
  const previousHost = process.env.IOS_TESTING_WDA_BUILD_MODE;
  const previousWorker = process.env.WDA_BUILD_MODE;
  try {
    delete process.env.IOS_TESTING_WDA_BUILD_MODE;
    delete process.env.WDA_BUILD_MODE;
    const normal = (makeWdioConfig(input).capabilities as Array<Record<string, unknown>>)[0];
    assert.equal(normal['appium:derivedDataPath'], '/tmp/wda');
    const normalEnvironment = makeWorkerEnvironment(device, 'test', '/tmp/artifacts', 4723, 8101, '/tmp/wda');
    assert.equal(normalEnvironment.WDA_BUILD_MODE, undefined);

    process.env.IOS_TESTING_WDA_BUILD_MODE = 'xcode-default';
    const environment = makeWorkerEnvironment(device, 'test', '/tmp/artifacts', 4723, 8101, '/tmp/wda');
    assert.equal(environment.WDA_BUILD_MODE, 'xcode-default');
    process.env.WDA_BUILD_MODE = environment.WDA_BUILD_MODE;
    const recovery = (makeWdioConfig(input).capabilities as Array<Record<string, unknown>>)[0];
    const { 'appium:derivedDataPath': _directory, ...unchanged } = normal;
    assert.deepEqual(recovery, unchanged);
    assert.equal(recovery['appium:noReset'], true);
    assert.equal(recovery['appium:autoAcceptAlerts'], false);
  } finally {
    if (previousHost === undefined) delete process.env.IOS_TESTING_WDA_BUILD_MODE;
    else process.env.IOS_TESTING_WDA_BUILD_MODE = previousHost;
    if (previousWorker === undefined) delete process.env.WDA_BUILD_MODE;
    else process.env.WDA_BUILD_MODE = previousWorker;
  }
});

test('rejects an unsupported worker build mode before a device session', () => {
  const previous = process.env.WDA_BUILD_MODE;
  try {
    process.env.WDA_BUILD_MODE = 'unknown';
    assert.throws(() => makeWdioConfig(input), /Unsupported WDA build mode/);
  } finally {
    if (previous === undefined) delete process.env.WDA_BUILD_MODE;
    else process.env.WDA_BUILD_MODE = previous;
  }
});
