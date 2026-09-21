import { browser } from '@wdio/globals';
import * as s from './pos.selectors.ts';
import { pos } from './pos.ts';
import { reportProgress } from '../support/progress.ts';
import { isPresent, waitForGone, waitForPresent } from './wait.ts';
import { observedVariantSelection, variantSelectionMismatch, type ProductTapOutcome, type VariantSelection } from '../../shared/variant-selection.ts';

/**
 * Cart-building routines for Shopify POS, observed on 11.14.0.
 *
 * A product is always located by its exact Shopify product id and, when POS
 * opens the variant picker, the variant by its exact variant id. Nothing here
 * pays or commits: these steps can be undone by clearing the POS cart.
 *
 * Two add-to-cart shapes exist and the planner records which one to expect:
 * - `addSingleVariantItemToCart`: the product tap itself adds the cart line.
 * - `addMultiVariantItemToCart`: the product tap opens Screen.VariantList and
 *   the exact variant has to be chosen before a cart line appears.
 * `addItemToCart` dispatches on the planned selection and, when the plan could
 * not tell, watches which surface POS opens and reports it.
 */
export interface CartLineRequest {
  variantGid: string;
  productGid: string;
  /** Term typed into POS product search before the row is matched by id. */
  search: string;
  quantity: number;
  variantSelection?: VariantSelection;
}

export function shopifyNumericId(gid: string, what: 'product' | 'variant'): string {
  const id = gid.split('/').pop() ?? '';
  if (!/^\d{5,20}$/.test(id)) throw new Error(`The ${what} GID ${gid} does not contain a numeric Shopify ${what} id.`);
  return id;
}

/** Home search control → product search surface with its text input visible. */
async function openProductSearch(): Promise<void> {
  const search = await browser.$(s.searchBar).getElement();
  if (await search.getAttribute('hittable') !== 'true') throw new Error('The observed Home search control is unavailable.');
  await search.click();
  // Presence, not visibility: a visibility read makes XCTest wait for the app
  // to go idle, and POS is not idle while a surface animates in. Measured at
  // 2.7 s per poll against 0.3 s for a presence poll (run-1789956489154).
  await waitForPresent(s.searchTextInput, { timeout: 15_000, timeoutMsg: 'Shopify POS did not expose the product search input.' });
}

/** Types the search term, then taps the one row carrying the exact product id. */
async function tapProductRow(line: CartLineRequest): Promise<void> {
  await pos.typeProductSearch(line.search);
  const rowSelector = s.productRow(shopifyNumericId(line.productGid, 'product'));
  try {
    // One presence lookup per poll (see openProductSearch on why not visibility).
    await waitForPresent(rowSelector, { timeout: 20_000, timeoutMsg: 'row not listed' });
  } catch {
    // Report what POS actually searched, not what was asked for: a dropped
    // keystroke used to surface as "this product is missing".
    const typed = (await browser.$(s.searchTextInput).getAttribute('value')) ?? '';
    throw new Error(`Shopify POS searched "${typed}" and did not list the exact product ${line.productGid}. Confirm the product is published to the POS sales channel.`);
  }
  await reportProgress(`Found the exact product row for ${line.productGid}`);
  // "hittable" implies enabled and visible: one cheap read per poll while the
  // list settles, then the tap.
  const row = browser.$(rowSelector);
  await browser.waitUntil(async () => await row.getAttribute('hittable') === 'true', {
    timeout: 10_000, timeoutMsg: `The product row for ${line.productGid} is present but not actionable.`,
  });
  await row.click();
}

/**
 * After the product tap POS either adds the cart line or opens the variant
 * picker. One predicate lookup per poll covers both outcomes, so neither is
 * assumed and neither costs a second round trip.
 */
async function awaitProductTapOutcome(line: CartLineRequest, cartIndex: number): Promise<ProductTapOutcome> {
  await reportProgress('Tapped the product row; waiting for the cart line or the variant picker');
  const outcomeQuery = `-ios predicate string:name == "${s.cartLineItem(cartIndex).slice(1)}" OR (name == "${s.variantListScreen.slice(1)}" AND visible == 1)`;
  let outcome: ProductTapOutcome | undefined;
  await browser.waitUntil(async () => {
    const found = await browser.$$(outcomeQuery).getElements();
    if (!found.length) return false;
    const names: string[] = [];
    for (const element of found) names.push((await element.getAttribute('name')) ?? '');
    outcome = names.includes(s.cartLineItem(cartIndex).slice(1)) ? 'cart-line' : 'variant-picker';
    return true;
  }, {
    timeout: 20_000,
    timeoutMsg: `Shopify POS neither added a cart line nor opened the variant picker for ${line.productGid}.`,
  });
  return outcome!;
}

async function awaitCartLine(cartIndex: number, timeoutMsg: string): Promise<void> {
  await waitForPresent(s.cartLineItem(cartIndex), { timeout: 20_000, timeoutMsg });
}

