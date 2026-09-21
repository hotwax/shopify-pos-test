import type { Money } from '../../shared/contracts.ts';
import type { CreateOrderParameters, ExchangeParameters, ReturnParameters } from './transaction-inputs.ts';
import { assertExchangeDirection } from './transaction-inputs.ts';
import { compareMoney } from './money.ts';

export interface ObservedCreateSummary {
  lines: { variantGid: string; quantity: number }[];
  total: Money;
  tender: string;
}

export interface ObservedReturnSummary {
  lines: { lineGid: string; quantity: number; restock: boolean }[];
  refund: Money;
  tender: string;
}

export interface ObservedExchangeSummary {
  returnLines: { lineGid: string; quantity: number; restock: boolean }[];
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

export function assertReturnPrecommit(actual: ObservedReturnSummary, expected: ReturnParameters): void {
  if (actual.lines.length !== expected.lines.length || actual.lines.some((line, index) => line.lineGid !== expected.lines[index]?.lineGid || line.quantity !== expected.lines[index]?.quantity || line.restock !== expected.lines[index]?.restock)) throw new Error('The POS return summary does not match the approved source lines or restock choices.');
  if (actual.tender !== 'cash') throw new Error('The POS refund tender is not approved cash.');
  if (compareMoney(actual.refund, { amount: '0', currency: actual.refund.currency }) < 0) throw new Error('The POS refund is negative.');
}

export function assertExchangePrecommit(actual: ObservedExchangeSummary, expected: ExchangeParameters): void {
  assertReturnPrecommit({ lines: actual.returnLines, refund: { amount: '0', currency: actual.netDue.currency }, tender: actual.tender }, expected);
  if (!sameLines(actual.purchaseLines, expected.replacements, 'variantGid')) throw new Error('The POS exchange replacement lines do not match the approved intent.');
  assertExchangeDirection(actual.netDue, expected.direction, expected.maximumDifference);
}
