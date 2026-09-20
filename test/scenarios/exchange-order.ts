import type { OmsShopifyOrderDetail, RunRequest } from '../../shared/contracts.ts';
import type { TransactionIntent } from '../../shared/transaction.ts';
import { hashIntent } from '../../core/safety/intent.ts';
import type { PosContextEvidence } from '../../core/safety/environment.ts';
import { isValidTargetContext } from '../../core/safety/environment.ts';
import { assertExchangePrecommit, type ObservedExchangeSummary } from '../../core/safety/transaction-flow.ts';
import { validateExchange, type ExchangeParameters } from '../../core/safety/transaction-inputs.ts';
import { verifyExchangedOrder } from '../../core/verification/order.ts';
import type { ScenarioContext } from '../support/context.ts';
import { affectedIds, isCashOrder } from './return-order.ts';

export interface ExchangeOrderDriver {
  readContextEvidence(): Promise<PosContextEvidence>;
  prepareExchange(parameters: ExchangeParameters): Promise<void>;
  selectCash(): Promise<void>;
  readSummary(): Promise<ObservedExchangeSummary>;
  commitCash(): Promise<void>;
}

function createIntent(parameters: ExchangeParameters, request: RunRequest, udid: string): TransactionIntent {
  if (!isValidTargetContext(request.context)) throw new Error('An exchange run requires an exact frozen target context.');
  if (!udid.trim()) throw new Error('The exchange run has no observed iPad identity.');
  return {
    scenario: 'pos.exchange-cash-order',
    sourceHash: request.expectedRevision,
    udid,
    context: request.context,
    originalOrderGid: parameters.orderGid,
    returnLines: parameters.lines,
    purchaseLines: parameters.replacements,
    tender: 'cash',
    expectedDirection: parameters.direction,
    maximumAbsoluteAmount: parameters.maximumDifference,
  };
}

export async function exchangeCashOrder(
  input: ExchangeParameters,
  request: RunRequest,
  context: ScenarioContext,
  driver: ExchangeOrderDriver,
  udid = process.env.IOS_UDID?.trim() ?? '',
): Promise<{ sourceOrderGid: string; affectedIds: Record<string, string[]>; netDue: { amount: string; currency: string } }> {
  const source = await context.step('read-exchange-source', () => context.readShopifyOrder(input.orderGid));
  if (!isCashOrder(source)) throw new Error('The selected source order is not an exact cash-only Shopify order.');
  const remaining = Object.fromEntries(source.lines.map(line => [line.gid, line.refundableQuantity ?? -1]));
  const parameters = validateExchange(input, remaining);
  const intent = createIntent(parameters, request, udid);
  const intentHash = hashIntent(intent);
  await context.step('verify-pos-context', async () => context.assertAllowedIntent(intent, await driver.readContextEvidence()));
  await context.step('prepare-exchange-cart', () => driver.prepareExchange(parameters));
  await context.step('select-cash-exchange', () => driver.selectCash());
  const observed = await context.step('verify-exchange-summary', () => driver.readSummary());
  assertExchangePrecommit(observed, parameters);
  const approval = await context.requireApproval(intent);
  if (approval.intentHash !== intentHash) throw new Error('The approval checkpoint does not match the frozen exchange intent.');
  await context.step('verify-pos-context-before-commit', async () => context.assertAllowedIntent(intent, await driver.readContextEvidence()));
  await context.recordCommitAttempt(intentHash);
  await context.step('commit-exchange-cash', () => driver.commitCash());
  const after = await context.step('read-shopify-exchange', () => context.readShopifyOrder(parameters.orderGid));
  await context.step('verify-shopify-exchange', async () => {
    const verification = verifyExchangedOrder(source, after, parameters);
    if (!verification.passed) throw new Error(`Shopify exchange read-back failed: ${verification.checks.filter(check => !check.passed).map(check => check.name).join(', ')}.`);
  });
  const ids = affectedIds(source, after);
  for (const [kind, values] of Object.entries(ids)) for (const gid of values) await context.recordResource(kind, gid);
  await context.recordBusinessEffect('confirmed', intentHash);
  return { sourceOrderGid: parameters.orderGid, affectedIds: ids, netDue: observed.netDue };
}
