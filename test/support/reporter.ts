import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RunEvent } from '../../shared/contracts.ts';

export function makeRunEvent(runId: string, sequence: number, type: RunEvent['type'], data: Record<string, unknown>, stepId?: string): RunEvent {
  return { protocolVersion: 1, runId, sequence, at: new Date().toISOString(), type, data, ...(stepId ? { stepId } : {}) };
}

export async function writeStructuredResult(artifactDir: string, passed: boolean, message?: string): Promise<void> {
  await writeFile(join(artifactDir, 'result.json'), JSON.stringify({ passed, message: message?.slice(0, 500) ?? null }));
}
