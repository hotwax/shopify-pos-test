import type { Money, TargetContext } from './contracts.ts';

export interface ApprovalSummary {
  scenario: string;
  direction: 'collect' | 'even' | 'refund';
  amount: Money;
  lineCount: number;
  sourceOrderGid?: string;
}

export interface TransactionIntent {
  scenario: string;
  sourceHash: string;
  udid: string;
  context: TargetContext;
  originalOrderGid?: string;
  returnLines: { lineGid: string; quantity: number; restock: boolean }[];
  purchaseLines: { variantGid: string; quantity: number }[];
  tender: 'cash';
  expectedDirection: 'collect' | 'even' | 'refund';
  maximumAbsoluteAmount: Money;
}
