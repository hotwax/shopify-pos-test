import { realpath } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';

const excluded = ['.env', '.git', '.runtime', 'artifacts', '.wda'];

function inside(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${sep}`);
}

export async function resolveTrustedWorkerSource(root: string, entry: string): Promise<{ files: string[]; excluded: string[]; root: string; entry: string }> {
  const workspace = await realpath(root);
  const candidate = await realpath(resolve(workspace, entry));
  if (!inside(workspace, candidate)) throw new Error('Worker entry resolves outside the checkout.');
  const relativeEntry = relative(workspace, candidate);
  if (!relativeEntry || relativeEntry.startsWith('..') || relativeEntry.split(sep).some(part => excluded.includes(part))) {
    throw new Error('Worker entry is excluded or outside the trusted source set.');
  }
  return { files: [relativeEntry], excluded: [...excluded], root: workspace, entry: candidate };
}
