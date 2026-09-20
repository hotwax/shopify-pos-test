import { instanceNameFromOrigin, normalizeOmsInstanceName } from '../shared/oms-origin.ts';

export interface RecentOmsConnection {
  instanceName: string;
}

export const recentOmsStorageKey = 'hotwax-ios-testing.recent-oms';
const maxRecentConnections = 8;

function browserStorage(): Storage | undefined {
  return typeof window === 'undefined' ? undefined : window.localStorage;
}

function normalize(value: unknown): RecentOmsConnection | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  const rawInstanceName = typeof item.instanceName === 'string'
    ? item.instanceName
    : typeof item.origin === 'string' ? instanceNameFromOrigin(item.origin) : '';
  try { return { instanceName: normalizeOmsInstanceName(rawInstanceName) }; }
  catch { return null; }
}

export function readRecentOmsConnections(storage: Storage | undefined = browserStorage()): RecentOmsConnection[] {
  if (!storage) return [];
  try {
    const parsed: unknown = JSON.parse(storage.getItem(recentOmsStorageKey) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    const entries: RecentOmsConnection[] = [];
    for (const candidate of parsed) {
      const item = normalize(candidate);
      if (!item || seen.has(item.instanceName)) continue;
      seen.add(item.instanceName);
      entries.push(item);
      if (entries.length === maxRecentConnections) break;
    }
    return entries;
  } catch {
    return [];
  }
}

export function rememberRecentOmsConnection(value: RecentOmsConnection, storage: Storage | undefined = browserStorage()): void {
  if (!storage) return;
  const item = normalize(value);
  if (!item) return;
  const entries = [item, ...readRecentOmsConnections(storage).filter(existing => existing.instanceName !== item.instanceName)].slice(0, maxRecentConnections);
  try { storage.setItem(recentOmsStorageKey, JSON.stringify(entries)); } catch { /* local storage is an optional convenience */ }
}
