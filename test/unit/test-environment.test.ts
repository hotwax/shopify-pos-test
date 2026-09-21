import assert from 'node:assert/strict';
import { test } from 'node:test';
import { forgetTestEnvironment, readTestEnvironment, rememberTestEnvironment, testEnvironmentStorageKey } from '../../ui/test-environment.ts';

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

test('stores the chosen environment identifiers and normalizes the instance name', () => {
  const storage = new MemoryStorage();
  rememberTestEnvironment({ instanceName: 'Test-Maarg', connectorShopId: 'SHOP_1', locationGid: 'gid://shopify/Location/1' }, storage);

  assert.deepEqual(readTestEnvironment(storage), {
    instanceName: 'test-maarg',
    connectorShopId: 'SHOP_1',
    locationGid: 'gid://shopify/Location/1',
  });
});

test('never stores the shop GID, domain or API version a run is frozen against', () => {
  const storage = new MemoryStorage();
  rememberTestEnvironment({ instanceName: 'test-maarg', connectorShopId: 'SHOP_1', locationGid: 'gid://shopify/Location/1' }, storage);

  const stored = storage.getItem(testEnvironmentStorageKey) ?? '';
  assert.doesNotMatch(stored, /shopGid|shopDomain|apiVersion|myshopify|password|token|https?:/i);
});

test('rejects an incomplete or malformed stored environment', () => {
  const storage = new MemoryStorage();

  storage.setItem(testEnvironmentStorageKey, JSON.stringify({ instanceName: 'test-maarg', connectorShopId: 'SHOP_1' }));
  assert.equal(readTestEnvironment(storage), null, 'a missing location must not resolve');

  storage.setItem(testEnvironmentStorageKey, JSON.stringify({ instanceName: 'bad_name', connectorShopId: 'SHOP_1', locationGid: 'gid://shopify/Location/1' }));
  assert.equal(readTestEnvironment(storage), null, 'an invalid instance name must not resolve');

  storage.setItem(testEnvironmentStorageKey, 'not json');
  assert.equal(readTestEnvironment(storage), null);

  rememberTestEnvironment({ instanceName: 'test-maarg', connectorShopId: '', locationGid: '' }, storage);
  assert.equal(readTestEnvironment(storage), null, 'an empty selection must not overwrite with a partial record');
});

test('reads a legacy record that stored the OMS origin', () => {
  const storage = new MemoryStorage();
  storage.setItem(testEnvironmentStorageKey, JSON.stringify({ omsOrigin: 'https://test-maarg.hotwax.io', connectorShopId: 'SHOP_1', locationGid: 'gid://shopify/Location/1' }));

  assert.equal(readTestEnvironment(storage)?.instanceName, 'test-maarg');
});

test('forgetting the environment clears it', () => {
  const storage = new MemoryStorage();
  rememberTestEnvironment({ instanceName: 'test-maarg', connectorShopId: 'SHOP_1', locationGid: 'gid://shopify/Location/1' }, storage);
  forgetTestEnvironment(storage);

  assert.equal(readTestEnvironment(storage), null);
});
