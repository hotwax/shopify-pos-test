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
  return {
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
  };
}
