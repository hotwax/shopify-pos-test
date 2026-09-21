import { browser } from '@wdio/globals';
import * as s from './pos.selectors.ts';
import { isPresent, waitForPresent } from './wait.ts';
import { normalizeOrderReference, readOrderRowSummary, readRowReference } from './reference.ts';

async function requireTouchable(element: WebdriverIO.Element, message: string): Promise<void> {
  if (!await element.isDisplayed() || !await element.isEnabled() ||
      await element.getAttribute('hittable') !== 'true') throw new Error(message);
}

async function requireNoAlert(): Promise<void> {
  if (await isPresent('XCUIElementTypeAlert')) {
    throw new Error('Dismiss the blocking iOS/POS alert yourself before testing.');
  }
}

export type PosCartState = {
  cartDisplayed: boolean;
  checkoutExists: boolean;
  checkoutDisplayed: boolean;
  checkoutEnabled: boolean;
  checkoutHittable: string | null;
  addCartExists: boolean;
  addCartDisplayed: boolean;
  addCartEnabled: boolean;
  addCartHittable: string | null;
  empty: boolean;
};

export interface PosStoreContext {
  storeName: string;
  locationName: string;
  plan: string;
}

/**
 * Parses the observed More-menu header while deliberately dropping the staff
 * name. New or localized formats must be inspected before they are accepted.
 */
export function parseStoreContextLabel(label: string | null): PosStoreContext {
  const match = /^(?:[^,\r\n]+),\s+([^,\r\n]+),\s+([^,\r\n]+),\s+([^,\r\n]+)$/.exec(label?.trim() ?? '');
  if (!match || !match[1]?.trim() || !match[2]?.trim() || !match[3]?.trim()) {
    throw new Error('Cannot read an unambiguous POS store context from the More-menu header; inspect this POS version.');
  }
  return { storeName: match[1].trim(), locationName: match[2].trim(), plan: match[3].trim() };
}

async function readNativeState(element: WebdriverIO.Element): Promise<{ exists: boolean; displayed: boolean; enabled: boolean; hittable: string | null }> {
  const exists = await element.isExisting();
  if (!exists) return { exists: false, displayed: false, enabled: false, hittable: null };
  return {
    exists: true,
    displayed: await element.isDisplayed(),
    enabled: await element.isEnabled(),
    hittable: await element.getAttribute('hittable'),
  };
}

/**
 * Types text into a POS search field and proves the field received it.
 *
 * POS filters as you type and each re-render can swallow in-flight
 * keystrokes: "RED SHOES" was observed landing as "ROES" and "HCDEV#5860" as
 * "HDEV#5860" three attempts running (run-1789984781667), so retrying the
 * whole string is not enough on its own. After two whole-string attempts the
 * text is entered one character at a time, each verified before the next,
 * which is slow but does not race the re-render.
 *
 * Returns nothing and throws if the field never reads back the exact value,
 * because a dropped character silently changes which rows POS lists.
 */
async function typeExactly(selector: string, value: string, what: string): Promise<void> {
  const field = async (): Promise<WebdriverIO.Element> => browser.$(selector).getElement();
  const current = async (): Promise<string> => ((await (await field()).getAttribute('value')) ?? '');

  for (let attempt = 0; attempt < 2; attempt++) {
    const target = await field();
    try { await target.click(); } catch { /* already focused */ }
    if (await current() !== '') await target.clearValue();
    await target.setValue(value);
    if (await current() === value) return;
  }

  // Character by character, re-resolving the element each time because the
  // list re-render replaces it.
  const target = await field();
  try { await target.click(); } catch { /* already focused */ }
  if (await current() !== '') await (await field()).clearValue();
  for (const [index, character] of [...value].entries()) {
    const wanted = value.slice(0, index + 1);
    let seen = await current();
    for (let retry = 0; retry < 3 && seen !== wanted; retry++) {
      await (await field()).addValue(character);
      seen = await current();
    }
    if (seen !== wanted) throw new Error(`Shopify POS did not accept ${what} "${value}"; after typing character ${index + 1} the field read "${seen}".`);
  }
  const final = await current();
  if (final !== value) throw new Error(`Shopify POS did not accept ${what} "${value}"; the field read "${final}".`);
}

