import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPinia, setActivePinia } from 'pinia';
import { useTestEnvStore } from '../../ui/stores/test-env.ts';
import { forgetTestEnvironment, rememberTestEnvironment } from '../../ui/test-environment.ts';

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

function initStore() {
  setActivePinia(createPinia());
  return useTestEnvStore();
}

test('initializes with null when storage is empty', () => {
  const storage = new MemoryStorage();
  forgetTestEnvironment(storage);
  const store = initStore();

  assert.equal(store.savedEnvironment, null);
  assert.equal(store.hasSavedEnvironment, false);
  assert.equal(store.instanceName, '');
  assert.equal(store.connectorShopId, '');
  assert.equal(store.locationGid, '');
});

test('saveEnvironment persists to storage and updates reactive state', () => {
  const storage = new MemoryStorage();
  const store = initStore();
  store.saveEnvironment(
    { instanceName: 'Test-Maarg', connectorShopId: 'SHOP_1', locationGid: 'gid://shopify/Location/1' },
    'Brooklyn',
    storage,
  );

  assert.equal(store.hasSavedEnvironment, true);
  assert.deepEqual(store.savedEnvironment, {
    instanceName: 'test-maarg',
    connectorShopId: 'SHOP_1',
    locationGid: 'gid://shopify/Location/1',
  });
  assert.equal(store.instanceName, 'test-maarg');
  assert.equal(store.connectorShopId, 'SHOP_1');
  assert.equal(store.locationGid, 'gid://shopify/Location/1');
  assert.equal(store.locationName, 'Brooklyn');
  assert.equal(store.isSaved('test-maarg', 'SHOP_1', 'gid://shopify/Location/1'), true);
  assert.equal(store.isSaved('Test-Maarg', 'SHOP_1', 'gid://shopify/Location/1'), true, 'comparison is case-insensitive for instanceName');
  assert.equal(store.isSaved('test-maarg', 'SHOP_1', 'gid://shopify/Location/2'), false);
});

test('setFacility updates locationGid and locationName', () => {
  const store = initStore();
  store.setFacility('gid://shopify/Location/2', 'Centerville');

  assert.equal(store.locationGid, 'gid://shopify/Location/2');
  assert.equal(store.locationName, 'Centerville');
  assert.equal(store.activeLocationGid, 'gid://shopify/Location/2');
});

test('setShop updates connectorShopId and resets facility when changed from saved', () => {
  const storage = new MemoryStorage();
  const store = initStore();
  store.saveEnvironment(
    { instanceName: 'test-maarg', connectorShopId: 'SHOP_1', locationGid: 'gid://shopify/Location/1' },
    'Brooklyn',
    storage,
  );

  store.setShop('SHOP_2');
  assert.equal(store.connectorShopId, 'SHOP_2');
  assert.equal(store.locationGid, '', 'changing shop away from saved should reset locationGid');
});

test('clearEnvironment clears state and storage', () => {
  const storage = new MemoryStorage();
  const store = initStore();
  store.saveEnvironment(
    { instanceName: 'test-maarg', connectorShopId: 'SHOP_1', locationGid: 'gid://shopify/Location/1' },
    'Brooklyn',
    storage,
  );

  store.clearEnvironment(storage);
  assert.equal(store.savedEnvironment, null);
  assert.equal(store.hasSavedEnvironment, false);
  assert.equal(store.instanceName, '');
  assert.equal(store.connectorShopId, '');
  assert.equal(store.locationGid, '');
  assert.equal(store.locationName, '');
});

test('loadSavedEnvironment re-hydrates state after external storage update', () => {
  const storage = new MemoryStorage();
  const store = initStore();
  store.clearEnvironment(storage);

  rememberTestEnvironment({
    instanceName: 'test-maarg',
    connectorShopId: 'SHOP_EXT',
    locationGid: 'gid://shopify/Location/99',
  }, storage);

  const reloaded = store.loadSavedEnvironment(storage);
  assert.deepEqual(reloaded, {
    instanceName: 'test-maarg',
    connectorShopId: 'SHOP_EXT',
    locationGid: 'gid://shopify/Location/99',
  });
  assert.equal(store.connectorShopId, 'SHOP_EXT');
  assert.equal(store.locationGid, 'gid://shopify/Location/99');
});
