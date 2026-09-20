import type { Money } from '../../shared/contracts.ts';
import { assertWithinMaximum, compareMoney, exchangeDirection } from './money.ts';

export interface CreateOrderParameters {
  lines: { variantGid: string; quantity: number }[];
  maximumTotal: Money;
  note?: string;
}

export interface ReturnParameters {
  orderGid: string;
  lines: { lineGid: string; quantity: number; restock: boolean }[];
  reason?: string;
  maximumRefund: Money;
}

export interface ExchangeParameters extends ReturnParameters {
  replacements: { variantGid: string; quantity: number }[];
  direction: 'collect' | 'even' | 'refund';
  maximumDifference: Money;
}

const orderGid = /^gid:\/\/shopify\/Order\/[A-Za-z0-9_-]+$/;
const lineGid = /^gid:\/\/shopify\/LineItem\/[A-Za-z0-9_-]+$/;
const variantGid = /^gid:\/\/shopify\/ProductVariant\/[A-Za-z0-9_-]+$/;

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
    return { variantGid: line.variantGid, quantity: positiveQuantity(line.quantity, 'Create-order line') };
  });
  unique(lines.map(line => line.variantGid), 'Create-order lines');
  const maximumTotal = nonNegativeMoney(input.maximumTotal, 'The maximum order total');
  if (input.note !== undefined && (typeof input.note !== 'string' || input.note.length > 200)) throw new Error('The order note is too long.');
  return { lines, maximumTotal, ...(input.note === undefined ? {} : { note: input.note }) };
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
    return { lineGid: line.lineGid, quantity, restock: line.restock };
  });
  unique(result.map(line => line.lineGid), 'Return lines');
  return result;
}

export function validateReturn(input: ReturnParameters, remaining: Record<string, number>): ReturnParameters {
  if (!input || !orderGid.test(input.orderGid)) throw new Error('A return plan requires an exact Shopify order GID.');
  const lines = validateReturnLines(input.lines, remaining);
  const maximumRefund = nonNegativeMoney(input.maximumRefund, 'The maximum refund');
  if (input.reason !== undefined && (typeof input.reason !== 'string' || input.reason.length > 200)) throw new Error('The return reason is too long.');
  return { orderGid: input.orderGid, lines, maximumRefund, ...(input.reason === undefined ? {} : { reason: input.reason }) };
}

export function validateExchange(input: ExchangeParameters, remaining: Record<string, number>): ExchangeParameters {
  const returned = validateReturn(input, remaining);
  if (!Array.isArray(input.replacements) || !input.replacements.length) throw new Error('An exchange plan requires at least one replacement variant.');
  const replacements = input.replacements.map(line => {
    if (!line || !variantGid.test(line.variantGid)) throw new Error('Exchange replacements must contain exact Shopify product variant GIDs.');
    return { variantGid: line.variantGid, quantity: positiveQuantity(line.quantity, 'Replacement line') };
  });
  unique(replacements.map(line => line.variantGid), 'Exchange replacements');
  if (!['collect', 'even', 'refund'].includes(input.direction)) throw new Error('Exchange direction is invalid.');
  const maximumDifference = nonNegativeMoney(input.maximumDifference, 'The maximum exchange difference', true);
  return { ...returned, replacements, direction: input.direction, maximumDifference };
}

export function assertExchangeDirection(netDue: Money, expected: ExchangeParameters['direction'], maximumDifference: Money): void {
  if (exchangeDirection(netDue) !== expected) throw new Error('The actual exchange amount has a different direction than the approved plan.');
  assertWithinMaximum(netDue, maximumDifference);
}