/** Chooses the exact variant from the open Screen.VariantList; returns its label. */
async function chooseVariant(line: CartLineRequest): Promise<string> {
  const wanted = shopifyNumericId(line.variantGid, 'variant');
  const variant = browser.$(s.variantRow(wanted));
  try {
    await waitForPresent(s.variantRow(wanted), { timeout: 15_000, timeoutMsg: 'variant not listed' });
  } catch {
    // Name the variants POS actually offered, so a wrong variant id is
    // distinguishable from a product that changed its options.
    const offered: string[] = [];
    for (const offeredRow of await browser.$$(s.variantRows)) {
      const name = (await offeredRow.getAttribute('name')) ?? '';
      offered.push(name.split('.').pop() ?? name);
    }
    throw new Error(`Shopify POS opened the variant picker for ${line.productGid} but did not list variant ${line.variantGid}. It offered: ${offered.join(', ') || 'no variant rows'}.`);
  }

  // The row is a non-accessible container. Its first button is the
  // add-to-cart label; the trailing "View product details" chevron opens
  // details instead of adding, so it is never the tap target. One predicate
  // lookup picks that button; the row itself (WDA lists it first in a class
  // lookup, seen in run-1789951771464) and the chevron are excluded by name.
  const addButtons = await variant.$$(`-ios predicate string:type == "XCUIElementTypeButton" AND NOT (name BEGINSWITH "Screen.") AND name != "${s.variantDetailsButton}"`).getElements();
  const target = addButtons[0] ?? variant;
  const variantLabel = (await target.getAttribute('label')) ?? '';
  await browser.waitUntil(async () => await target.getAttribute('hittable') === 'true', {
    timeout: 10_000, timeoutMsg: `The variant row for ${line.variantGid} is present but not actionable.`,
  });

  await reportProgress(`Choosing variant ${line.variantGid}`, { label: variantLabel });
  await target.click();
  return variantLabel;
}

async function chooseVariantIntoCart(line: CartLineRequest, cartIndex: number): Promise<void> {
  const variantLabel = await chooseVariant(line);
  await awaitCartLine(cartIndex, `Shopify POS did not add a cart line after choosing variant ${line.variantGid}${variantLabel ? ` ("${variantLabel}")` : ''}. A variant POS reports as sold out will not add unless this location allows selling out of stock.`);
}

function assertPlannedOutcome(line: CartLineRequest, outcome: ProductTapOutcome): void {
  const mismatch = variantSelectionMismatch(line.variantSelection ?? 'unknown', outcome, line.productGid);
  if (mismatch) throw new Error(mismatch);
}

export const posCart = {
  /**
   * Adds a product with only its default variant: the product tap is the add.
   * Fails closed if POS opens the variant picker instead, because then the
   * plan no longer describes the product.
   */
  async addSingleVariantItemToCart(line: CartLineRequest, cartIndex: number): Promise<void> {
    await openProductSearch();
    await tapProductRow(line);
    assertPlannedOutcome({ ...line, variantSelection: 'single' }, await awaitProductTapOutcome(line, cartIndex));
  },

  /**
   * Adds one exact variant of a multi-variant product: the product tap opens
   * the picker, the variant tap adds. Fails closed if POS adds a line on the
   * product tap, since which variant it added is then unverified.
   */
  async addMultiVariantItemToCart(line: CartLineRequest, cartIndex: number): Promise<void> {
    await openProductSearch();
    await tapProductRow(line);
    assertPlannedOutcome({ ...line, variantSelection: 'multi' }, await awaitProductTapOutcome(line, cartIndex));
    await chooseVariantIntoCart(line, cartIndex);
  },

  /**
   * Runs the routine the planner chose for this line. When the planner could
   * not tell, the run watches which surface POS opens, finishes the add the
   * matching way and returns what it saw so the record can say so.
   */
  async addItemToCart(line: CartLineRequest, cartIndex: number): Promise<VariantSelection> {
    const planned = line.variantSelection ?? 'unknown';
    if (planned === 'single') { await this.addSingleVariantItemToCart(line, cartIndex); return 'single'; }
    if (planned === 'multi') { await this.addMultiVariantItemToCart(line, cartIndex); return 'multi'; }

    await openProductSearch();
    await tapProductRow(line);
    const outcome = await awaitProductTapOutcome(line, cartIndex);
    const observed = observedVariantSelection(outcome);
    await reportProgress(`The plan did not record this product's variant layout; POS behaved as ${observed}-variant`, { productGid: line.productGid, observed });
    if (outcome === 'variant-picker') await chooseVariantIntoCart(line, cartIndex);
    return observed;
  },

  /**
   * The cart line exists, but the variant picker and the search surface stay
   * stacked above the cart and hide the checkout control. Both dismiss with
   * Back, outermost first, and each is only touched when it is actually open.
   */
  async closeProductSurfaces(): Promise<void> {
    for (const surface of [
      { screen: s.variantListScreen, back: s.variantListBackButton, what: 'variant picker' },
      { screen: s.searchScreen, back: s.searchBackButton, what: 'product search' },
    ]) {
      // These surfaces leave the tree when they close, so presence is the
      // cheap, idle-free way to know whether one is open.
      if (!await isPresent(surface.screen)) continue;
      // One predicate lookup for the visible Back control instead of a walk
      // over every candidate with two reads each.
      const back = (await browser.$$(surface.back).getElements())[0];
      if (!back) throw new Error(`Shopify POS left the ${surface.what} open with no visible Back control.`);
      await back.click();
      await waitForGone(surface.screen, { timeout: 20_000, timeoutMsg: `Shopify POS did not close the ${surface.what}.` });
    }
    // The cart controls must be reachable again before the next line or the
    // checkout read. The app is idle again by now, so one visibility read is
    // cheap.
    await browser.$(s.checkoutButton).waitForDisplayed({ timeout: 20_000, timeoutMsg: 'The POS checkout control did not become visible after the product surfaces closed.' });
  },
};
