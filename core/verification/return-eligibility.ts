import type { OmsShopifyOrderDetail } from '../../shared/contracts.ts';

export interface ReturnEligibility {
  eligible: boolean;
  reasons: string[];
  lines: { lineGid: string; remaining: number }[];
  tender: string;
}

export function readReturnEligibility(order: OmsShopifyOrderDetail, tender: string): ReturnEligibility {
  const reasons: string[] = [];
  const lines: { lineGid: string; remaining: number }[] = [];
  if (!/^gid:\/\/shopify\/Order\/[A-Za-z0-9_-]+$/.test(order.gid)) reasons.push('The source order identity is invalid.');
  if (order.nextCursor) reasons.push('Load all source order lines before checking return eligibility.');
  if (tender !== 'cash') reasons.push('Only a cash original tender is supported for the first return release.');
  for (const line of order.lines) {
    const remaining = line.refundableQuantity;
    if (!Number.isSafeInteger(remaining) || remaining === null || remaining < 0 || remaining > line.quantity) {
      reasons.push(`The refundable quantity for ${line.gid} is missing or invalid.`);
      continue;
    }
    if (remaining > 0) lines.push({ lineGid: line.gid, remaining });
  }
  if (!lines.length) reasons.push('The source order has no remaining eligible lines.');
  return { eligible: reasons.length === 0, reasons, lines, tender };
}
