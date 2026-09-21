import type { Money, TargetContext } from './contracts.ts';
import type { ReturnReason } from './return-reason.ts';

export interface TransactionIntent {
  scenario: string;
  sourceHash: string;
  udid: string;
  context: TargetContext;
  originalOrderGid?: string;
  originalOrderReference?: string;
  /**
   * Every per-line choice the operator made is part of the frozen identity, so
   * the ledger hash changes if the restock, reason or note changes. Otherwise
   * two materially different returns would share one intent hash.
   */
  returnLines: { lineGid: string; quantity: number; restock: boolean; reason?: ReturnReason; note?: string }[];
  purchaseLines: { variantGid: string; quantity: number }[];
  tender: 'cash';
  /** How the money goes back on a refund, and how a difference is collected. */
  refundMethod?: 'cash' | 'gift-card';
  collectMethod?: 'cash';
  /** What the exchange does with the source order's customer. */
  customer?: { action: 'keep' | 'remove' | 'replace'; gid?: string };
  expectedDirection: 'collect' | 'even' | 'refund';
  maximumAbsoluteAmount: Money;
}
