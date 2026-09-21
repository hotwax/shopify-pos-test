import { instanceNameFromOrigin, normalizeOmsInstanceName } from '../shared/oms-origin.ts';

// The environment a teammate picks once during onboarding. Only identifiers are
// stored. The shop's Shopify GID, domain and API version are deliberately left
// out: a run target must be rebuilt from a live OMS read, never from whatever a
// browser happened to keep.
export interface TestEnvironmentSelection {
  instanceName: string;
  connectorShopId: string;
  locationGid: string;
}

export const testEnvironmentStorageKey = 'hotwax-ios-testing.test-environment';

function browserStorage(): Storage | undefined {
  return typeof window === 'undefined' ? undefined : window.localStorage;
}

function normalize(value: unknown): TestEnvironmentSelection | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  const rawInstanceName = typeof item.instanceName === 'string'
    ? item.instanceName
    : typeof item.omsOrigin === 'string' ? instanceNameFromOrigin(item.omsOrigin) : '';
  const connectorShopId = typeof item.connectorShopId === 'string' ? item.connectorShopId.trim() : '';
  const locationGid = typeof item.locationGid === 'string' ? item.locationGid.trim() : '';
  if (!connectorShopId || !locationGid) return null;
  try { return { instanceName: normalizeOmsInstanceName(rawInstanceName), connectorShopId, locationGid }; }
  catch { return null; }
}

export function readTestEnvironment(storage: Storage | undefined = browserStorage()): TestEnvironmentSelection | null {
  if (!storage) return null;
  try { return normalize(JSON.parse(storage.getItem(testEnvironmentStorageKey) ?? 'null')); }
  catch { return null; }
}

export function rememberTestEnvironment(value: TestEnvironmentSelection, storage: Storage | undefined = browserStorage()): void {
  if (!storage) return;
  const item = normalize(value);
  if (!item) return;
  try { storage.setItem(testEnvironmentStorageKey, JSON.stringify(item)); } catch { /* local storage is an optional convenience */ }
}

export function forgetTestEnvironment(storage: Storage | undefined = browserStorage()): void {
  if (!storage) return;
  try { storage.removeItem(testEnvironmentStorageKey); } catch { /* local storage is an optional convenience */ }
}

export { useTestEnvStore, type TestEnvState } from './stores/test-env.ts';
