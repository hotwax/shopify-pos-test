/**
 * Native-session invariants that preserve the user's existing iPad access and
 * Shopify POS state. These are checked before the WDIO configuration is
 * handed to Appium so a future capability change fails locally instead of
 * silently resetting or replacing anything on the device.
 */
export function assertNativeSessionPreservesAccess(capabilities: Record<string, unknown>): void {
  const requiredFalse = [
    'appium:fullReset',
    'appium:forceAppLaunch',
    'appium:shouldTerminateApp',
    'appium:autoAcceptAlerts',
    'appium:autoDismissAlerts',
    'appium:useNewWDA',
  ];
  for (const key of requiredFalse) {
    if (capabilities[key] !== false) throw new Error(`Native session safety invariant failed: ${key} must remain false.`);
  }
  if (capabilities['appium:noReset'] !== true) {
    throw new Error('Native session safety invariant failed: appium:noReset must remain true.');
  }
  if ('appium:app' in capabilities) {
    throw new Error('Native session safety invariant failed: an app path must not be supplied.');
  }
}
