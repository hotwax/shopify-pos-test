import type { Money } from '../../shared/contracts.ts';
import type { ReturnReason } from '../../shared/return-reason.ts';
import type { CreateOrderParameters, ExchangeParameters, ReturnParameters } from './transaction-inputs.ts';
import { assertExchangeDirection } from './transaction-inputs.ts';
import { compareMoney } from './money.ts';

export interface ObservedCreateSummary {
  lines: { variantGid: string; quantity: number }[];
  total: Money;
  tender: string;
}

export interface ObservedReturnSummary {
  /**
   * What POS is actually showing, mapped back to Shopify line GIDs by the
   * driver. `reason` is what the per-line control reads AFTER configuration,
   * so an unset or mis-targeted reason is caught before anything commits.
   */
  lines: { lineGid: string; quantity: number; restock: boolean; reason?: ReturnReason }[];
  refund: Money;
  tender: string;
}

export interface ObservedExchangeSummary {
  returnLines: { lineGid: string; quantity: number; restock: boolean; reason?: ReturnReason }[];
  purchaseLines: { variantGid: string; quantity: number }[];
  netDue: Money;
  tender: string;
}

function sameLines<T extends { quantity: number }>(actual: T[], expected: T[], key: keyof T): boolean {
  if (actual.length !== expected.length) return false;
  const values = new Map(actual.map(line => [String(line[key]), line.quantity]));
  return new Set(actual.map(line => String(line[key]))).size === actual.length && expected.every(line => values.get(String(line[key])) === line.quantity);
}

export function assertCreatePrecommit(actual: ObservedCreateSummary, expected: CreateOrderParameters): void {
  if (!sameLines(actual.lines, expected.lines, 'variantGid')) throw new Error('The POS cart does not match the approved create-order lines.');
  if (actual.tender !== 'cash') throw new Error('The POS checkout tender is not approved cash.');
  if (actual.total.currency !== expected.currency || compareMoney(actual.total, { amount: '0', currency: actual.total.currency }) <= 0) throw new Error('The POS cart total is not a positive amount in the expected currency.');
}

/**
 * Compares what POS is showing against the approved return, keyed by line GID
 * rather than by array position: POS orders its panels by the order's own line
 * order, which need not be the order the operator selected them in, and an
 * index comparison would reject a correct cart or, worse, pair line A's
 * quantity with line B's restock choice.
 */
export function assertReturnPrecommit(actual: ObservedReturnSummary, expected: ReturnParameters, expectedTender: string = expected.refundMethod): void {
  if (actual.lines.length !== expected.lines.length) throw new Error(`The POS return summary shows ${actual.lines.length} line(s) but ${expected.lines.length} were approved.`);
  const observed = new Map(actual.lines.map(line => [line.lineGid, line]));
  if (observed.size !== actual.lines.length) throw new Error('The POS return summary repeats a source line, so it cannot be matched to the approved plan.');
  for (const line of expected.lines) {
    const seen = observed.get(line.lineGid);
    if (!seen) throw new Error('The POS return summary is missing an approved source line.');
    if (seen.quantity !== line.quantity) throw new Error(`The POS return summary shows quantity ${seen.quantity} for a line approved at ${line.quantity}.`);
    if (seen.restock !== line.restock) throw new Error(`The POS return summary shows restock ${seen.restock ? 'on' : 'off'} for a line approved as ${line.restock ? 'on' : 'off'}.`);
    // Only checked when the driver could read it back, so a surface that does
    // not expose the reason cannot silently pass a wrong one.
    if (seen.reason !== undefined && seen.reason !== line.reason) throw new Error(`The POS return summary shows reason ${seen.reason} for a line approved as ${line.reason}.`);
  }
  // The approved refund method, not a hardcoded "cash": a gift-card refund is
  // still a cash-order scenario, and POS names the method it is about to use.
  if (actual.tender !== expectedTender) throw new Error(`The POS tender reads "${actual.tender}" but "${expectedTender}" was approved.`);
  if (compareMoney(actual.refund, { amount: '0', currency: actual.refund.currency }) < 0) throw new Error('The POS refund is negative.');
}

/**
 * Which tender an exchange is about to use depends on which way the money
 * moves: a refund goes back by the approved refund method, a collect is taken
 * by the approved collect method, and an even exchange touches no tender at
 * all, so the driver reports "none" and POS must agree.
 */
export function exchangeTender(expected: ExchangeParameters): string {
  if (expected.direction === 'refund') return expected.refundMethod;
  if (expected.direction === 'collect') return expected.collectMethod;
  return 'none';
}

export function assertExchangePrecommit(actual: ObservedExchangeSummary, expected: ExchangeParameters): void {
  assertReturnPrecommit({ lines: actual.returnLines, refund: { amount: '0', currency: actual.netDue.currency }, tender: actual.tender }, expected, exchangeTender(expected));
  if (!sameLines(actual.purchaseLines, expected.replacements, 'variantGid')) throw new Error('The POS exchange replacement lines do not match the approved intent.');
  assertExchangeDirection(actual.netDue, expected.direction, expected.maximumDifference);
}
