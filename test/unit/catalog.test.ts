import assert from 'node:assert/strict';
import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { loadCatalog } from '../../core/catalog/load.ts';
import { validateRunRequestAgainstCatalog, validateScript } from '../../core/catalog/validate.ts';
import { registry } from '../../test/scenarios/registry.ts';
import type { RunRequest, ScriptDefinition } from '../../shared/contracts.ts';

const smoke: ScriptDefinition = {
  schemaVersion: 1,
  id: 'pos.open-first-order',
  name: 'Open first order',
  description: 'Read-only navigation',
  domain: 'shopify-pos',
  scenario: 'pos.open-first-order',
  scenarioVersion: 1,
  parameters: {},
  assertionMode: 'pos',
  tags: ['smoke'],
};

test('accepts a registered read-only catalog definition', () => {
  assert.equal(validateScript(smoke, registry).id, 'pos.open-first-order');
  assert.equal(validateScript(smoke, registry).effect, 'read-only');
  const inspection = { ...smoke, id: 'pos.inspect-screen', name: 'Inspect current POS screen', scenario: 'pos.inspect-screen', description: 'Read-only inspection', tags: ['diagnostic'] };
  assert.equal(validateScript(inspection, registry).effect, 'read-only');
  const cartInspection = { ...smoke, id: 'pos.inspect-cart', name: 'Inspect empty POS cart', scenario: 'pos.inspect-cart', description: 'Read-only cart inspection', tags: ['diagnostic'] };
  assert.equal(validateScript(cartInspection, registry).effect, 'read-only');
});

test('accepts only run parameters owned by the selected catalog scenario', () => {
  assert.doesNotThrow(() => validateRunRequestAgainstCatalog({
    scriptId: smoke.id,
    deviceProfileId: 'test-ipad',
    parameters: {},
    assertionMode: smoke.assertionMode,
    expectedRevision: 'revision-a',
  }, [smoke], registry));
});

const invalidRequests: Array<[string, RunRequest]> = [
  ['an unknown script', { scriptId: 'pos.unknown', deviceProfileId: 'test-ipad', parameters: {}, assertionMode: 'pos' as const, expectedRevision: 'revision-a' }],
  ['unsupported parameters', { scriptId: smoke.id, deviceProfileId: 'test-ipad', parameters: { unexpected: true }, assertionMode: 'pos' as const, expectedRevision: 'revision-a' }],
  ['an unsupported assertion lane', { scriptId: smoke.id, deviceProfileId: 'test-ipad', parameters: {}, assertionMode: 'pos-shopify' as const, expectedRevision: 'revision-a' }],
] as Array<[string, RunRequest]>;

for (const [label, request] of invalidRequests) {
  test(`rejects ${label} before a native worker can start`, () => {
    assert.throws(() => validateRunRequestAgainstCatalog(request, [smoke], registry));
  });
}

for (const [label, value] of [
  ['unsupported schema', { ...smoke, schemaVersion: 99 }],
  ['path traversal scenario', { ...smoke, scenario: '../../foreign' }],
  ['arbitrary command', { ...smoke, command: 'arbitrary shell' }],
  ['unknown parameter', { ...smoke, parameters: { extra: true } }],
]) {
  test(`rejects ${label}`, () => assert.throws(() => validateScript(value, registry)));
}

test('rejects duplicate IDs and malformed JSON without executing catalog entries', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ios-testing-catalog-'));
  await mkdir(join(root, 'scripts', 'catalog'), { recursive: true });
  await writeFile(join(root, 'scripts', 'catalog', 'a.json'), JSON.stringify(smoke));
  await writeFile(join(root, 'scripts', 'catalog', 'b.json'), JSON.stringify(smoke));
  await writeFile(join(root, 'scripts', 'catalog', 'broken.json'), '{ not json');

  const result = await loadCatalog(root);
  assert.equal(result.scripts.length, 1);
  assert.ok(result.errors.some(error => error.includes('duplicate')));
  assert.ok(result.errors.some(error => error.includes('broken.json')));
});

test('does not load a catalog entry through a symlink outside the workspace', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ios-testing-catalog-'));
  const outside = await mkdtemp(join(tmpdir(), 'ios-testing-outside-'));
  await mkdir(join(root, 'scripts', 'catalog'), { recursive: true });
  const outsideFile = join(outside, 'outside.json');
  await writeFile(outsideFile, JSON.stringify(smoke));
  await symlink(outsideFile, join(root, 'scripts', 'catalog', 'linked.json'));

  const result = await loadCatalog(root);
  assert.equal(result.scripts.length, 0);
  assert.ok(result.errors.some(error => error.includes('outside')));
});
