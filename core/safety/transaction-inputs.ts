import type { Money } from '../../shared/contracts.ts';
import { isVariantSelection, type VariantSelection } from '../../shared/variant-selection.ts';
import { defaultReturnReason, isReturnReason, type ReturnReason } from '../../shared/return-reason.ts';
import { assertWithinMaximum, compareMoney, exchangeDirection } from './money.ts';

export interface CreateOrderParameters {
  /**
   * POS result rows are keyed by Shopify PRODUCT id, not variant id, so a line
   * carries both: the variant is the business identity that gets verified on
   * read-back, the product is what the native row selection matches on.
   */
  lines: {
    variantGid: string;
    productGid: string;
    search: string;
    quantity: number;
    imageUrl?: string;
    /**
     * Which POS add-to-cart routine the planner expects for this product:
     * `single` drops into the cart on the product tap, `multi` needs the exact
     * variant chosen from the picker, `unknown` makes the run observe. It is
     * normalized to `unknown` when a request predates the field.
     */
    variantSelection?: VariantSelection;
  }[];
  currency: string;
  note?: string;
}

/** How the money goes back. POS offers these on its refund-method chooser. */
export type RefundMethod = 'cash' | 'gift-card';
export const refundMethods: readonly RefundMethod[] = ['cash', 'gift-card'];

/** What the exchange does with the source order's customer. */
export type CustomerAction = 'keep' | 'remove' | 'replace';

export interface ReturnLineParameters {
  lineGid: string;
  quantity: number;
  restock: boolean;
  /**
   * Per line, because POS asks per line. Defaults to UNKNOWN, which is both
   * what POS records when nothing is chosen and a real Shopify enum value, so
   * the run can skip the picker entirely for an unconfigured line.
   */
  reason: ReturnReason;
  /** Free text POS keeps on the return line. */
  note?: string;
}

export interface ReturnParameters {
  orderGid: string;
  /** Human-facing POS order reference captured from the selected OMS/Shopify order. */
  orderReference?: string;
  lines: ReturnLineParameters[];
  refundMethod: RefundMethod;
}

export interface ExchangeParameters extends ReturnParameters {
  /**
   * Replacements carry the same identifiers a create-order line does, because
   * POS adds them through the same product search: the variant is the business
   * identity read back from Shopify, the product is what the search row is
   * matched on, and the selection says whether a variant picker is expected.
   */
  replacements: { variantGid: string; productGid: string; search: string; quantity: number; variantSelection?: VariantSelection }[];
  direction: 'collect' | 'even' | 'refund';
  maximumDifference: Money;
  /**
   * Only cash is automatable for collecting a difference: POS's other tenders
   * need a card reader, a card number, or a gift-card code Shopify will not
   * disclose. A non-cash REFUND is expressed by refundMethod instead.
   */
  collectMethod: 'cash';
  customer?: { action: CustomerAction; gid?: string };
}

const orderGid = /^gid:\/\/shopify\/Order\/[A-Za-z0-9_-]+$/;
const lineGid = /^gid:\/\/shopify\/LineItem\/[A-Za-z0-9_-]+$/;
const variantGid = /^gid:\/\/shopify\/ProductVariant\/[A-Za-z0-9_-]+$/;
const productGid = /^gid:\/\/shopify\/Product\/[A-Za-z0-9_-]+$/;
const customerGid = /^gid:\/\/shopify\/Customer\/[A-Za-z0-9_-]+$/;

function orderReference(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new Error('The POS order reference must be text.');
  const result = value.trim();
  if (!result || result.length > 120 || /[\0\r\n]/.test(result)) throw new Error('The POS order reference must be a bounded, single-line value.');
  return result;
}

function positiveQuantity(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0 || (value as number) > 100_000) throw new Error(`${label} quantity must be a positive safe integer.`);
  return value as number;
}

function nonNegativeMoney(value: Money, label: string, allowZero = false): Money {
  if (compareMoney(value, { amount: '0', currency: value.currency }) < 0 || (!allowZero && compareMoney(value, { amount: '0', currency: value.currency }) === 0)) throw new Error(`${label} must be ${allowZero ? 'zero or ' : ''}greater than zero.`);
  return { amount: value.amount, currency: value.currency };
}

function unique(values: string[], label: string): void {
  if (new Set(values).size !== values.length) throw new Error(`${label} contains duplicate IDs.`);
}

export function validateCreateOrder(input: CreateOrderParameters): CreateOrderParameters {
  if (!input || !Array.isArray(input.lines) || !input.lines.length) throw new Error('A create-order plan requires at least one variant line.');
  const lines = input.lines.map(line => {
    if (!line || !variantGid.test(line.variantGid)) throw new Error('Create-order lines must contain exact Shopify product variant GIDs.');
    if (!productGid.test(line.productGid)) throw new Error('Create-order lines must contain exact Shopify product GIDs so the native row can be matched by id.');
    const search = typeof line.search === 'string' ? line.search.trim() : '';
    if (!search || search.length > 60) throw new Error('Create-order lines must carry a bounded product search term.');
    // Display only: the runner never reads it and no check compares it.
    const imageUrl = typeof line.imageUrl === 'string' && /^https:\/\//.test(line.imageUrl) && line.imageUrl.length <= 500 ? line.imageUrl : undefined;
    if (line.variantSelection !== undefined && !isVariantSelection(line.variantSelection)) throw new Error('Create-order lines must declare the variant selection as single, multi or unknown.');
    const variantSelection: VariantSelection = line.variantSelection ?? 'unknown';
    return { variantGid: line.variantGid, productGid: line.productGid, search, quantity: positiveQuantity(line.quantity, 'Create-order line'), variantSelection, ...(imageUrl ? { imageUrl } : {}) };
  });
  unique(lines.map(line => line.variantGid), 'Create-order lines');
  const currency = typeof input.currency === 'string' ? input.currency.trim().toUpperCase() : '';
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error('A create-order plan requires an exact ISO currency.');
  if (input.note !== undefined && (typeof input.note !== 'string' || input.note.length > 200)) throw new Error('The order note is too long.');
  return { lines, currency, ...(input.note === undefined ? {} : { note: input.note }) };
}

