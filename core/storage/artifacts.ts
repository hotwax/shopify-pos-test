import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export async function createArtifactDirectory(root: string, runId: string): Promise<string> {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(runId)) throw new Error('Invalid run ID.');
  const directory = resolve(root, '.runtime', 'runs', runId, 'artifacts');
  await mkdir(directory, { recursive: true });
  return directory;
}

export async function writeArtifact(directory: string, name: string, data: string | Uint8Array): Promise<string> {
  if (!/^[a-zA-Z0-9._-]{1,100}$/.test(name) || name.includes('..')) throw new Error('Invalid artifact name.');
  if (typeof data === 'string' && Buffer.byteLength(data) > 1_000_000) throw new Error('Artifact exceeds the local size limit.');
  const path = join(resolve(directory), name);
  await writeFile(path, data, { flag: 'wx' });
  return path;
}
