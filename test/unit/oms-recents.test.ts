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

test('stores recent OMS names and origins without credentials, newest first and deduplicated', () => {
  const storage = new MemoryStorage();
  rememberRecentOmsConnection({ label: 'QA OMS', origin: 'https://qa.example' }, storage);
  rememberRecentOmsConnection({ label: 'Production-looking name', origin: 'https://qa.example/' }, storage);
  rememberRecentOmsConnection({ label: 'Dev OMS', origin: 'https://dev.example' }, storage);

  assert.deepEqual(readRecentOmsConnections(storage), [
    { label: 'Dev OMS', origin: 'https://dev.example' },
    { label: 'Production-looking name', origin: 'https://qa.example' },
  ]);
  assert.doesNotMatch(storage.getItem('hotwax-ios-testing.recent-oms') ?? '', /password|token|secret/i);
});

test('ignores malformed stored recent OMS entries', () => {
  const storage = new MemoryStorage();
  storage.setItem('hotwax-ios-testing.recent-oms', JSON.stringify([{ label: 'Missing origin' }, { label: 'Valid', origin: 'https://valid.example' }, 'bad']));
  assert.deepEqual(readRecentOmsConnections(storage), [{ label: 'Valid', origin: 'https://valid.example' }]);
});
