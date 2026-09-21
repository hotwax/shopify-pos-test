import { assertNativeSessionPreservesAccess } from '../core/safety/native-session.ts';

export interface DeviceConfig {
  udid: string;
  teamId: string;
  wdaBundleId: string;
}

export function readDeviceConfig(env: NodeJS.ProcessEnv): DeviceConfig {
  function required(key: string, pattern: RegExp, hint: string): string {
    const value = env[key]?.trim() ?? '';
    if (!pattern.test(value)) throw new Error(`${key}: ${hint}. Set it in your local .env.`);
    return value;
  }
  return {
    udid: required('IOS_UDID', /^(?:[0-9a-f]{8}-[0-9a-f]{16}|[0-9a-f]{40})$/i, 'use the physical iPad UDID, not auto or its name'),
    teamId: required('APPLE_TEAM_ID', /^[A-Z0-9]{10}$/, 'use your 10-character Xcode signing team ID'),
    wdaBundleId: required('WDA_BUNDLE_ID', /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/, 'use a unique reverse-domain runner identifier'),
  };
}

export function buildCapabilities(config: DeviceConfig) {
  const capabilities = {
    platformName: 'iOS',
    'appium:automationName': 'XCUITest',
    'appium:udid': config.udid,
    'appium:bundleId': 'com.jadedpixel.pos',
    'appium:noReset': true,
    'appium:fullReset': false,
    'appium:forceAppLaunch': false,
    'appium:shouldTerminateApp': false,
    'appium:autoAcceptAlerts': false,
    'appium:autoDismissAlerts': false,
    'appium:xcodeOrgId': config.teamId,
    'appium:xcodeSigningId': 'Apple Development',
    'appium:updatedWDABundleId': config.wdaBundleId,
    'appium:usePreinstalledWDA': false,
    'appium:useNewWDA': false,
    'appium:wdaStartupRetries': 1,
    'appium:wdaLaunchTimeout': 120_000,
    'appium:newCommandTimeout': 120,
    // XCTest waits for the app's main thread to idle before every action. This
    // capability is in SECONDS (the earlier value of 1500 made WDA log "Waiting
    // up to 1500s"). Shopify POS goes idle quickly on the screens we drive, so
    // a two-second bound costs nothing when it idles and stops a single action
    // from stalling for minutes when it does not. Zero would skip the wait and
    // drop taps outright.
    'appium:waitForIdleTimeout': 2,
    'appium:showXcodeLog': true,
    'appium:allowProvisioningDeviceRegistration': true,
    // snapshotMaxDepth exposes the POS rows in page source. useFirstMatch makes
    // every single-element lookup return the first match instead of building
    // the whole match set first; we only ever look elements up by exact id.
    'appium:settings': { snapshotMaxDepth: 62, useFirstMatch: true },
  };
  assertNativeSessionPreservesAccess(capabilities);
  return capabilities;
}
