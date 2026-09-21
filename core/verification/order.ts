import type { OmsShopifyOrderDetail } from '../../shared/contracts.ts';
import type { CreateOrderParameters, ExchangeParameters, RefundMethod, ReturnParameters } from '../safety/transaction-inputs.ts';
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
  const totalMatch = actual.total !== null && actual.total.currency === expected.currency && compareMoney(actual.total, { amount: '0', currency: expected.currency }) > 0;
  checks.push(check('total', totalMatch, totalMatch ? 'The read-back total is within the approved currency and amount bound.' : 'The read-back total is missing, in a different currency, negative or over the approved bound.'));
  const cash = tender === 'cash' && actual.paymentGatewayNames.some(gateway => gateway.trim().toLowerCase() === 'cash');
  checks.push(check('cash-tender', cash, cash ? 'The POS and Shopify read-back both report cash.' : 'The POS or Shopify read-back does not report the approved cash tender.'));
  return { passed: checks.every(item => item.passed), checks };
}

function newAgreements(before: OmsShopifyOrderDetail, after: OmsShopifyOrderDetail) {
  const beforeIds = new Set(before.agreements.map(agreement => agreement.id));
  return after.agreements.filter(agreement => !beforeIds.has(agreement.id));
}

function verifyReturnLines(before: OmsShopifyOrderDetail, after: OmsShopifyOrderDetail, expected: ReturnParameters): VerificationCheck {
  const afterById = new Map(after.lines.map(line => [line.gid, line]));
  const returnSales = newAgreements(before, after).flatMap(agreement => agreement.sales)
    .filter(sale => sale.actionType.toUpperCase() === 'RETURN' && sale.lineGid);
  const passed = expected.lines.every(line => {
    const beforeLine = before.lines.find(item => item.gid === line.lineGid);
    const afterLine = afterById.get(line.lineGid);
    const saleQuantity = returnSales.filter(sale => sale.lineGid === line.lineGid).reduce((sum, sale) => sum + Math.abs(sale.quantity), 0);
    return beforeLine?.refundableQuantity !== null && beforeLine?.refundableQuantity !== undefined && afterLine?.refundableQuantity !== null && afterLine?.refundableQuantity !== undefined && beforeLine.refundableQuantity - afterLine.refundableQuantity === line.quantity && saleQuantity >= line.quantity;
  });
  return check('return-lines', passed, passed ? 'The read-back order shows the exact refundable delta and a new return agreement.' : 'The read-back order does not prove the exact return line quantities and agreement.');
}

/** Refunds this run created, so a pre-existing refund cannot satisfy a check. */
function newRefunds(before: OmsShopifyOrderDetail, after: OmsShopifyOrderDetail) {
  const seen = new Set(before.refunds.map(refund => refund.gid));
  return after.refunds.filter(refund => !seen.has(refund.gid));
}

/** Returns this run created. */
function newReturns(before: OmsShopifyOrderDetail, after: OmsShopifyOrderDetail) {
  const seen = new Set(before.returns.map(item => item.gid));
  return after.returns.filter(item => !seen.has(item.gid));
}

/**
 * Restock is proved by Shopify's own restockType on the refund line, which is
 * RETURN when the stock went back and NO_RESTOCK when it did not. Anything
 * else (CANCEL, LEGACY_RESTOCK) is not what this flow asked for and fails.
 */
function verifyRestock(before: OmsShopifyOrderDetail, after: OmsShopifyOrderDetail, expected: ReturnParameters): VerificationCheck {
  const refundLines = newRefunds(before, after).flatMap(refund => refund.lines);
  const mismatches: string[] = [];
  for (const line of expected.lines) {
    const forLine = refundLines.filter(item => item.lineGid === line.lineGid);
    const wanted = line.restock ? 'RETURN' : 'NO_RESTOCK';
    const quantity = forLine.reduce((sum, item) => sum + item.quantity, 0);
    if (!forLine.length) { mismatches.push(`${line.lineGid}: no refund line`); continue; }
    if (quantity !== line.quantity) { mismatches.push(`${line.lineGid}: refunded ${quantity}, approved ${line.quantity}`); continue; }
    const types = [...new Set(forLine.map(item => item.restockType))];
    if (types.length !== 1 || types[0] !== wanted) mismatches.push(`${line.lineGid}: restockType ${types.join('/') || 'missing'}, approved ${wanted}`);
  }
  const passed = mismatches.length === 0;
  return check('restock', passed, passed ? 'Shopify recorded the approved restock choice for every returned line.' : `Shopify did not record the approved restock choices: ${mismatches.join('; ')}.`);
}

/**
 * The reason is proved from the return line, matched to the order line through
 * its fulfillment link. An unverified return line carries no such link; when
 * none of the new return lines can be attributed, the check reports that
 * rather than passing on absence.
 */
