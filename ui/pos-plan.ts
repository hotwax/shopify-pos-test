import type { Money, TargetContext } from '../shared/contracts.ts';
import { isValidTargetContext } from '../core/safety/environment.ts';
import { validateCreateOrder, validateExchange, validateReturn, type CreateOrderParameters, type CustomerAction, type ExchangeParameters, type RefundMethod, type ReturnParameters } from '../core/safety/transaction-inputs.ts';
import { isReturnReason, type ReturnReason } from '../shared/return-reason.ts';

/**
 * Every scenario the planner can build parameters for. `pos.rehearse-return`
 * takes exactly the same parameters as a return because it IS a return, up to
 * but not including the refund; planning them separately would let a rehearsal
 * pass with a plan the real return would reject, which defeats the point.
 */
export type MutationScenarioId = 'pos.create-cash-order' | 'pos.return-cash-order' | 'pos.rehearse-return' | 'pos.exchange-cash-order' | 'pos.rehearse-exchange';

export interface PosPlanInput {
  scenario: MutationScenarioId;
  currency: string;
  maximumDifference: string;
  variantGid: string;
  productGid: string;
  search: string;
  quantity: string;
  /**
   * Cart lines for a create-order plan. When present and non-empty this wins
   * over the single `variantGid`/`quantity` pair, so a multi-item cart is
   * frozen as the operator built it. The safety layer already dedupes and
   * bounds every line.
   */
  lines?: { variantGid: string; productGid: string; search: string; quantity: string; imageUrl?: string | null; variantSelection?: string }[];
  orderGid: string;
  orderReference: string;
  /**
   * Return lines as the operator selected them. POS asks for restock, reason
   * and note PER LINE, so the plan carries them per line too. When empty the
   * legacy single-line fields below are used, which keeps older saved inputs
   * and the unit tests working.
   */
  returnLines?: { lineGid: string; quantity: string; restock: boolean; reason?: string; note?: string }[];
  refundMethod?: string;
  lineGid: string;
  returnQuantity: string;
  restock: boolean;
  returnReason?: string;
  returnNote?: string;
  /** Replacement items, carrying the same identifiers a create-order line does. */
  replacements?: { variantGid: string; productGid: string; search: string; quantity: string; variantSelection?: string }[];
  replacementVariantGid: string;
  replacementProductGid?: string;
  replacementSearch?: string;
  replacementQuantity: string;
  direction: ExchangeParameters['direction'];
  customerAction?: string;
  customerGid?: string;
  note: string;
  remaining: Record<string, number>;
}

export type BuiltMutationParameters = CreateOrderParameters | ReturnParameters | ExchangeParameters;

const orderGid = /^gid:\/\/shopify\/Order\/[A-Za-z0-9_-]+$/;
const lineGid = /^gid:\/\/shopify\/LineItem\/[A-Za-z0-9_-]+$/;
const variantGid = /^gid:\/\/shopify\/ProductVariant\/[A-Za-z0-9_-]+$/;
const productGid = /^gid:\/\/shopify\/Product\/[A-Za-z0-9_-]+$/;
const customerGid = /^gid:\/\/shopify\/Customer\/[A-Za-z0-9_-]+$/;
const amount = /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/;

function exact(value: string, pattern: RegExp, label: string): string {
  const result = value.trim();
  if (!pattern.test(result)) throw new Error(`${label} must be an exact Shopify GID.`);
  return result;
}

function quantity(value: string, label: string): number {
  const result = Number(value.trim());
  if (!Number.isSafeInteger(result) || result <= 0 || result > 100_000) throw new Error(`${label} quantity must be a positive integer.`);
  return result;
}

function money(value: string, currency: string, label: string): Money {
  const normalizedAmount = value.trim();
  const normalizedCurrency = currency.trim().toUpperCase();
  if (!amount.test(normalizedAmount) || !/^[A-Z]{3}$/.test(normalizedCurrency)) throw new Error(`${label} amount or currency is invalid.`);
  return { amount: normalizedAmount, currency: normalizedCurrency };
}

/**
 * The planner never silently invents a reason: an unset one means the operator
 * did not choose, and the safety layer fills in its own documented default.
 */
