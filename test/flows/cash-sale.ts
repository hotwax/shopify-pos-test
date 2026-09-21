import { join } from 'node:path';
import { browser } from '@wdio/globals';
import { posCart, type CartLineRequest } from '../screens/pos-cart.ts';
import { posCheckout, type CashCommitPath, type ObservedAmount } from '../screens/pos-checkout.ts';
import { reportProgress } from '../support/progress.ts';
import type { VariantSelection } from '../../shared/variant-selection.ts';

/**
 * The cash-sale building blocks, in the order a sale happens: build the cart,
 * bound the total, pay it in cash. `createCashSale` chains them for a plain
 * sale; a later exchange flow can reuse `buildCart` and `payExactCash` around
 * its own return steps.
 *
 * Preconditions belong to the caller: POS on Home with an empty cart, and the
 * request already validated. Every artifact lands in `artifactDir`.
 */

export interface CashSaleLineResult extends CartLineRequest {
  /** How POS actually behaved: the plan when it was set, else what was seen. */
  observedSelection: VariantSelection;
}

export interface CashSaleResult {
  tenderedCents: number;
  checkoutLabel: string;
  exactLabel: string;
  committedBy: CashCommitPath;
  lines: CashSaleLineResult[];
}

export interface CashSaleHooks {
  /**
   * Runs after the cash amount is verified and evidence is captured, right
   * before the irreversible tap. The cash-order spec records the commit
   * attempt in the coordinator's ledger here, so a crash past this point is
   * reconciled rather than reported as a clean failure.
   */
  beforeCommit?: () => Promise<void>;
}

// Screenshots only: a page-source dump costs about 2.3 s each on this tree,
// and the failure hook already captures XML when something goes wrong.
async function snapshot(artifactDir: string, name: string): Promise<void> {
  await browser.saveScreenshot(join(artifactDir, `${name}.png`));
}

/** Adds every line by exact id, using the routine the planner chose for it. */
export async function buildCart(lines: CartLineRequest[]): Promise<CashSaleLineResult[]> {
  if (!lines.length) throw new Error('A cash sale requires at least one exact line.');
  // Repeat taps are not yet proven to increment a line, so quantity fails
  // closed here rather than tapping twice and hoping.
  for (const line of lines) {
    if (line.quantity !== 1) throw new Error('Only quantity 1 per line is verified for the first cash-order release.');
  }

  const results: CashSaleLineResult[] = [];
  for (const [index, line] of lines.entries()) {
    const planned = line.variantSelection ?? 'unknown';
    await reportProgress(`Adding "${line.search}" as a ${planned === 'unknown' ? 'variant-layout-unknown' : `${planned}-variant`} product`, {
      productGid: line.productGid, variantGid: line.variantGid, plannedSelection: planned, lineIndex: index + 1, lineCount: lines.length,
    });
    const observedSelection = await posCart.addItemToCart(line, index);
    await posCart.closeProductSurfaces();
    await reportProgress(`Cart line ${index + 1} is in the POS cart`, { productGid: line.productGid, observedSelection });
    results.push({ ...line, observedSelection });
  }
  return results;
}

/** Reads the cart total from the checkout control and freezes it as evidence. */
export async function readBoundedCartTotal(artifactDir: string): Promise<ObservedAmount> {
  await reportProgress('Reading the POS cart total from the checkout control');
  const total = await posCheckout.readCheckoutTotal();
  await snapshot(artifactDir, 'cart-before-payment');
  await reportProgress(`POS cart total reads ${total.label}`, { cartCents: total.cents });
  return total;
}

/**
 * Pays exactly the bounded total in cash. The exact-amount chip must equal the
 * verified cart total, so the tendered amount can never drift from what was
 * just approved. Everything past the chip tap is irreversible in Shopify.
 */
export async function payExactCash(total: ObservedAmount, artifactDir: string, hooks: CashSaleHooks = {}): Promise<{ exact: ObservedAmount; committedBy: CashCommitPath }> {
  await posCheckout.openCheckout();
  await reportProgress('Checkout opened; selecting the Cash tender');
  await posCheckout.selectCashTender();

  await reportProgress('Cash surface open; reading the exact amount');
  const exact = await posCheckout.readExactCashAmount();
  if (exact.cents !== total.cents) {
    throw new Error(`The exact cash chip ${exact.label} does not match the verified cart total ${total.label}; no payment was taken.`);
  }
  await snapshot(artifactDir, 'cash-before-commit');
  if (hooks.beforeCommit) await hooks.beforeCommit();

  await reportProgress(`Taking ${exact.label} cash. This creates the order and cannot be undone.`);
  // ---- everything past this point is irreversible in Shopify ----
  const committedBy = await posCheckout.commitExactCash();
  await reportProgress(`Payment taken via the ${committedBy}; capturing the resulting POS screen`, { committedBy });
  await snapshot(artifactDir, 'after-payment');
  await posCheckout.finishReceipt();
  await reportProgress('Receipt closed; POS is back on Home with an empty cart');
  return { exact, committedBy };
}

export async function createCashSale(lines: CartLineRequest[], artifactDir: string, hooks: CashSaleHooks = {}): Promise<CashSaleResult> {
  const cartLines = await buildCart(lines);
  const total = await readBoundedCartTotal(artifactDir);
  const payment = await payExactCash(total, artifactDir, hooks);
  return {
    tenderedCents: total.cents,
    checkoutLabel: total.label,
    exactLabel: payment.exact.label,
    committedBy: payment.committedBy,
    lines: cartLines,
  };
}
