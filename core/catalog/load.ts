import { readdir, readFile, realpath } from 'node:fs/promises';
import { dirname, extname, relative, resolve, sep } from 'node:path';
import type { ScriptDefinition } from '../../shared/contracts.ts';
import { registry } from '../../test/scenarios/registry.ts';
import { validateScript } from './validate.ts';

function isInside(root: string, candidate: string): boolean {
  const path = resolve(candidate);
  const base = resolve(root);
  return path === base || path.startsWith(`${base}${sep}`);
}

export async function loadCatalog(root: string): Promise<{ scripts: ScriptDefinition[]; errors: string[] }> {
  const scripts: ScriptDefinition[] = [];
  const errors: string[] = [];
  const workspace = await realpath(root);
  const catalogDir = resolve(workspace, 'scripts', 'catalog');
  let entries;
  try {
    entries = await readdir(catalogDir, { withFileTypes: true });
  } catch (error) {
    return { scripts, errors: [`Cannot read catalog directory: ${error instanceof Error ? error.message : String(error)}`] };
  }

  const seen = new Set<string>();
  for (const entry of entries.filter(item => extname(item.name) === '.json').sort((a, b) => a.name.localeCompare(b.name))) {
    const file = resolve(catalogDir, entry.name);
    try {
      const resolved = await realpath(file);
      if (!isInside(workspace, resolved)) throw new Error(`catalog entry resolves outside workspace: ${relative(workspace, resolved)}`);
      const parsed = JSON.parse(await readFile(resolved, 'utf8')) as unknown;
      const script = validateScript(parsed, registry);
      if (seen.has(script.id)) throw new Error(`duplicate script id: ${script.id}`);
      seen.add(script.id);
      scripts.push(script);
    } catch (error) {
      errors.push(`${entry.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { scripts, errors };
}
