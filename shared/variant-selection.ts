/**
 * How Shopify POS adds a product to the cart, decided while the order is
 * planned so the native run knows which add-to-cart routine to call.
 *
 * Observed on POS 11.14.0 (2026-09-20):
 * - `single`: a product with only the default variant drops straight into the
 *   cart when its search row is tapped.
 * - `multi`: a product with several variants opens Screen.VariantList instead
 *   and adds nothing until one exact variant is chosen.
 * - `unknown`: the planner could not read the product's variant facts (for
 *   example the fields were not requested), or the product has exactly one
 *   non-default variant, a shape whose POS behaviour has not been observed.
 *   The run then watches which surface POS actually opens and reports it.
 */
export type VariantSelection = 'single' | 'multi' | 'unknown';

export const variantSelections: readonly VariantSelection[] = ['single', 'multi', 'unknown'];

export function isVariantSelection(value: unknown): value is VariantSelection {
  return typeof value === 'string' && (variantSelections as readonly string[]).includes(value);
}

export interface VariantFacts {
  /** Shopify `Product.hasOnlyDefaultVariant`; null when it was not read. */
  hasOnlyDefaultVariant: boolean | null;
  /** Shopify `Product.variantsCount.count` when exact; null when unread or inexact. */
  productVariantCount: number | null;
}

export function plannedVariantSelection(facts: VariantFacts): VariantSelection {
  if (facts.hasOnlyDefaultVariant === true) return 'single';
  if (facts.hasOnlyDefaultVariant === false) {
    // Several variants, or a count too large for Shopify to report exactly:
    // either way POS has to ask which one.
    if (facts.productVariantCount === null || facts.productVariantCount > 1) return 'multi';
    // One variant that is not the default one. POS may add it directly or
    // open the picker; it has not been observed, so the run must look.
    return 'unknown';
  }
  if (facts.productVariantCount !== null && facts.productVariantCount > 1) return 'multi';
  return 'unknown';
}

/** Short operator-facing wording, shared by the planner and the run record. */
export function describeVariantSelection(selection: VariantSelection, productVariantCount: number | null = null): string {
  if (selection === 'single') return 'Single variant · adds straight to the cart';
  if (selection === 'multi') return `Multi-variant · picks the exact variant${productVariantCount !== null ? ` from ${productVariantCount}` : ''}`;
  return 'Variant layout unknown · the run watches what POS opens';
}

/** What Shopify POS did after the product row was tapped. */
export type ProductTapOutcome = 'cart-line' | 'variant-picker';

export function observedVariantSelection(outcome: ProductTapOutcome): VariantSelection {
  return outcome === 'cart-line' ? 'single' : 'multi';
}

/**
 * The planned path and what POS actually opened must agree before the run goes
 * on. A mismatch means the product changed shape since the order was planned,
 * and the message says what the operator has to do about it.
 */
export function variantSelectionMismatch(planned: VariantSelection, outcome: ProductTapOutcome, productGid: string): string | null {
  if (planned === 'unknown') return null;
  if (planned === observedVariantSelection(outcome)) return null;
  if (planned === 'single') {
    return `Shopify POS opened the variant picker for ${productGid}, which was planned as a single-variant product. Its variants changed since the order was planned; rebuild the cart and rerun.`;
  }
  return `Shopify POS added ${productGid} straight to the cart although it was planned as a multi-variant product, so the variant it added is unverified. Clear the POS cart, rebuild the order and rerun.`;
}
