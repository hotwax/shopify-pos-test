import type { Money, TargetContext } from '../shared/contracts.ts';
import { defaultReturnReason } from '../shared/return-reason.ts';
import { isValidTargetContext } from '../core/safety/environment.ts';
import { validateCreateOrder, validateExchange, validateReturn, type CreateOrderParameters, type ExchangeParameters, type ReturnParameters } from '../core/safety/transaction-inputs.ts';

export type MutationScenarioId = 'pos.create-cash-order' | 'pos.return-cash-order' | 'pos.exchange-cash-order';

export interface PosPlanInput {
  scenario: MutationScenarioId;
  currency: string;
  maximumDifference: string;
  variantGid: string;
  productGid: string;
  search: string;
  quantity: string;
  lines?: { variantGid: string; productGid: string; search: string; quantity: string; imageUrl?: string | null; variantSelection?: string }[];
  orderGid: string;
  orderReference: string;
  lineGid: string;
  returnQuantity: string;
  restock: boolean;
  replacementVariantGid: string;
  replacementProductGid: string;
  replacementSearch: string;
  replacementQuantity: string;
  direction: ExchangeParameters['direction'];
  note: string;
  remaining: Record<string, number>;
}

export type BuiltMutationParameters = CreateOrderParameters | ReturnParameters | ExchangeParameters;

const orderGid = /^gid:\/\/shopify\/Order\/[A-Za-z0-9_-]+$/;
const lineGid = /^gid:\/\/shopify\/LineItem\/[A-Za-z0-9_-]+$/;
const variantGid = /^gid:\/\/shopify\/ProductVariant\/[A-Za-z0-9_-]+$/;
const productGid = /^gid:\/\/shopify\/Product\/[A-Za-z0-9_-]+$/;
const amount = /^(?:0|[1-9]\d*)(?:\.\d{1,4})?$/;

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
        ...(line.variantSelection !== undefined ? { variantSelection: line.variantSelection as CreateOrderParameters['lines'][number]['variantSelection'] } : {}),
      })),
      currency: input.currency.trim().toUpperCase(),
      ...(input.note.trim() ? { note: input.note.trim() } : {}),
    };
    return validateCreateOrder(parameters);
  }

  const returnParameters: ReturnParameters = {
    orderGid: exact(input.orderGid, orderGid, 'The source order'),
    orderReference: input.orderReference.trim(),
    lines: [{ lineGid: exact(input.lineGid, lineGid, 'The source line'), quantity: quantity(input.returnQuantity, 'The return line'), restock: input.restock, reason: defaultReturnReason }],
    refundMethod: 'cash',
  };
  if (input.scenario === 'pos.return-cash-order') return validateReturn(returnParameters, input.remaining);

  const parameters: ExchangeParameters = {
    ...returnParameters,
    replacements: [{
      variantGid: exact(input.replacementVariantGid, variantGid, 'The replacement variant'),
      productGid: exact(input.replacementProductGid, productGid, 'The replacement product'),
      search: input.replacementSearch.trim(),
      quantity: quantity(input.replacementQuantity, 'The replacement line'),
    }],
    direction: input.direction,
    maximumDifference: money(input.maximumDifference, input.currency, 'The maximum exchange difference'),
    collectMethod: 'cash',
  };
  return validateExchange(parameters, input.remaining);
}

export function buildTargetContext(input: TargetContext): TargetContext {
  const context = { ...input };
  if (!isValidTargetContext(context)) throw new Error('The selected OMS shop and POS location do not form a valid frozen target context.');
  return context;
}
