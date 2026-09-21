import type { Money } from '../../shared/contracts.ts';

interface DecimalValue { sign: -1 | 0 | 1; coefficient: bigint; scale: number; currency: string }

function parseMoney(value: Money): DecimalValue {
  if (!/^[A-Z]{3}$/.test(value.currency)) throw new Error('Money currency must be an uppercase ISO-4217 code.');
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value.amount);
  if (!match || (match[3]?.length ?? 0) > 6) throw new Error('Money amount must be a plain decimal with at most six fractional digits.');
  const fraction = match[3] ?? '';
  const coefficient = BigInt(`${match[2]}${fraction}`);
  return { sign: coefficient === 0n ? 0 : match[1] ? -1 : 1, coefficient, scale: fraction.length, currency: value.currency };
}

function signedCoefficient(value: DecimalValue, scale: number): bigint {
  const coefficient = value.coefficient * 10n ** BigInt(scale - value.scale);
  return value.sign === -1 ? -coefficient : coefficient;
}

export function compareMoney(left: Money, right: Money): -1 | 0 | 1 {
  const a = parseMoney(left); const b = parseMoney(right);
  if (a.currency !== b.currency) throw new Error('Money currencies must match.');
  const scale = Math.max(a.scale, b.scale);
  const av = signedCoefficient(a, scale); const bv = signedCoefficient(b, scale);
  return av < bv ? -1 : av > bv ? 1 : 0;
}

export function absoluteMoney(value: Money): Money {
  parseMoney(value);
  return { amount: value.amount.replace(/^-/, ''), currency: value.currency };
}

export function exchangeDirection(netDue: Money): 'collect' | 'even' | 'refund' {
  const parsed = parseMoney(netDue);
  if (parsed.sign > 0) return 'collect';
  if (parsed.sign < 0) return 'refund';
  return 'even';
}

export function assertWithinMaximum(value: Money, maximum: Money): void {
  if (value.currency !== maximum.currency) throw new Error('The actual amount currency does not match the approved maximum currency.');
  if (compareMoney(absoluteMoney(value), absoluteMoney(maximum)) > 0) throw new Error('The actual amount exceeds the approved maximum.');
}
