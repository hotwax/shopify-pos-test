export interface RecentOmsConnection {
  label: string;
  origin: string;
}

export const recentOmsStorageKey = 'hotwax-ios-testing.recent-oms';
const maxRecentConnections = 8;

function browserStorage(): Storage | undefined {
  return typeof window === 'undefined' ? undefined : window.localStorage;
}

function canonicalRecentOrigin(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function normalize(value: unknown): RecentOmsConnection | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  const origin = canonicalRecentOrigin(item.origin);
  if (!origin) return null;
  const label = typeof item.label === 'string' ? item.label.trim().slice(0, 120) : '';
  return { label: label || new URL(origin).hostname, origin };
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
      if (!item || seen.has(item.origin)) continue;
      seen.add(item.origin);
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
  const entries = [item, ...readRecentOmsConnections(storage).filter(existing => existing.origin !== item.origin)].slice(0, maxRecentConnections);
  try { storage.setItem(recentOmsStorageKey, JSON.stringify(entries)); } catch { /* local storage is an optional convenience */ }
}
