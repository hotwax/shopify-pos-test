import type { OmsShopifyOrderDetail } from '../../shared/contracts.ts';
import type { CreateOrderParameters, ExchangeParameters, ReturnParameters } from '../safety/transaction-inputs.ts';
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

export function verifyReturnedOrder(before: OmsShopifyOrderDetail, after: OmsShopifyOrderDetail, expected: ReturnParameters): VerificationResult {
  const checks: VerificationCheck[] = [];
  checks.push(check('identity', before.gid === after.gid && before.gid === expected.orderGid, before.gid === after.gid ? 'The return read-back is for the approved source order.' : 'The return read-back is for a different order.'));
  const cash = after.paymentGatewayNames.some(gateway => gateway.trim().toLowerCase() === 'cash');
  checks.push(check('cash-tender', cash, cash ? 'The source order read-back reports cash.' : 'The source order read-back does not report the approved cash tender.'));
  checks.push(verifyReturnLines(before, after, expected));
  return { passed: checks.every(item => item.passed), checks };
}

export function verifyExchangedOrder(before: OmsShopifyOrderDetail, after: OmsShopifyOrderDetail, expected: ExchangeParameters): VerificationResult {
  const base = verifyReturnedOrder(before, after, expected);
  const sales = newAgreements(before, after).flatMap(agreement => agreement.sales)
    .filter(sale => sale.actionType.toUpperCase() === 'ORDER' && sale.variantGid);
  const replacements = expected.replacements.every(line => sales.filter(sale => sale.variantGid === line.variantGid).reduce((sum, sale) => sum + Math.abs(sale.quantity), 0) >= line.quantity);
  const checks = [...base.checks, check('exchange-lines', replacements, replacements ? 'The read-back agreements contain the exact replacement variants and quantities.' : 'The read-back agreements do not prove the exact replacement variants and quantities.')];
  return { passed: checks.every(item => item.passed), checks };
}
