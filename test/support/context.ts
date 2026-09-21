import type { TransactionIntent } from '../../shared/transaction.ts';
import { consumeBridgeResponse, createObservedOrderRequest, createRecentOrderRequest, createShopifyOrderRequest } from '../../core/runner/bridge.ts';
import { consumeCommitCheckpoint, writeCommitCheckpoint } from '../../core/runner/checkpoint.ts';
import { consumeCommitAcknowledgement, consumeCommitOutcomeAcknowledgement, requestCommitAttempt, requestCommitOutcome } from '../../core/runner/effects.ts';
import { recordResource } from '../../core/runner/resources.ts';
import { assertAllowedIntent } from '../../core/safety/intent.ts';
import type { PosContextEvidence } from '../../core/safety/environment.ts';
import { loadApprovedTargets } from '../../core/safety/policy.ts';
import type { Money, OmsShopifyOrderDetail } from '../../shared/contracts.ts';

export interface ScenarioContext {
  step<T>(name: string, operation: () => Promise<T>): Promise<T>;
  assertAllowedIntent(intent: TransactionIntent, evidence: PosContextEvidence): Promise<void>;
  recordCommitAttempt(intentHash: string): Promise<void>;
  recordBusinessEffect(effect: 'confirmed' | 'unknown', intentHash: string): Promise<void>;
  recordResource(kind: string, gid: string): Promise<void>;
  checkStopped(): void;
  resolveObservedOrder(input: { observedName: string; runMarker?: string }): Promise<{ orderGid: string; orderName: string }>;
  /**
   * Finds the one POS order created since `notBefore` with exactly this total
   * and line count, through the coordinator's OMS bridge. It returns an
   * identity only; the caller still reads the order back from Shopify.
   */
  resolveRecentOrder(input: { notBefore: string; total: Money; lineCount: number }): Promise<{ orderGid: string; orderName: string }>;
  readShopifyOrder(orderGid: string): Promise<OmsShopifyOrderDetail>;
}

export interface ScenarioContextOptions {
  root: string;
  runId: string;
  commitAckTimeoutMs?: number;
  effectAckTimeoutMs?: number;
  bridgeTimeoutMs?: number;
}

export function unavailableScenarioContext(): ScenarioContext {
  const unavailable = async (): Promise<never> => { throw new Error('Scenario context is not bound to an owned run.'); };
  return {
    step: async (_name, operation) => operation(),
    assertAllowedIntent: unavailable,
    recordCommitAttempt: unavailable,
    recordBusinessEffect: unavailable,
    recordResource: unavailable,
    checkStopped: () => undefined,
    resolveObservedOrder: unavailable,
    resolveRecentOrder: unavailable,
    readShopifyOrder: unavailable,
  };
}

export function createScenarioContext(options: ScenarioContextOptions = { root: process.env.IOS_TESTING_ROOT ?? process.cwd(), runId: process.env.WDIO_RUN_ID ?? '' }): ScenarioContext {
  if (!options.root || !options.runId) return unavailableScenarioContext();
  return {
    step: async (_name, operation) => operation(),
    assertAllowedIntent: async (intent, evidence) => {
      const approvedTargets = await loadApprovedTargets(options.root);
      assertAllowedIntent(intent, evidence, approvedTargets);
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
    resolveObservedOrder: async input => {
      const request = await createObservedOrderRequest(options.root, options.runId, input);
      const timeout = options.bridgeTimeoutMs ?? 5 * 60 * 1000;
      if (!Number.isSafeInteger(timeout) || timeout <= 0) throw new Error('The observed-order bridge timeout is invalid.');
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        const response = await consumeBridgeResponse(options.root, request);
        if (response) {
          if (!response.ok || response.operation !== 'resolveObservedOrder' || !response.orderGid || !response.orderName) throw new Error(response.error ?? 'The OMS could not resolve the observed POS order.');
          return { orderGid: response.orderGid, orderName: response.orderName };
        }
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      throw new Error('The OMS did not respond to the observed-order correlation request.');
    },
    resolveRecentOrder: async input => {
      const request = await createRecentOrderRequest(options.root, options.runId, { notBefore: input.notBefore, totalAmount: input.total.amount, totalCurrency: input.total.currency, lineCount: input.lineCount });
      const timeout = options.bridgeTimeoutMs ?? 5 * 60 * 1000;
      if (!Number.isSafeInteger(timeout) || timeout <= 0) throw new Error('The recent-order bridge timeout is invalid.');
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        const response = await consumeBridgeResponse(options.root, request);
        if (response) {
          if (!response.ok || response.operation !== 'resolveRecentOrder' || !response.orderGid || !response.orderName) throw new Error(response.error ?? 'The OMS could not correlate the sale to one POS order.');
          return { orderGid: response.orderGid, orderName: response.orderName };
        }
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      throw new Error('The OMS did not respond to the recent-order correlation request.');
    },
    readShopifyOrder: async orderGid => {
      const request = await createShopifyOrderRequest(options.root, options.runId, { orderGid });
      const timeout = options.bridgeTimeoutMs ?? 5 * 60 * 1000;
      if (!Number.isSafeInteger(timeout) || timeout <= 0) throw new Error('The Shopify order bridge timeout is invalid.');
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        const response = await consumeBridgeResponse(options.root, request);
        if (response) {
          if (!response.ok || response.operation !== 'readShopifyOrder' || !response.order) throw new Error(response.error ?? 'The OMS could not read the Shopify order.');
          return response.order;
        }
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      throw new Error('The OMS did not respond to the Shopify order readback request.');
    },
  };
}