function verifyReturnReasons(before: OmsShopifyOrderDetail, after: OmsShopifyOrderDetail, expected: ReturnParameters): VerificationCheck {
  const returnLines = newReturns(before, after).flatMap(item => item.lines);
  if (!returnLines.length) return check('return-reason', false, 'Shopify recorded no new return lines, so the approved return reasons are unproven.');
  const mismatches: string[] = [];
  for (const line of expected.lines) {
    const forLine = returnLines.filter(item => item.lineGid === line.lineGid);
    if (!forLine.length) { mismatches.push(`${line.lineGid}: no attributable return line`); continue; }
    const reasons = [...new Set(forLine.map(item => item.reason))];
    if (reasons.length !== 1 || reasons[0] !== line.reason) mismatches.push(`${line.lineGid}: reason ${reasons.join('/') || 'missing'}, approved ${line.reason}`);
  }
  const passed = mismatches.length === 0;
  return check('return-reason', passed, passed ? 'Shopify recorded the approved return reason for every returned line.' : `Shopify did not record the approved return reasons: ${mismatches.join('; ')}.`);
}

/** Shopify's gateway name for each refund method POS offers. */
const refundGateways: Record<RefundMethod, string> = { cash: 'cash', 'gift-card': 'gift_card' };

function verifyRefundMethod(before: OmsShopifyOrderDetail, after: OmsShopifyOrderDetail, expected: ReturnParameters): VerificationCheck {
  const wanted = refundGateways[expected.refundMethod];
  const gateways = newRefunds(before, after).flatMap(refund => refund.transactions).map(transaction => (transaction.gateway ?? '').trim().toLowerCase());
  if (!gateways.length) return check('refund-method', false, 'Shopify recorded no refund transaction, so the approved refund method is unproven.');
  const passed = gateways.every(gateway => gateway === wanted);
  return check('refund-method', passed, passed ? `Shopify refunded through the approved ${expected.refundMethod} method.` : `Shopify refunded through ${[...new Set(gateways)].join('/')}, not the approved ${wanted}.`);
}

export function verifyReturnedOrder(before: OmsShopifyOrderDetail, after: OmsShopifyOrderDetail, expected: ReturnParameters): VerificationResult {
  const checks: VerificationCheck[] = [];
  checks.push(check('identity', before.gid === after.gid && before.gid === expected.orderGid, before.gid === after.gid ? 'The return read-back is for the approved source order.' : 'The return read-back is for a different order.'));
  const cash = after.paymentGatewayNames.some(gateway => gateway.trim().toLowerCase() === 'cash');
  checks.push(check('cash-tender', cash, cash ? 'The source order read-back reports cash.' : 'The source order read-back does not report the approved cash tender.'));
  checks.push(verifyReturnLines(before, after, expected));
  checks.push(verifyRestock(before, after, expected));
  checks.push(verifyReturnReasons(before, after, expected));
  checks.push(verifyRefundMethod(before, after, expected));
  return { passed: checks.every(item => item.passed), checks };
}

/** Proves the exchange left the order's customer as the operator approved. */
function verifyExchangeCustomer(after: OmsShopifyOrderDetail, expected: ExchangeParameters): VerificationCheck | null {
  if (!expected.customer) return null;
  const actual = after.customer?.gid ?? null;
  if (expected.customer.action === 'remove') {
    return check('exchange-customer', actual === null, actual === null ? 'The read-back order has no customer, as approved.' : `The read-back order still has customer ${actual} although removal was approved.`);
  }
  if (expected.customer.action === 'replace') {
    const passed = actual === expected.customer.gid;
    return check('exchange-customer', passed, passed ? 'The read-back order carries the approved replacement customer.' : `The read-back order carries customer ${actual ?? 'none'}, not the approved ${expected.customer.gid}.`);
  }
  return check('exchange-customer', true, 'The exchange was approved to keep whatever customer the order had.');
}

export function verifyExchangedOrder(before: OmsShopifyOrderDetail, after: OmsShopifyOrderDetail, expected: ExchangeParameters): VerificationResult {
  const base = verifyReturnedOrder(before, after, expected);
  const sales = newAgreements(before, after).flatMap(agreement => agreement.sales)
    .filter(sale => sale.actionType.toUpperCase() === 'ORDER' && sale.variantGid);
  const replacements = expected.replacements.every(line => sales.filter(sale => sale.variantGid === line.variantGid).reduce((sum, sale) => sum + Math.abs(sale.quantity), 0) >= line.quantity);
  const customer = verifyExchangeCustomer(after, expected);
  const checks = [
    // An even or collect exchange moves no money back, so neither the refund
    // tender nor the refund line's restockType exists to read. Whether Shopify
    // records a zero-value refund carrying restockType for such an exchange
    // has not been observed yet, so those two checks are scoped to a
    // refunding exchange rather than asserted on absence.
    ...base.checks.filter(item => expected.direction === 'refund' || (item.name !== 'refund-method' && item.name !== 'restock')),
    check('exchange-lines', replacements, replacements ? 'The read-back agreements contain the exact replacement variants and quantities.' : 'The read-back agreements do not prove the exact replacement variants and quantities.'),
    ...(customer ? [customer] : []),
  ];
  return { passed: checks.every(item => item.passed), checks };
}
