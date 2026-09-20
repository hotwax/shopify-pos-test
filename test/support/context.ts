import type { TransactionIntent } from '../../shared/transaction.ts';
import { consumeApproval } from '../../core/runner/approval.ts';
import { consumeCommitCheckpoint, writeCommitCheckpoint } from '../../core/runner/checkpoint.ts';
import { hashIntent } from '../../core/safety/intent.ts';

export interface ScenarioContext {
  step<T>(name: string, operation: () => Promise<T>): Promise<T>;
  requireApproval(intent: TransactionIntent): Promise<{ intentHash: string }>;
  recordCommitAttempt(intentHash: string): Promise<void>;
  recordResource(kind: string, gid: string): Promise<void>;
  checkStopped(): void;
  resolveObservedOrder(input: { observedName: string; runMarker?: string }): Promise<{ orderGid: string; orderName: string }>;
}

export interface ScenarioContextOptions {
  root: string;
  runId: string;
}

export function unavailableScenarioContext(): ScenarioContext {
  const unavailable = async (): Promise<never> => { throw new Error('Scenario context is not bound to an owned run.'); };
  return {
    step: async (_name, operation) => operation(),
    requireApproval: unavailable,
    recordCommitAttempt: unavailable,
    recordResource: unavailable,
    checkStopped: () => undefined,
    resolveObservedOrder: unavailable,
  };
}

export function createScenarioContext(options: ScenarioContextOptions = { root: process.env.IOS_TESTING_ROOT ?? process.cwd(), runId: process.env.WDIO_RUN_ID ?? '' }): ScenarioContext {
  if (!options.root || !options.runId) return unavailableScenarioContext();
  return {
    step: async (_name, operation) => operation(),
    requireApproval: async intent => {
      const intentHash = hashIntent(intent);
      if (!await consumeApproval(options.root, options.runId, intentHash)) throw new Error('A matching one-time transaction approval is required.');
      return { intentHash };
    },
    recordCommitAttempt: async intentHash => { await writeCommitCheckpoint(options.root, options.runId, intentHash); },
    recordResource: async () => { throw new Error('Resource recording is not bound to an owned sidecar run.'); },
    checkStopped: () => undefined,
    resolveObservedOrder: async () => { throw new Error('Observed-order correlation is not bound to an owned sidecar run.'); },
  };
}
