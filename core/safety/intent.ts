import { createHash } from 'node:crypto';
import type { TargetContext } from '../../shared/contracts.ts';
import type { TransactionIntent } from '../../shared/transaction.ts';
import { assertAllowedTarget, type PosContextEvidence } from './environment.ts';
import { assertWithinMaximum } from './money.ts';

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}

export function hashIntent(intent: TransactionIntent): string {
  return createHash('sha256').update(JSON.stringify(canonical(intent))).digest('hex');
}

function assertLines(lines: { lineGid?: string; variantGid?: string; quantity: number }[], label: string): void {
  for (const line of lines) {
    if (!(line.lineGid || line.variantGid) || !Number.isSafeInteger(line.quantity) || line.quantity <= 0) throw new Error(`${label} must contain positive integer quantities and exact IDs.`);
  }
}

export function assertAllowedIntent(intent: TransactionIntent, evidence: PosContextEvidence, approvedTargets: TargetContext[], now = Date.now()): void {
  if (!intent.scenario || !intent.sourceHash) throw new Error('Transaction intent is not frozen to a reviewed source.');
  if (intent.tender !== 'cash') throw new Error('Only cash tender is approved for the first transaction release.');
  if (!['collect', 'even', 'refund'].includes(intent.expectedDirection)) throw new Error('Transaction direction is invalid.');
  assertLines(intent.returnLines, 'Return lines');
  assertLines(intent.purchaseLines, 'Purchase lines');
  if (!intent.returnLines.length && !intent.purchaseLines.length) throw new Error('Transaction intent contains no exact lines.');
  if (!intent.udid || intent.udid !== evidence.udid) throw new Error('The selected iPad does not match the observed POS device.');
  assertWithinMaximum({ amount: '0', currency: intent.maximumAbsoluteAmount.currency }, intent.maximumAbsoluteAmount);
  assertAllowedTarget(intent.context, evidence, approvedTargets, now);
}
