import { isAbsolute } from 'node:path';
import type { RunRequest } from '../../shared/contracts.ts';
import { readWorkerInput } from '../../core/runner/input.ts';

/**
 * Load the immutable request written by the local coordinator for this WDIO
 * worker. Native specs must not read arbitrary files or reconstruct inputs
 * from process arguments/environment values.
 */
export async function readScenarioRequest(environment: NodeJS.ProcessEnv = process.env): Promise<RunRequest> {
  const inputFile = environment.RUN_INPUT_FILE?.trim();
  const runId = environment.WDIO_RUN_ID?.trim();
  if (!inputFile || !isAbsolute(inputFile)) throw new Error('The native worker input file is missing or not absolute.');
  if (!runId) throw new Error('The native worker run identity is missing.');
  return readWorkerInput(inputFile, runId);
}