function returnReason(value: string | undefined): ReturnReason {
  if (value === undefined || value === '') return 'UNWANTED';
  if (!isReturnReason(value)) throw new Error('The return reason must be one of the ten Shopify return reasons.');
  return value;
}

function refundMethod(value: string | undefined): RefundMethod {
  if (value === undefined || value === '') return 'cash';
  if (value !== 'cash' && value !== 'gift-card') throw new Error('The refund method must be cash or gift-card.');
  return value;
}

function exchangeCustomer(action: string, gid: string | undefined): { action: CustomerAction; gid?: string } {
  if (action !== 'keep' && action !== 'remove' && action !== 'replace') throw new Error('The exchange customer action must be keep, remove or replace.');
  if (action !== 'replace') return { action };
  return { action, gid: exact(gid ?? '', customerGid, 'The replacement customer') };
}

export function buildMutationParameters(input: PosPlanInput): BuiltMutationParameters {
  if (input.scenario === 'pos.create-cash-order') {
    const cartLines = input.lines?.length ? input.lines : [{ variantGid: input.variantGid, productGid: input.productGid, search: input.search, quantity: input.quantity }];
    const parameters: CreateOrderParameters = {
      lines: cartLines.map(line => ({
        variantGid: exact(line.variantGid, variantGid, 'The product variant'),
        productGid: exact(line.productGid, productGid, 'The product'),
        search: (line.search ?? '').trim(),
        quantity: quantity(line.quantity, 'The create-order line'),
        ...(line.imageUrl ? { imageUrl: line.imageUrl } : {}),
        // Passed through as text; the safety layer rejects anything that is
        // not single, multi or unknown.
        ...(line.variantSelection !== undefined ? { variantSelection: line.variantSelection as CreateOrderParameters['lines'][number]['variantSelection'] } : {}),
      })),
      currency: input.currency.trim().toUpperCase(),
      ...(input.note.trim() ? { note: input.note.trim() } : {}),
    };
    return validateCreateOrder(parameters);
  }

  const configuredLines = input.returnLines?.length
    ? input.returnLines
    : [{ lineGid: input.lineGid, quantity: input.returnQuantity, restock: input.restock, reason: input.returnReason, note: input.returnNote }];

  const returnParameters: ReturnParameters = {
    orderGid: exact(input.orderGid, orderGid, 'The source order'),
    orderReference: input.orderReference.trim(),
    lines: configuredLines.map(line => ({
      lineGid: exact(line.lineGid, lineGid, 'The source line'),
      quantity: quantity(line.quantity, 'The return line'),
      restock: line.restock,
      reason: returnReason(line.reason),
      ...(line.note?.trim() ? { note: line.note.trim() } : {}),
    })),
    refundMethod: refundMethod(input.refundMethod),
  };
  if (input.scenario === 'pos.return-cash-order' || input.scenario === 'pos.rehearse-return') return validateReturn(returnParameters, input.remaining);

  const configuredReplacements = input.replacements?.length
    ? input.replacements
    : [{ variantGid: input.replacementVariantGid, productGid: input.replacementProductGid ?? '', search: input.replacementSearch ?? '', quantity: input.replacementQuantity }];

  const parameters: ExchangeParameters = {
    ...returnParameters,
    replacements: configuredReplacements.map(line => ({
      variantGid: exact(line.variantGid, variantGid, 'The replacement variant'),
      productGid: exact(line.productGid, productGid, 'The replacement product'),
      search: (line.search ?? '').trim(),
      quantity: quantity(line.quantity, 'The replacement line'),
      ...(line.variantSelection !== undefined ? { variantSelection: line.variantSelection as ExchangeParameters['replacements'][number]['variantSelection'] } : {}),
    })),
    direction: input.direction,
    maximumDifference: money(input.maximumDifference, input.currency, 'The maximum exchange difference'),
    collectMethod: 'cash',
    ...(input.customerAction ? { customer: exchangeCustomer(input.customerAction, input.customerGid) } : {}),
  };
  return validateExchange(parameters, input.remaining);
}

export function buildTargetContext(input: TargetContext): TargetContext {
  const context = { ...input };
  if (!isValidTargetContext(context)) throw new Error('The selected OMS shop and POS location do not form a valid frozen target context.');
  return context;
}