export const pos = {
  async assertHome(): Promise<void> {
    await requireNoAlert();
    const home = await browser.$(s.homeTab).getElement();
    if (!await browser.$(s.homeScreen).isDisplayed() || !await home.isSelected()) {
      throw new Error('Start on Shopify POS Home, with no dialog or order detail open.');
    }
    // "hittable" already implies displayed and enabled: one read, not three.
    if (await home.getAttribute('hittable') !== 'true') throw new Error('POS Home is blocked; dismiss the overlay yourself.');
  },

  async readStoreContext(): Promise<PosStoreContext> {
    await requireNoAlert();
    const visible = [];
    for (const candidate of await browser.$$(s.moreHeader).getElements()) {
      if (await candidate.isDisplayed()) visible.push(candidate);
    }
    if (visible.length !== 1) throw new Error('The current POS More menu did not expose exactly one visible store-context header.');
    // The container carries the label on some builds and on others it is bare,
    // with the "Staff, Store, Location, Plan" string on its one accessible
    // descendant instead (observed on 11.14.0, run-1789984215018). Both are
    // read rather than one being assumed, and an unparseable result still
    // fails closed in parseStoreContextLabel.
    const direct = await visible[0].getAttribute('label');
    if (direct?.trim()) return parseStoreContextLabel(direct);
    const labelled: string[] = [];
    for (const descendant of await visible[0].$$(s.moreHeaderLabel).getElements()) {
      const label = (await descendant.getAttribute('label'))?.trim() ?? '';
      if (label.includes(',')) labelled.push(label);
    }
    if (labelled.length !== 1) {
      throw new Error(`The POS More menu header exposed ${labelled.length} candidate store-context labels instead of one; inspect this POS version.`);
    }
    return parseStoreContextLabel(labelled[0]!);
  },

  /**
   * Types a product search term and proves POS actually received it.
   *
   * POS filters as you type, and each re-render can swallow in-flight
   * keystrokes: typing "RED SHOES" has been observed landing as "ROES". A
   * dropped character silently changes which products are listed, so the term
   * is read back and retyped rather than trusted.
   */
  async typeProductSearch(term: string): Promise<void> {
    const wanted = term.trim();
    if (!wanted) throw new Error('A product search needs a non-empty term.');
    let observed = '';
    for (let attempt = 0; attempt < 3; attempt++) {
      // Re-query each attempt: the field is replaced when the list re-renders.
      const field = await browser.$(s.searchTextInput).getElement();

      // Tapping first makes POS give the field keyboard focus. It is best
      // effort: the element exposes no reliable focus attribute, so the real
      // guarantee is the value read-back below, not this click.
      try { await field.click(); } catch { /* already focused, or not clickable */ }

      // Clearing is a round trip of its own; a fresh search field is empty.
      if (((await field.getAttribute('value')) ?? '') !== '') await field.clearValue();
      await field.setValue(wanted);
      try {
        await browser.waitUntil(async () => {
          observed = (await (await browser.$(s.searchTextInput).getElement()).getAttribute('value')) ?? '';
          return observed === wanted;
        }, { timeout: 5_000, interval: 250 });
        return;
      } catch { /* fall through to another attempt */ }
    }
    throw new Error(`Shopify POS did not accept the search term "${wanted}"; the field read "${observed}" after three attempts. Its live filtering drops keystrokes, so the search was not run.`);
  },

  async readCartState(): Promise<PosCartState> {
    await requireNoAlert();
    const cart = await browser.$(s.cartScreen).getElement();
    // Observed on POS 11.14.0: despite its identifier, Screen.Cart.CheckoutButton
    // is rendered as a sibling subtree under Screen.Home, not inside Screen.Cart.
    // Scoping it to the cart matched nothing, which made the empty-cart assertion
    // permanently unprovable. Add to cart really is inside the cart.
    const checkout = await browser.$(s.checkoutButton).getElement();
    const addCart = await cart.$(s.addCartButton).getElement();
    const cartState = await readNativeState(cart);
    const checkoutState = await readNativeState(checkout);
    const addCartState = await readNativeState(addCart);
    return {
      cartDisplayed: cartState.displayed,
      checkoutExists: checkoutState.exists,
      checkoutDisplayed: checkoutState.displayed,
      checkoutEnabled: checkoutState.enabled,
      checkoutHittable: checkoutState.hittable,
      addCartExists: addCartState.exists,
      addCartDisplayed: addCartState.displayed,
      addCartEnabled: addCartState.enabled,
      addCartHittable: addCartState.hittable,
      empty: cartState.displayed && checkoutState.exists && checkoutState.displayed && !checkoutState.enabled &&
        !(addCartState.displayed && addCartState.enabled),
    };
  },

  /**
   * The same empty-cart contract as `readCartState().empty`, read with five
   * round trips instead of twelve per poll: the checkout control must attach,
   * be visible and disabled, and the dual-purpose Add/Clear cart control must
   * not be an enabled "Clear cart". The full state read stays for diagnostics.
   */
  async assertEmptyCart(): Promise<void> {
    await waitForPresent(s.checkoutButton, { timeout: 15_000, timeoutMsg: 'The POS cart surface did not attach its checkout element.' });
    const checkout = browser.$(s.checkoutButton);
    if (!await checkout.isDisplayed()) throw new Error('The POS cart surface is not visible; inspect the current Home layout before testing.');
    if (await checkout.isEnabled()) throw new Error('The POS cart is not in the observed empty-cart state: its checkout control is enabled, so the cart holds lines. Clear the cart (pos.clear-cart) and rerun.');
    if (await isPresent(s.anyCartLineItem) || await isPresent(s.anySharedCartLine)) throw new Error('The POS cart is not in the observed empty-cart state: it still holds a line. Clear the cart (pos.clear-cart) and rerun.');
  },

  /**
   * Opens the Orders tab without judging what is listed.
   *
   * `openOrders` additionally insists on loaded rows, which is right for the
   * "first order" smoke but wrong for a search by reference: POS keeps the
   * previous run's filter text, so the list is legitimately empty until the
   * new term is typed, and demanding rows first fails a run that would have
   * worked (run-1789984916168).
   */
  async openOrdersScreen(): Promise<void> {
    await requireNoAlert();
    if (await browser.$(s.ordersScreen).isDisplayed()) return;
    const tab = await browser.$(s.ordersTab).getElement();
    await requireTouchable(tab, 'Orders navigation is blocked or unavailable.');
    await tab.click();
    await browser.waitUntil(async () => await browser.$(s.ordersScreen).isDisplayed() && await tab.isSelected(), {
      timeout: 20_000, timeoutMsg: 'Shopify POS did not open the Orders tab.',
    });
  },

  async openOrders(): Promise<void> {
    await requireNoAlert();
    const tab = await browser.$(s.ordersTab).getElement();
    await requireTouchable(tab, 'Orders navigation is blocked or unavailable.');
    await tab.click();
    await browser.waitUntil(async () => {
      const screen = await browser.$(s.ordersScreen);
      if (!await screen.isDisplayed() || !await tab.isSelected()) return false;
      if (await screen.$(s.emptySearch).isDisplayed()) return true;
      const list = await browser.$(s.ordersList);
      return await list.isDisplayed() &&
        !await screen.$(s.loading).isDisplayed() &&
        (await list.$$(s.orderRows).getElements()).length > 0;
    }, {
      timeout: 20_000,
      timeoutMsg: 'No loaded order rows: the current list may be empty, still loading, or unsupported. Filters were not changed.',
    });
    if (await browser.$(s.ordersScreen).$(s.emptySearch).isDisplayed()) {
      throw new Error('The current Orders list is empty.');
    }
  },

  async openFirstOrder(): Promise<string> {
    await requireNoAlert();
    if (await browser.$(s.ordersScreen).$(s.emptySearch).isDisplayed()) {
      throw new Error('The current Orders list is empty.');
    }
    const list = await browser.$(s.ordersList);
    const scrolls = await list.$$(s.orderScroll).getElements();
    if (scrolls.length !== 1) throw new Error('Cannot identify exactly one order-list scroll container.');
    const scroll = scrolls[0];

    for (let attempt = 0; attempt < 10; attempt++) {
      // Always scroll up at least once. A rounded 0% indicator alone is not
      // enough; the first row must also start at the container's top edge.
      await browser.execute('mobile: scroll', { elementId: scroll.elementId, direction: 'up' });
      const bars = await scroll.$$(s.verticalScrollbars).getElements();
      const percentages = await bars.map(async bar => await bar.getAttribute('value'));
      const rows = await scroll.$$(s.orderRows).getElements();
      if (!rows.length) throw new Error('No order rows remain in the current list.');
      const first = rows[0];
      const rowPosition = await first.getLocation();
      const scrollPosition = await scroll.getLocation();
      if (!percentages.length || !percentages.every(value => value === '0%') ||
          Math.abs(rowPosition.y - scrollPosition.y) > 1) continue;

      const reference = readRowReference(await first.getAttribute(s.rowReference));
      const identity = await first.getAttribute('name');
      await requireTouchable(first, 'The first order row is blocked or unavailable.');
      // Refetch immediately before the tap so a list refresh cannot silently
      // change which row is first. A stale element also fails without retries.
      const freshRows = await scroll.$$(s.orderRows).getElements();
      if (!freshRows.length || await freshRows[0].getAttribute('name') !== identity ||
          readRowReference(await freshRows[0].getAttribute(s.rowReference)) !== reference) {
        throw new Error('The first order changed during selection; return to Home and rerun.');
      }
      await freshRows[0].click();
      return reference;
    }
    throw new Error('Could not establish the beginning of the order list within 10 upward scrolls.');
  },

  /**
   * After a sale, reads the reference of the newest order without opening it.
   * POS lists orders newest first (observed on 11.14.0), so the first row of
   * the scrolled-to-top list is the sale just taken. The row's own total must
   * equal the tendered label, otherwise the row is someone else's order and
   * the read fails closed. Nothing is tapped except scrolling.
   */
  async readNewestOrderReference(expectedAmountLabel: string): Promise<{ reference: string; label: string }> {
    await this.openOrders();
    const list = await browser.$(s.ordersList);
    const scrolls = await list.$$(s.orderScroll).getElements();
    if (scrolls.length !== 1) throw new Error('Cannot identify exactly one order-list scroll container.');
    const scroll = scrolls[0];
    let label = '';
    // Only the first row is read each poll: enumerating every row costs WDA
    // about a quarter second per row, which made one poll of a long list take
    // longer than the whole wait (run-1789952908434).
    await browser.waitUntil(async () => {
      await browser.execute('mobile: scroll', { elementId: scroll.elementId, direction: 'up' });
      const first = await scroll.$(s.orderRows);
      if (!await first.isExisting()) return false;
      label = (await first.getAttribute('label')) ?? '';
      try { return readOrderRowSummary(label).amountLabel === expectedAmountLabel.trim(); } catch { return false; }
    }, {
      timeout: 60_000, interval: 1_000,
      timeoutMsg: `The newest POS order row did not show the tendered total ${expectedAmountLabel}; it read "${label}". The sale may not have synced yet, or another order was placed. Reconcile in Shopify before rerunning.`,
    });
    return { reference: readOrderRowSummary(label).reference, label };
  },

  /** Returns to Home from the Orders tab without touching any order. */
  async returnHome(): Promise<void> {
    const homeTab = await browser.$(s.homeTab).getElement();
    await requireTouchable(homeTab, 'The observed Home tab is unavailable for returning to Home.');
    await homeTab.click();
    await browser.waitUntil(async () => await browser.$(s.homeScreen).isDisplayed() && await homeTab.isSelected(), {
      timeout: 20_000, timeoutMsg: 'Shopify POS did not return to Home.',
    });
  },

  async openOrderByReference(reference: string): Promise<string> {
    const expected = normalizeOrderReference(reference);
    // Getting to Orders is part of opening an order by reference. Leaving it
    // to the caller made every new flow fail the same way, with POS still on
    // Home and a selector error about a screen nobody had navigated to
    // (run-1789983515107).
    await this.openOrdersScreen();
    const screen = browser.$(s.ordersScreen);
    const search = await screen.$(s.orderSearchField).getElement();
    if (!await search.isDisplayed() || !await search.isEnabled()) {
      throw new Error('The observed POS Orders search field is unavailable; inspect the current build before changing selectors.');
    }
    await typeExactly(s.orderSearchField, expected, 'the order reference');

    // An explicitly requested reference resolves any ambiguity itself, so the
    // customer-less row shape POS uses for walk-in sales is accepted here
    // (readRowReference still fails closed for the "first order" smoke).
    const rowReference = (label: string | null): string | null => {
      try { return readOrderRowSummary(label).reference; } catch { return null; }
    };
    // Every row's label is read on every poll. That is a round trip per row,
    // but bounding it by row count was tried and rejected: POS keeps more
    // rows attached than it filters to, so a count guard never matched
    // (run-1789984724250). Correctness first; the poll interval bounds it.
    const matchingRows = async (): Promise<WebdriverIO.Element[]> => {
      const rows = await browser.$(s.ordersList).$$(s.orderRows).getElements();
      const matches: WebdriverIO.Element[] = [];
      for (const row of rows) {
        if (rowReference(await row.getAttribute(s.rowReference)) === expected) matches.push(row);
      }
      return matches;
    };

    await browser.waitUntil(async () => (await matchingRows()).length === 1, {
      timeout: 20_000,
      timeoutMsg: `POS did not expose exactly one order row for the explicit reference ${expected}.`,
    });

    const matches = await matchingRows();
    if (matches.length !== 1) throw new Error(`POS exposed ${matches.length} rows for the explicit order reference ${expected}; refusing an ambiguous selection.`);
    const target = matches[0];
    const identity = await target.getAttribute('name');
    await requireTouchable(target, 'The explicitly selected POS order row is blocked or unavailable.');

    const freshMatches = await matchingRows();
    if (freshMatches.length !== 1 || await freshMatches[0].getAttribute('name') !== identity ||
        rowReference(await freshMatches[0].getAttribute(s.rowReference)) !== expected) {
      throw new Error('The explicitly selected order changed during selection; return to Home and rerun.');
    }
    await freshMatches[0].click();
    return expected;
  },

  async assertOrderDetail(reference: string): Promise<void> {
    const content = await browser.$(s.detailContent);
    await content.waitForDisplayed({ timeout: 20_000 });
    const titles = await content.$$(s.detailReference).getElements();
    if (titles.length !== 1 || !await titles[0].isDisplayed()) {
      throw new Error('Expected exactly one visible order detail reference.');
    }
    if ((await titles[0].getAttribute('label'))?.trim() !== reference) {
      throw new Error('Order detail reference does not match the selected list row.');
    }
  },
};
