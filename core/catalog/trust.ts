import { execFile } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function verifyWorkspaceTrust(root: string, revision: string): Promise<boolean> {
  try {
    const workspace = await realpath(root);
    const { stdout } = await execFileAsync('git', ['-C', workspace, 'rev-parse', 'HEAD'], { maxBuffer: 10_000 });
    return stdout.trim() === revision && /^[0-9a-f]{40}$/.test(revision);
  } catch {
    return false;
  }
}
