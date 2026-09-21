import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readRecentOmsConnections, rememberRecentOmsConnection } from '../../ui/oms-recents.ts';

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

test('stores recent OMS instance names without credentials, newest first and deduplicated', () => {
  const storage = new MemoryStorage();
  rememberRecentOmsConnection({ instanceName: 'QA-OMS' }, storage);
  rememberRecentOmsConnection({ instanceName: 'qa-oms' }, storage);
  rememberRecentOmsConnection({ instanceName: 'Dev-OMS' }, storage);

  assert.deepEqual(readRecentOmsConnections(storage), [
    { instanceName: 'dev-oms' },
    { instanceName: 'qa-oms' },
  ]);
  assert.doesNotMatch(storage.getItem('hotwax-ios-testing.recent-oms') ?? '', /password|token|secret|https?:/i);
});

test('ignores malformed stored recent OMS entries', () => {
  const storage = new MemoryStorage();
  storage.setItem('hotwax-ios-testing.recent-oms', JSON.stringify([{ instanceName: 'bad_name' }, { instanceName: 'valid' }, { origin: 'https://legacy.hotwax.io' }, 'bad']));
  assert.deepEqual(readRecentOmsConnections(storage), [{ instanceName: 'valid' }, { instanceName: 'legacy' }]);
});
