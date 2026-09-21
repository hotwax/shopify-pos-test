import { browser } from '@wdio/globals';
import * as s from './pos.selectors.ts';
import { pos } from './pos.ts';
import { clickIfPresent, enabledIfPresent, isPresent, waitForGone, waitForPresent } from './wait.ts';

/**
 * Checkout and cash-tender routines for Shopify POS, observed on 11.14.0.
 *
 * Everything up to and including `readExactCashAmount` is reversible with the
 * surface's Cancel. `commitExactCash` is the irreversible step: on this POS
 * build tapping the exact-amount chip completes the sale by itself (verified
 * on 2026-09-21 against Shopify orders HCDEV#5853 and HCDEV#5854, which two
 * runs created while still waiting for Apply). Apply is only pressed when the
 * surface stays open after the chip.
 */

/** Minor units, so amounts are compared as integers rather than floats. */
export function cents(label: string, what: string): number {
  const match = /\$\s*([0-9]+(?:\.[0-9]{1,2})?)/.exec(label);
  if (!match?.[1]) throw new Error(`${what} did not expose a readable amount; it read "${label}".`);
  const [whole, fraction = ''] = match[1].split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

export interface ObservedAmount { label: string; cents: number }

export type CashCommitPath = 'exact-amount-chip' | 'apply-button';

export const posCheckout = {
  /** The checkout control's label carries the cart total, e.g. "Checkout, $120.00". */
  async readCheckoutTotal(): Promise<ObservedAmount> {
    const checkout = await browser.$(s.checkoutButton).getElement();
    const label = (await checkout.getAttribute('label')) ?? '';
    const total = cents(label, 'The POS checkout control');
    if (total <= 0) throw new Error(`The POS cart total is not a positive amount; it read "${label}".`);
    return { label, cents: total };
  },

  async openCheckout(): Promise<void> {
    const checkout = await browser.$(s.checkoutButton).getElement();
    if (await checkout.getAttribute('hittable') !== 'true') throw new Error('Checkout is not hittable.');
    await checkout.click();
    await waitForPresent(s.checkoutSelectPayment, { timeout: 20_000, timeoutMsg: 'Shopify POS did not present the payment selection surface.' });
  },

  async selectCashTender(): Promise<void> {
    const cash = await browser.$(s.cashTenderButton).getElement();
    if (await cash.getAttribute('label') !== 'Cash') throw new Error('The observed cash tender did not carry the expected Cash label.');
    await cash.click();
    await waitForPresent(s.acceptCashScreen, { timeout: 20_000, timeoutMsg: 'Shopify POS did not present the cash surface.' });
  },

  /** The first amount chip is the exact cart total; it is read, not trusted. */
  async readExactCashAmount(): Promise<ObservedAmount> {
    const exact = await browser.$(s.acceptCashExactAmount).getElement();
    const label = (await exact.getAttribute('label')) ?? '';
    return { label, cents: cents(label, 'The exact cash amount') };
  },

  /**
   * Taps the exact-amount chip, which is the committing action on this POS
   * build, then presses Apply only if the surface is still open with Apply
   * enabled. Resolves once the cash surface has gone, and reports which
   * control completed the sale.
   */
  async commitExactCash(): Promise<CashCommitPath> {
    const exact = await browser.$(s.acceptCashExactAmount).getElement();
    await exact.click();

    let path: CashCommitPath = 'exact-amount-chip';
    // Existence rather than visibility: the surface leaves the tree when POS
    // completes the sale, and a visibility read would wait for the app to idle
    // through the completion animation on every poll.
    // Protocol-level reads only: the surface and its Apply button leave the
    // tree the moment POS completes the sale, and an element-object read on a
    // vanished control would sit in WebdriverIO's implicit wait instead of
    // reporting "gone".
    await browser.waitUntil(async () => {
      if (!await isPresent(s.acceptCashScreen)) return true;
      return (await enabledIfPresent(s.acceptCashApplyButton)) === true;
    }, { timeout: 15_000, timeoutMsg: 'After the exact cash amount was chosen, Shopify POS neither completed the sale nor enabled Apply.' });

    if (await isPresent(s.acceptCashScreen) && await clickIfPresent(s.acceptCashApplyButton)) path = 'apply-button';
    await waitForGone(s.acceptCashScreen, { timeout: 60_000, timeoutMsg: 'Shopify POS did not leave the cash surface after the payment was applied.' });
    return path;
  },

  /**
   * After the sale POS shows Screen.CheckoutComplete with receipt options.
   * Done is tapped when that surface is open, then Home with an empty cart is
   * required, so the next sale (or a chained exchange) starts from the same
   * state this one did. Nothing here sends a receipt.
   */
  async finishReceipt(): Promise<void> {
    // The receipt surface may still be sliding in; wait for it to appear
    // rather than assuming its absence means POS went straight Home.
    await waitForPresent(s.checkoutCompleteScreen, { timeout: 10_000, timeoutMsg: 'receipt not shown' }).catch(() => undefined);
    if (await isPresent(s.checkoutCompleteScreen)) {
      // The receipt can dismiss on its own; a tap on a Done that has already
      // gone is simply skipped rather than waited for.
      await clickIfPresent(s.checkoutCompleteDoneButton);
      await waitForGone(s.checkoutCompleteScreen, { timeout: 20_000, timeoutMsg: 'Shopify POS did not close the receipt surface after Done.' });
    }
    // The receipt is gone, so the app is idle again: one visibility read for
    // Home, then the empty-cart contract (checkout disabled, no cart lines).
    await browser.$(s.homeScreen).waitForDisplayed({ timeout: 30_000, timeoutMsg: 'Shopify POS did not return to Home after the sale.' });
    await waitForGone(s.anyCartLineItem, { timeout: 20_000, timeoutMsg: 'The POS cart was not empty after the sale; it still held lines.' });
    await pos.assertEmptyCart();
  },
};
