import type { TransactionIntent } from '../../shared/transaction.ts';
import { consumeApproval, requestApproval } from '../../core/runner/approval.ts';
import { consumeCommitCheckpoint, writeCommitCheckpoint } from '../../core/runner/checkpoint.ts';
import { consumeCommitAcknowledgement, consumeCommitOutcomeAcknowledgement, requestCommitAttempt, requestCommitOutcome } from '../../core/runner/effects.ts';
import { recordResource } from '../../core/runner/resources.ts';
import { hashIntent } from '../../core/safety/intent.ts';

export interface ScenarioContext {
  step<T>(name: string, operation: () => Promise<T>): Promise<T>;
  requireApproval(intent: TransactionIntent): Promise<{ intentHash: string }>;
  recordCommitAttempt(intentHash: string): Promise<void>;
  recordBusinessEffect(effect: 'confirmed' | 'unknown', intentHash: string): Promise<void>;
  recordResource(kind: string, gid: string): Promise<void>;
  checkStopped(): void;
  resolveObservedOrder(input: { observedName: string; runMarker?: string }): Promise<{ orderGid: string; orderName: string }>;
}

export interface ScenarioContextOptions {
  root: string;
  runId: string;
  approvalTimeoutMs?: number;
  commitAckTimeoutMs?: number;
  effectAckTimeoutMs?: number;
}

export function unavailableScenarioContext(): ScenarioContext {
  const unavailable = async (): Promise<never> => { throw new Error('Scenario context is not bound to an owned run.'); };
  return {
    step: async (_name, operation) => operation(),
    requireApproval: unavailable,
    recordCommitAttempt: unavailable,
    recordBusinessEffect: unavailable,
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
      await requestApproval(options.root, options.runId, intentHash, {
        scenario: intent.scenario,
        direction: intent.expectedDirection,
        amount: intent.maximumAbsoluteAmount,
        lineCount: intent.returnLines.length + intent.purchaseLines.length,
        ...(intent.originalOrderGid ? { sourceOrderGid: intent.originalOrderGid } : {}),
      });
      const timeout = options.approvalTimeoutMs ?? 30 * 60 * 1000;
      if (!Number.isSafeInteger(timeout) || timeout <= 0) throw new Error('The approval timeout is invalid.');
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        if (await consumeApproval(options.root, options.runId, intentHash)) return { intentHash };
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      throw new Error('The transaction approval checkpoint expired before it was approved.');
    },
    recordCommitAttempt: async intentHash => {
      await writeCommitCheckpoint(options.root, options.runId, intentHash);
      await requestCommitAttempt(options.root, options.runId, intentHash);
      const timeout = options.commitAckTimeoutMs ?? 30 * 60 * 1000;
      if (!Number.isSafeInteger(timeout) || timeout <= 0) throw new Error('The commit acknowledgement timeout is invalid.');
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        if (await consumeCommitAcknowledgement(options.root, options.runId, intentHash)) return;
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      throw new Error('The coordinator did not durably acknowledge the commit boundary.');
    },
    recordBusinessEffect: async (effect, intentHash) => {
      await requestCommitOutcome(options.root, options.runId, intentHash, effect);
      const timeout = options.effectAckTimeoutMs ?? options.commitAckTimeoutMs ?? 30 * 60 * 1000;
      if (!Number.isSafeInteger(timeout) || timeout <= 0) throw new Error('The business-effect acknowledgement timeout is invalid.');
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        if (await consumeCommitOutcomeAcknowledgement(options.root, options.runId, intentHash, effect)) return;
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      throw new Error('The coordinator did not durably acknowledge the business-effect outcome.');
    },
    recordResource: async (kind, gid) => { await recordResource(options.root, options.runId, kind, gid); },
    checkStopped: () => undefined,
    resolveObservedOrder: async () => { throw new Error('Observed-order correlation is not bound to an owned sidecar run.'); },
  };
}
