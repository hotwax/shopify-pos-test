import type { Money, TargetContext } from './contracts.ts';

export interface TransactionIntent {
  scenario: string;
  sourceHash: string;
  udid: string;
  context: TargetContext;
  originalOrderGid?: string;
  originalOrderReference?: string;
  returnLines: { lineGid: string; quantity: number; restock: boolean }[];
  purchaseLines: { variantGid: string; quantity: number }[];
  tender: 'cash';
  expectedDirection: 'collect' | 'even' | 'refund';
  maximumAbsoluteAmount: Money;
}
