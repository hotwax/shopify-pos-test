import assert from 'node:assert/strict';
import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { loadCatalog } from '../../core/catalog/load.ts';
import { validateScript } from '../../core/catalog/validate.ts';
import { registry } from '../../test/scenarios/registry.ts';
import type { ScriptDefinition } from '../../shared/contracts.ts';

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
});

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