function returnNote(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new Error('A return line note must be text.');
  const result = value.trim();
  if (!result) return undefined;
  if (result.length > 200 || /[\0\r\n]/.test(result)) throw new Error('A return line note must be a bounded, single-line value.');
  return result;
}

function validateReturnLines(lines: ReturnParameters['lines'], remaining: Record<string, number>): ReturnParameters['lines'] {
  if (!Array.isArray(lines) || !lines.length) throw new Error('A return plan requires at least one exact source line.');
  const result = lines.map(line => {
    if (!line || !lineGid.test(line.lineGid)) throw new Error('Return lines must contain exact Shopify order line GIDs.');
    const available = remaining[line.lineGid];
    if (!Number.isSafeInteger(available) || available <= 0) throw new Error('A return line is not eligible in the selected source order.');
    const quantity = positiveQuantity(line.quantity, 'Return line');
    if (quantity > available) throw new Error('A return line quantity exceeds the remaining eligible quantity.');
    if (typeof line.restock !== 'boolean') throw new Error('Each return line must declare its restock choice.');
    if (line.reason !== undefined && !isReturnReason(line.reason)) throw new Error('Each return line must carry a known Shopify return reason.');
    const note = returnNote(line.note);
    return { lineGid: line.lineGid, quantity, restock: line.restock, reason: line.reason ?? defaultReturnReason, ...(note === undefined ? {} : { note }) };
  });
  unique(result.map(line => line.lineGid), 'Return lines');
  return result;
}

function refundMethodOf(value: unknown): RefundMethod {
  if (value === undefined) return 'cash';
  if (typeof value !== 'string' || !refundMethods.includes(value as RefundMethod)) throw new Error('The refund method must be cash or gift-card.');
  return value as RefundMethod;
}

export function validateReturn(input: ReturnParameters, remaining: Record<string, number>): ReturnParameters {
  if (!input || !orderGid.test(input.orderGid)) throw new Error('A return plan requires an exact Shopify order GID.');
  const reference = orderReference(input.orderReference);
  const lines = validateReturnLines(input.lines, remaining);
  return { orderGid: input.orderGid, ...(reference === undefined ? {} : { orderReference: reference }), lines, refundMethod: refundMethodOf(input.refundMethod) };
}

function exchangeCustomer(value: ExchangeParameters['customer']): ExchangeParameters['customer'] {
  if (value === undefined) return undefined;
  if (!value || !['keep', 'remove', 'replace'].includes(value.action)) throw new Error('The exchange customer action must be keep, remove or replace.');
  if (value.action === 'replace') {
    if (!value.gid || !customerGid.test(value.gid)) throw new Error('Replacing the exchange customer requires an exact Shopify customer GID.');
    return { action: 'replace', gid: value.gid };
  }
  if (value.gid !== undefined) throw new Error('Only a replace action may carry a customer GID.');
  return { action: value.action };
}

export function validateExchange(input: ExchangeParameters, remaining: Record<string, number>): ExchangeParameters {
  const returned = validateReturn(input, remaining);
  if (!Array.isArray(input.replacements) || !input.replacements.length) throw new Error('An exchange plan requires at least one replacement variant.');
  const replacements = input.replacements.map(line => {
    if (!line || !variantGid.test(line.variantGid)) throw new Error('Exchange replacements must contain exact Shopify product variant GIDs.');
    if (!productGid.test(line.productGid)) throw new Error('Exchange replacements must contain exact Shopify product GIDs so the native search row can be matched by id.');
    const search = typeof line.search === 'string' ? line.search.trim() : '';
    if (!search || search.length > 60) throw new Error('Exchange replacements must carry a bounded product search term.');
    if (line.variantSelection !== undefined && !isVariantSelection(line.variantSelection)) throw new Error('Exchange replacements must declare the variant selection as single, multi or unknown.');
    return {
      variantGid: line.variantGid,
      productGid: line.productGid,
      search,
      quantity: positiveQuantity(line.quantity, 'Replacement line'),
      variantSelection: line.variantSelection ?? 'unknown',
    };
  });
  unique(replacements.map(line => line.variantGid), 'Exchange replacements');
  if (!['collect', 'even', 'refund'].includes(input.direction)) throw new Error('Exchange direction is invalid.');
  if (input.collectMethod !== undefined && input.collectMethod !== 'cash') throw new Error('Only a cash collect is automatable for an exchange difference.');
  const maximumDifference = nonNegativeMoney(input.maximumDifference, 'The maximum exchange difference', true);
  const customer = exchangeCustomer(input.customer);
  return { ...returned, replacements, direction: input.direction, maximumDifference, collectMethod: 'cash', ...(customer === undefined ? {} : { customer }) };
}

export function assertExchangeDirection(netDue: Money, expected: ExchangeParameters['direction'], maximumDifference: Money): void {
  if (exchangeDirection(netDue) !== expected) throw new Error('The actual exchange amount has a different direction than the approved plan.');
  assertWithinMaximum(netDue, maximumDifference);
}
