/**
 * Return reasons, in the two vocabularies that have to agree.
 *
 * Shopify's `ReturnReason` enum and Shopify POS's reason picker are the same
 * ten choices under different names. Both lists were read from the live
 * system on 2026-09-21: the enum by GraphQL introspection against the OMS
 * proxy (apiVersion 2026-01), the labels from the POS accessibility tree of
 * the return sheet (POS 11.14.0, run-1789960522048). Keeping the mapping in
 * one place is what lets the planner offer a choice, the native run tap the
 * matching POS button, and the Shopify read-back prove the reason that was
 * actually recorded.
 *
 * Shopify exposes the reason on a return line as the deprecated `returnReason`
 * field (the modern replacement, `returnReasonDefinition`, is an object). The
 * deprecated field still returns this enum on the pinned API version, so the
 * verifier reads it and this module is the only place the values live.
 */
export const returnReasons = [
  'SIZE_TOO_LARGE',
  'SIZE_TOO_SMALL',
  'COLOR',
  'STYLE',
  'UNWANTED',
  'NOT_AS_DESCRIBED',
  'WRONG_ITEM',
  'DEFECTIVE',
  'UNKNOWN',
  'OTHER',
] as const;

export type ReturnReason = typeof returnReasons[number];

/** The exact POS button name for each reason. Matched verbatim; never guessed. */
const posLabels: Record<ReturnReason, string> = {
  SIZE_TOO_LARGE: 'Too big',
  SIZE_TOO_SMALL: 'Too small',
  COLOR: 'Color',
  STYLE: 'Style',
  UNWANTED: 'Changed my mind',
  NOT_AS_DESCRIBED: 'Item not as described',
  WRONG_ITEM: 'Received the wrong item',
  DEFECTIVE: 'Damaged or defective',
  UNKNOWN: 'Unknown',
  OTHER: 'Other',
};

/**
 * POS preselects nothing and Shopify records UNKNOWN when no reason is given,
 * so an unconfigured line means UNKNOWN in both vocabularies and the run can
 * skip the reason picker entirely.
 */
export const defaultReturnReason: ReturnReason = 'UNKNOWN';

export function isReturnReason(value: unknown): value is ReturnReason {
  return typeof value === 'string' && (returnReasons as readonly string[]).includes(value);
}

/** The POS button to tap for a reason. */
export function posLabelForReason(reason: ReturnReason): string {
  return posLabels[reason];
}

/** The reason a POS button name stands for, or null for an unrecognised label. */
export function reasonForPosLabel(label: string): ReturnReason | null {
  const wanted = label.trim();
  const found = returnReasons.find(reason => posLabels[reason] === wanted);
  return found ?? null;
}

/** Operator-facing wording for the planner, e.g. "Changed my mind (UNWANTED)". */
export function describeReturnReason(reason: ReturnReason): string {
  return `${posLabels[reason]} (${reason})`;
}
