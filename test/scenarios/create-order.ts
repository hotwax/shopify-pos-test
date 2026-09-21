import type { Money, RunRequest } from '../../shared/contracts.ts';
import type { TransactionIntent } from '../../shared/transaction.ts';
import { hashIntent } from '../../core/safety/intent.ts';
import type { PosContextEvidence } from '../../core/safety/environment.ts';
import { isValidTargetContext } from '../../core/safety/environment.ts';
import { assertCreatePrecommit, type ObservedCreateSummary } from '../../core/safety/transaction-flow.ts';
import { validateCreateOrder, type CreateOrderParameters } from '../../core/safety/transaction-inputs.ts';
import { verifyCreatedOrder } from '../../core/verification/order.ts';
import type { ScenarioContext } from '../support/context.ts';

export interface CreateOrderDriver {
  readContextEvidence(): Promise<PosContextEvidence>;
  prepareCart(parameters: CreateOrderParameters): Promise<void>;
  selectCash(): Promise<void>;
  readSummary(): Promise<ObservedCreateSummary>;
  commitCash(): Promise<void>;
  readCompletedOrderName(): Promise<string>;
}

/**
 * The frozen identity of one cash order. Its hash is what the coordinator's
 * business-effect ledger is keyed by, so the native spec and this driver must
 * build it the same way.
 */
export function createCashOrderIntent(parameters: CreateOrderParameters, request: RunRequest, udid: string): TransactionIntent {
  if (!isValidTargetContext(request.context)) throw new Error('A create-order run requires an exact frozen target context.');
  if (!udid.trim()) throw new Error('The create-order run has no observed iPad identity.');
  return {
    scenario: 'pos.create-cash-order',
    sourceHash: request.expectedRevision,
    udid,
    context: request.context,
    returnLines: [],
    purchaseLines: parameters.lines,
    tender: 'cash',
    expectedDirection: 'collect',
    maximumAbsoluteAmount: { amount: '0', currency: parameters.currency },
  };
}

export async function createCashOrder(
  input: CreateOrderParameters,
  request: RunRequest,
  context: ScenarioContext,
  driver: CreateOrderDriver,
  udid = process.env.IOS_UDID?.trim() ?? '',
): Promise<{ orderGid: string; orderName: string }> {
  const parameters = validateCreateOrder(input);
  const intent = createCashOrderIntent(parameters, request, udid);
  const intentHash = hashIntent(intent);
  await context.step('verify-pos-context', async () => context.assertAllowedIntent(intent, await driver.readContextEvidence()));
  await context.step('prepare-cash-order-cart', () => driver.prepareCart(parameters));
  await context.step('select-cash-tender', () => driver.selectCash());
  const observed = await context.step('verify-create-cart', () => driver.readSummary());
  assertCreatePrecommit(observed, parameters);
  await context.step('verify-pos-context-before-commit', async () => context.assertAllowedIntent(intent, await driver.readContextEvidence()));
  await context.recordCommitAttempt(intentHash);
  await context.step('commit-cash-order', () => driver.commitCash());
  const order = await locateCashOrderByName(context, await driver.readCompletedOrderName(), intentHash);
  return confirmCashOrder({ parameters, context, intentHash, order, tender: observed.tender });
}

export interface LocatedOrder { orderGid: string; orderName: string }

/** Correlates a reference POS displayed for the completed sale to one exact Shopify order. */
export async function locateCashOrderByName(context: ScenarioContext, observedName: string, intentHash: string): Promise<LocatedOrder> {
  const orderName = observedName.trim();
  if (!orderName || orderName.length > 120) throw new Error('The completed POS order did not expose a bounded order reference.');
  return context.resolveObservedOrder({ observedName: orderName, runMarker: intentHash.slice(0, 12) });
}

/**
 * Correlates the sale without reading anything from POS: the one POS order
 * created since the commit time with exactly the tendered total and line
 * count. Shopify may take a few seconds to list a new order, so a miss is
 * retried for a bounded time; an ambiguous match is never retried away.
 */
export async function locateRecentCashOrder(
  context: ScenarioContext,
  input: { notBefore: string; total: Money; lineCount: number },
  options: { attempts?: number; delayMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<LocatedOrder> {
  const attempts = options.attempts ?? 15;
  const delayMs = options.delayMs ?? 3_000;
  const sleep = options.sleep ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)));
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try { return await context.resolveRecentOrder(input); }
    catch (cause) {
      lastError = cause;
      if (cause instanceof Error && /more than one/i.test(cause.message)) throw cause;
      if (attempt < attempts) await sleep(delayMs);
    }
  }
  throw lastError instanceof Error ? lastError : new Error('The sale could not be correlated to one POS order.');
}

/**
 * Turns a located order into a confirmed business effect: the order is read
 * back from Shopify through the coordinator and checked against the approved
 * lines and tender, and only then is the effect confirmed and the order
 * recorded as an affected resource. Any failure leaves the effect at
 * "attempted", which the coordinator turns into needs-reconciliation.
 */
export async function confirmCashOrder(input: {
  parameters: CreateOrderParameters;
  context: ScenarioContext;
  intentHash: string;
  order: LocatedOrder;
  tender: string;
}): Promise<LocatedOrder> {
  const observedOrder = input.order;
  await input.context.step('verify-shopify-create', async () => {
    const readback = await input.context.readShopifyOrder(observedOrder.orderGid);
    const verification = verifyCreatedOrder(readback, input.parameters, input.tender);
    if (!verification.passed) throw new Error(`Shopify create-order read-back failed: ${verification.checks.filter(check => !check.passed).map(check => check.name).join(', ')}.`);
  });
  await input.context.recordResource('shopify-order', observedOrder.orderGid);
  await input.context.recordBusinessEffect('confirmed', input.intentHash);
  return observedOrder;
}
