import type { OmsShopifyOrderDetail, RunRequest } from '../../shared/contracts.ts';
import type { TransactionIntent } from '../../shared/transaction.ts';
import { hashIntent } from '../../core/safety/intent.ts';
import type { PosContextEvidence } from '../../core/safety/environment.ts';
import { isValidTargetContext } from '../../core/safety/environment.ts';
import { assertReturnPrecommit, type ObservedReturnSummary } from '../../core/safety/transaction-flow.ts';
import { validateReturn, type ReturnParameters } from '../../core/safety/transaction-inputs.ts';
import { verifyReturnedOrder } from '../../core/verification/order.ts';
import type { ScenarioContext } from '../support/context.ts';

export interface ReturnOrderDriver {
  readContextEvidence(): Promise<PosContextEvidence>;
  prepareReturn(parameters: ReturnParameters): Promise<void>;
  selectCash(): Promise<void>;
  readSummary(): Promise<ObservedReturnSummary>;
  commitCash(): Promise<void>;
}

export function isCashOrder(order: OmsShopifyOrderDetail): boolean {
  return order.paymentGatewayNames.length === 1 && order.paymentGatewayNames[0]?.trim().toLowerCase() === 'cash';
}

function createIntent(parameters: ReturnParameters, request: RunRequest, udid: string, currency = 'USD'): TransactionIntent {
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
    expectedDirection: 'refund',
    maximumAbsoluteAmount: { amount: '0', currency },
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
  const intent = createIntent(parameters, request, udid, source.total?.currency ?? 'USD');
  const intentHash = hashIntent(intent);
  await context.step('verify-pos-context', async () => context.assertAllowedIntent(intent, await driver.readContextEvidence()));
  await context.step('prepare-return-cart', () => driver.prepareReturn(parameters));
  await context.step('select-cash-refund', () => driver.selectCash());
  const observed = await context.step('verify-return-summary', () => driver.readSummary());
  assertReturnPrecommit(observed, parameters);
  await context.step('verify-pos-context-before-commit', async () => context.assertAllowedIntent(intent, await driver.readContextEvidence()));
  await context.recordCommitAttempt(intentHash);
  await context.step('commit-return-cash', () => driver.commitCash());
  const after = await context.step('read-shopify-return', () => context.readShopifyOrder(parameters.orderGid));
  await context.step('verify-shopify-return', async () => {
    const verification = verifyReturnedOrder(source, after, parameters);
    if (!verification.passed) throw new Error(`Shopify return read-back failed: ${verification.checks.filter(check => !check.passed).map(check => check.name).join(', ')}.`);
  });
  const ids = affectedIds(source, after);
  for (const [kind, values] of Object.entries(ids)) for (const gid of values) await context.recordResource(kind, gid);
  await context.recordBusinessEffect('confirmed', intentHash);
  return { orderGid: parameters.orderGid, affectedIds: ids };
}
