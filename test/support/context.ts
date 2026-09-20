import type { TransactionIntent } from '../../shared/transaction.ts';

export interface ScenarioContext {
  step<T>(name: string, operation: () => Promise<T>): Promise<T>;
  requireApproval(intent: TransactionIntent): Promise<{ intentHash: string }>;
  recordCommitAttempt(intentHash: string): Promise<void>;
  recordResource(kind: string, gid: string): Promise<void>;
  checkStopped(): void;
  resolveObservedOrder(input: { observedName: string; runMarker?: string }): Promise<{ orderGid: string; orderName: string }>;
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
