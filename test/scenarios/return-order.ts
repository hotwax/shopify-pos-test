import type { OmsShopifyOrderDetail, RunRequest } from '../../shared/contracts.ts';
import type { TransactionIntent } from '../../shared/transaction.ts';
import { hashIntent } from '../../core/safety/intent.ts';
import type { PosContextEvidence } from '../../core/safety/environment.ts';
import { isValidTargetContext } from '../../core/safety/environment.ts';
import { assertReturnPrecommit, type ObservedReturnSummary } from '../../core/safety/transaction-flow.ts';
import { validateReturn, type ReturnParameters } from '../../core/safety/transaction-inputs.ts';
import { verifyReturnedOrder } from '../../core/verification/order.ts';
import { assertWithinMaximum, compareMoney } from '../../core/safety/money.ts';
import type { ScenarioContext } from '../support/context.ts';

export interface ReturnOrderDriver {
  readContextEvidence(): Promise<PosContextEvidence>;
  /**
   * Builds the return cart. The source order read-back is handed in because
   * the driver needs it to translate approved line GIDs into the product
   * titles Shopify POS shows, and re-reading it would be a second round trip
   * against an order the run has already proven.
   */
  prepareReturn(parameters: ReturnParameters, source: OmsShopifyOrderDetail): Promise<void>;
  selectCash(): Promise<void>;
  readSummary(): Promise<ObservedReturnSummary>;
  commitCash(beforeCommit: () => Promise<void>): Promise<void>;
}

export function isCashOrder(order: OmsShopifyOrderDetail): boolean {
  return order.paymentGatewayNames.length === 1 && order.paymentGatewayNames[0]?.trim().toLowerCase() === 'cash';
}

function createIntent(parameters: ReturnParameters, request: RunRequest, udid: string, currency = 'USD', source?: OmsShopifyOrderDetail): TransactionIntent {
  if (!isValidTargetContext(request.context)) throw new Error('A return run requires an exact frozen target context.');
  if (!udid.trim()) throw new Error('The return run has no observed iPad identity.');
  return {
    scenario: 'pos.return-cash-order',
    sourceHash: request.expectedRevision,
    udid,
    context: request.context,
    originalOrderGid: parameters.orderGid,
    ...(parameters.orderReference ? { originalOrderReference: parameters.orderReference } : {}),
    returnLines: parameters.lines,
    purchaseLines: [],
    tender: 'cash',
    refundMethod: parameters.refundMethod,
    ...(parameters.refundMethod === 'store-credit' ? { refundCustomerGid: source!.customer!.gid } : {}),
    expectedDirection: 'refund',
    maximumAbsoluteAmount: parameters.refundMethod === 'store-credit' ? source!.total! : { amount: '0', currency },
  };
}

export function affectedIds(before: OmsShopifyOrderDetail, after: OmsShopifyOrderDetail): Record<string, string[]> {
  const beforeAgreements = new Set(before.agreements.map(agreement => agreement.id));
  const newAgreements = after.agreements.filter(agreement => !beforeAgreements.has(agreement.id));
  const returnIds = newAgreements.flatMap(agreement => agreement.returnGid ? [agreement.returnGid] : []);
  return {
    'shopify-order': [after.gid],
    'shopify-return': [...new Set(returnIds)],
    'shopify-agreement': newAgreements.map(agreement => agreement.id),
  };
}

export async function returnCashOrder(
  input: ReturnParameters,
  request: RunRequest,
  context: ScenarioContext,
  driver: ReturnOrderDriver,
  udid = process.env.IOS_UDID?.trim() ?? '',
): Promise<{ orderGid: string; affectedIds: Record<string, string[]> }> {
  if (!input.orderReference?.trim()) throw new Error('The return run requires the selected POS order reference; choose the order from OMS search.');
  const source = await context.step('read-return-source', () => context.readShopifyOrder(input.orderGid));
  if (!isCashOrder(source)) throw new Error('The selected source order is not an exact cash-only Shopify order.');
  const remaining = Object.fromEntries(source.lines.map(line => [line.gid, line.refundableQuantity ?? -1]));
  const parameters = validateReturn(input, remaining);
  if (parameters.refundMethod === 'store-credit' && (!source.customer?.gid || !source.total || compareMoney(source.total, { amount: '0', currency: source.total.currency }) <= 0)) {
    throw new Error('A store-credit refund requires an exact existing source customer and a positive source total.');
  }
  const intent = createIntent(parameters, request, udid, source.total?.currency ?? 'USD', source);
  const intentHash = hashIntent(intent);
  await context.step('verify-pos-context', async () => context.assertAllowedIntent(intent, await driver.readContextEvidence()));
  await context.step('prepare-return-cart', () => driver.prepareReturn(parameters, source));
  await context.step('select-cash-refund', () => driver.selectCash());
  const observed = await context.step('verify-return-summary', () => driver.readSummary());
  assertReturnPrecommit(observed, parameters);
  if (parameters.refundMethod === 'store-credit') {
    if (compareMoney(observed.refund, { amount: '0', currency: observed.refund.currency }) <= 0) throw new Error('The native store-credit refund must be positive.');
    assertWithinMaximum(observed.refund, intent.maximumAbsoluteAmount);
  }
  await context.step('verify-pos-context-before-commit', async () => context.assertAllowedIntent(intent, await driver.readContextEvidence()));
  await context.step('commit-return-cash', () => driver.commitCash(() => context.recordCommitAttempt(intentHash)));
  const after = await context.step('read-shopify-return', () => context.readShopifyOrder(parameters.orderGid));
  await context.step('verify-shopify-return', async () => {
    const verification = verifyReturnedOrder(source, after, parameters, observed.refund);
    if (!verification.passed) throw new Error(`Shopify return read-back failed: ${verification.checks.filter(check => !check.passed).map(check => check.name).join(', ')}.`);
  });
  const ids = affectedIds(source, after);
  for (const [kind, values] of Object.entries(ids)) for (const gid of values) await context.recordResource(kind, gid);
  await context.recordBusinessEffect('confirmed', intentHash);
  return { orderGid: parameters.orderGid, affectedIds: ids };
}
