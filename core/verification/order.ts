import type { OmsShopifyOrderDetail } from '../../shared/contracts.ts';
import type { CreateOrderParameters } from '../safety/transaction-inputs.ts';
import { compareMoney } from '../safety/money.ts';

export interface VerificationCheck {
  name: string;
  passed: boolean;
  message: string;
}

export interface VerificationResult {
  passed: boolean;
  checks: VerificationCheck[];
}

function check(name: string, passed: boolean, message: string): VerificationCheck {
  return { name, passed, message };
}

export function verifyCreatedOrder(actual: OmsShopifyOrderDetail, expected: CreateOrderParameters, tender: string): VerificationResult {
  const checks: VerificationCheck[] = [];
  checks.push(check('identity', /^gid:\/\/shopify\/Order\/[A-Za-z0-9_-]+$/.test(actual.gid) && Boolean(actual.name.trim()), 'The read-back order has a usable Shopify identity.'));
  const expectedLines = new Map(expected.lines.map(line => [line.variantGid, line.quantity]));
  const actualLines = new Map(actual.lines.map(line => [line.variantGid ?? '', line.quantity]));
  const linesMatch = actual.lines.length === expected.lines.length && expectedLines.size === expected.lines.length && [...expectedLines].every(([gid, quantity]) => actualLines.get(gid) === quantity);
  checks.push(check('lines', linesMatch, linesMatch ? 'The read-back order contains the expected variants and quantities.' : 'The read-back order lines do not match the approved intent.'));
  const totalMatch = actual.total !== null && actual.total.currency === expected.maximumTotal.currency && compareMoney(actual.total, { amount: '0', currency: expected.maximumTotal.currency }) >= 0 && compareMoney(actual.total, expected.maximumTotal) <= 0;
  checks.push(check('total', totalMatch, totalMatch ? 'The read-back total is within the approved currency and amount bound.' : 'The read-back total is missing, in a different currency, negative or over the approved bound.'));
  const cash = tender === 'cash';
  checks.push(check('cash-tender', cash, cash ? 'The observed tender is cash.' : 'The observed tender is not the approved cash tender.'));
  return { passed: checks.every(item => item.passed), checks };
}
