/** Only the combined row-label format observed in POS is supported. Fail closed
 * for new/localized/ambiguous formats instead of guessing an order reference. */
export function readRowReference(label: string | null): string {
  const parts = label?.split(' • ');
  if (!parts || parts.length !== 2 || !parts[0].trim() || !parts[1].trim() || /[\r\n]/.test(parts[0])) {
    throw new Error('Cannot read an unambiguous order reference from the row label; inspect this POS version.');
  }
  return parts[0].trim();
}

/** Normalize a reference supplied by the operator for an exact POS search. */
export function normalizeOrderReference(input: string): string {
  const value = input.trim();
  if (!value || value.length > 120 || /[\0\r\n]/.test(value)) {
    throw new Error('Enter one bounded, single-line order reference.');
  }
  return value;
}

/**
 * The newest-order read after a sale has to accept the row shape POS uses for
 * an order with no customer, which `readRowReference` deliberately rejects for
 * operator-selected rows. Observed on POS 11.14.0:
 *   "HCDEV#5856, Sep 20 at 7:55 PM, Paid, Unfulfilled, $171.00"
 *   "HCDEV#4989 • DIVYANSH BHARDWAJ, Apr 24 at 11:24 PM, Paid, Fulfilled, $240.00"
 * The reference is the text before the first comma, minus any " • customer".
 * The trailing money part is returned so the caller can prove the row is the
 * sale it just took. Anything else fails closed.
 */
export function readOrderRowSummary(label: string | null): { reference: string; amountLabel: string } {
  const parts = (label ?? '').split(',').map(part => part.trim());
  if (parts.length < 3 || /[\r\n]/.test(label ?? '')) throw new Error('Cannot read the order row summary from the row label; inspect this POS version.');
  const head = parts[0]!.split(' • ');
  const reference = head[0]!.trim();
  const amountLabel = parts[parts.length - 1]!;
  if (!reference || reference.length > 120 || head.length > 2 || !/^\$\s*[0-9][0-9,]*(?:\.[0-9]{2})?$/.test(amountLabel)) {
    throw new Error('Cannot read the order row summary from the row label; inspect this POS version.');
  }
  return { reference, amountLabel };
}
