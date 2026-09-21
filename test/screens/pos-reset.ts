import { browser } from '@wdio/globals';
import { pos } from './pos.ts';
import * as s from './pos.selectors.ts';
import { isPresent, waitForGone } from './wait.ts';

/**
 * Returns Shopify POS to Home with an empty cart. Backs out of any open cash,
 * payment, receipt, more-actions, variant-picker, custom-sale or search
 * surface, then clears an unsold cart. It completes no payment and touches no
 * committed order, so it creates no business data. Used by the clear-cart
 * utility, by the cart-only timing run, and after every mutation spec so the
 * next run starts from the same state.
 */
export const posReset = {
  async clearCartAndReturnHome(): Promise<void> {
    // Overlays are dismissed outermost-first so the cart controls become
    // hittable. Each of these surfaces leaves the tree when it closes, so one
    // predicate query over their names says which are open, instead of six
    // separate presence probes.
    const surfaces = [
      { screen: s.acceptCashScreen, action: s.acceptCashCancelButton, label: 'Cancel', what: 'cash' },
      { screen: s.checkoutSelectPayment, action: s.customSaleCancelButton, label: 'Close', what: 'payment selection' },
      { screen: s.checkoutCompleteScreen, action: s.checkoutCompleteDoneButton, label: 'Done', what: 'receipt' },
      { screen: s.customSaleScreen, action: s.customSaleCancelButton, label: 'Cancel', what: 'custom sale' },
      // The variant picker sits above search and dismisses with Back.
      { screen: s.variantListScreen, action: s.customSaleCancelButton, label: 'Back', what: 'variant picker' },
      { screen: s.searchScreen, action: s.searchBackButton, label: 'Back', what: 'product search' },
    ];
    const openNames = new Set<string>();
    const openQuery = `-ios predicate string:name IN {${surfaces.map(step => `"${step.screen.slice(1)}"`).join(', ')}}`;
    for (const element of await browser.$$(openQuery).getElements()) openNames.add((await element.getAttribute('name')) ?? '');

    // Fast path: no overlay open, Home showing, no cart line. Four commands.
    let homeVisible = false;
    if (!openNames.size) {
      homeVisible = await browser.$(s.homeScreen).isDisplayed();
      if (homeVisible && !await isPresent(s.anyCartLineItem)) {
        await pos.assertEmptyCart();
        return;
      }
    }

    for (const step of surfaces) {
      if (!openNames.has(step.screen.slice(1))) continue;
      let action = await browser.$(step.action).getElement();
      for (const candidate of await browser.$$(step.action)) {
        if (await candidate.isDisplayed()) { action = candidate; break; }
      }
      if (await action.getAttribute('label') !== step.label) {
        throw new Error(`The ${step.what} surface did not expose the observed ${step.label} action.`);
      }
      await action.click();
      await waitForGone(step.screen, { timeout: 20_000, timeoutMsg: `Shopify POS did not leave the ${step.what} surface.` });
    }

    // Orders and More are tabs; Home is the only tab a run may start from.
    // (One read, skipped when the fast path already saw Home.)
    if (!homeVisible && !await browser.$(s.homeScreen).isDisplayed()) {
      const homeTab = await browser.$(s.homeTab).getElement();
      if (await homeTab.isDisplayed() && await homeTab.isEnabled()) {
        await homeTab.click();
        await browser.waitUntil(async () => await browser.$(s.homeScreen).isDisplayed(), {
          timeout: 20_000, timeoutMsg: 'Shopify POS did not return to Home.',
        });
      }
    }

    // The More actions sheet has no dismiss control of its own in the observed
    // build; it closes when its owning button is toggled again.
    if (await isPresent(s.moreActionsSaveCart)) {
      await browser.$(s.cartMoreActionsButton).click();
      await waitForGone(s.moreActionsSaveCart, { timeout: 20_000, timeoutMsg: 'Shopify POS did not close the cart More actions sheet.' });
    }

    // Observed dual-purpose control: "Add cart" when empty, "Clear cart" when
    // the cart holds lines (and it keeps that label, disabled, after a sale).
    // It is tapped only while the cart actually holds a line.
    if (await isPresent(s.anyCartLineItem)) {
      const clear = browser.$(s.addCartButton);
      if (await clear.getAttribute('label') !== 'Clear cart' || !await clear.isEnabled()) {
        throw new Error('The POS cart holds lines but does not offer an enabled "Clear cart" control; inspect this POS version.');
      }
      await clear.click();
      await waitForGone(s.anyCartLineItem, { timeout: 20_000, timeoutMsg: 'The POS cart did not reach the observed empty state after cleanup.' });
    }
    await pos.assertEmptyCart();
  },
};
