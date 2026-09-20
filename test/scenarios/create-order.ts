import type { RunRequest } from '../../shared/contracts.ts';
import type { TransactionIntent } from '../../shared/transaction.ts';
import { hashIntent } from '../../core/safety/intent.ts';
import { isValidTargetContext } from '../../core/safety/environment.ts';
import { assertCreatePrecommit, type ObservedCreateSummary } from '../../core/safety/transaction-flow.ts';
import { validateCreateOrder, type CreateOrderParameters } from '../../core/safety/transaction-inputs.ts';
import { verifyCreatedOrder } from '../../core/verification/order.ts';
import type { ScenarioContext } from '../support/context.ts';

export interface CreateOrderDriver {
  prepareCart(parameters: CreateOrderParameters): Promise<void>;
  selectCash(): Promise<void>;
  readSummary(): Promise<ObservedCreateSummary>;
  commitCash(): Promise<void>;
  readCompletedOrderName(): Promise<string>;
}

function createIntent(parameters: CreateOrderParameters, request: RunRequest, udid: string): TransactionIntent {
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
    maximumAbsoluteAmount: parameters.maximumTotal,
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
  const intent = createIntent(parameters, request, udid);
  const intentHash = hashIntent(intent);
  await context.step('prepare-cash-order-cart', () => driver.prepareCart(parameters));
  await context.step('select-cash-tender', () => driver.selectCash());
  const observed = await context.step('verify-create-cart', () => driver.readSummary());
  assertCreatePrecommit(observed, parameters);
  const approval = await context.requireApproval(intent);
  if (approval.intentHash !== intentHash) throw new Error('The approval checkpoint does not match the frozen create-order intent.');
  await context.recordCommitAttempt(intentHash);
  await context.step('commit-cash-order', () => driver.commitCash());
  const orderName = (await driver.readCompletedOrderName()).trim();
  if (!orderName || orderName.length > 120) throw new Error('The completed POS order did not expose a bounded order reference.');
  const observedOrder = await context.resolveObservedOrder({ observedName: orderName, runMarker: intentHash.slice(0, 12) });
  await context.step('verify-shopify-create', async () => {
    const readback = await context.readShopifyOrder(observedOrder.orderGid);
    const verification = verifyCreatedOrder(readback, parameters, observed.tender);
    if (!verification.passed) throw new Error(`Shopify create-order read-back failed: ${verification.checks.filter(check => !check.passed).map(check => check.name).join(', ')}.`);
  });
  await context.recordResource('shopify-order', observedOrder.orderGid);
  await context.recordBusinessEffect('confirmed', intentHash);
  return observedOrder;
}
