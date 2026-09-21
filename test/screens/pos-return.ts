import { browser } from '@wdio/globals';
import * as s from './pos.selectors.ts';
import { isPresent, waitForGone, waitForPresent } from './wait.ts';
import { reportProgress } from '../support/progress.ts';
import { posLabelForReason, returnReasons, type ReturnReason } from '../../shared/return-reason.ts';

/**
 * Return and exchange routines for Shopify POS, observed on 11.14.0 (2026-09-21).
 *
 * Nothing in this module commits: it opens the picker, selects lines, sets the
 * per-line options, and reads the cart's own arithmetic back. The committing
 * taps live in the flow that calls it, after the ledger has recorded a commit
 * attempt.
 *
 * Two observations shape the whole module:
 *
 * 1. The picker is not a screen. POS turns the Home cart into a return cart and
 *    lays the item list over it, so every "is the sheet open" test goes through
 *    the action-bar title rather than a Screen.* identifier.
 * 2. Expanded item panels accumulate. Selecting a second line leaves the first
 *    panel open, so the tree holds one quantity stepper, one reason button and
 *    one note field PER SELECTED LINE, all with identical names. Only the
 *    restock switch carries the item label. Every per-line control is therefore
 *    addressed by the ordinal position of that item's restock switch.
 */

/** A line as the POS picker names it: the product title, plus ", <variant>" when the product has variants. */
export function posItemLabel(productTitle: string, variantTitle: string | null): string {
  const title = productTitle.trim();
  const variant = (variantTitle ?? '').trim();
  // POS omits the variant segment for a product whose only variant is the
  // default one, exactly as the order detail does.
  if (!variant || variant.toLowerCase() === 'default title') return title;
  return `${title}, ${variant}`;
}

export type CartDirection = 'refund' | 'even' | 'collect';

export interface CartTotal {
  label: string;
  direction: CartDirection;
  /** Minor units, always non-negative. The direction carries the sign. */
  cents: number;
}

/** Minor units, so amounts are compared as integers rather than floats. */
function cents(text: string, what: string): number {
  const match = /\$\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/.exec(text);
  if (!match?.[1]) throw new Error(`${what} did not expose a readable amount; it read "${text}".`);
  const [whole, fraction = ''] = match[1].replaceAll(',', '').split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

/**
 * Turns the cart control's own label into the net direction and amount.
 * All three forms were observed: "Refund $171.00" (run-1789962976698),
 * "Complete exchange" (run-1789960926447) and "Checkout $69.00"
 * (run-1789963549704). An unrecognised label fails closed rather than being
 * guessed at, because this reading is what bounds the money.
 */
export function readCartDirection(label: string): CartTotal {
  const text = label.trim();
  if (/^Complete exchange$/i.test(text)) return { label: text, direction: 'even', cents: 0 };
  if (/^Refund\b/i.test(text)) return { label: text, direction: 'refund', cents: cents(text, 'The POS refund control') };
  if (/^Checkout\b/i.test(text)) return { label: text, direction: 'collect', cents: cents(text, 'The POS checkout control') };
  throw new Error(`The POS cart control read "${text}", which is not a recognised return, exchange or checkout state. Inspect this POS version before trusting the amount.`);
}

async function labelsOf(selector: string): Promise<string[]> {
  const found = await browser.$$(selector).getElements();
  const names: string[] = [];
  for (const element of found) names.push((await element.getAttribute('name')) ?? '');
  return names;
}

export const posReturn = {
  /**
   * Whether this order can be returned at all. POS keeps the accessible
   * wrapper enabled on every order and disables only the inner button, so the
   * inner one is the only honest signal (unfulfilled orders read false).
   */
  async isReturnable(): Promise<boolean> {
    await waitForPresent(s.returnActionButton, { timeout: 20_000, timeoutMsg: 'The order detail did not expose a Return or exchange action.' });
    return await browser.$(s.returnActionButton).isEnabled();
  },

  /**
   * Opens the picker from an open order detail.
   *
   * Element taps on this control succeed and do nothing, on both the wrapper
   * and the inner button (runs run-1789959781552 and run-1789959914509). Only a
   * raw coordinate tap at the wrapper's centre works, and only once the detail
   * has settled: the same tap 1.5 s after the detail appeared did nothing
   * (run-1789962852670) while a settled one worked first try. So the tap is
   * repeated against a positive test for the sheet title rather than against
   * any heuristic about the tree changing.
   */
  async openReturnSheet(attempts = 4): Promise<void> {
    if (!await this.isReturnable()) {
      throw new Error('Shopify POS has disabled Return or exchange for this order. Only a fulfilled order can be returned or exchanged.');
    }
    const wrapper = browser.$(s.returnActionWrapper);
    await browser.waitUntil(async () => await wrapper.getAttribute('hittable') === 'true', {
      timeout: 20_000, timeoutMsg: 'The Return or exchange action never became hittable.',
    });
    for (let attempt = 1; attempt <= attempts; attempt++) {
      const rect = await browser.getElementRect((await wrapper.getElement()).elementId);
      await browser.execute('mobile: tap', { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) });
      try {
        await waitForPresent(s.returnSheetTitle, { timeout: 6_000, timeoutMsg: 'not yet', interval: 750 });
        return;
      } catch {
        if (attempt < attempts) await reportProgress(`Shopify POS ignored the Return or exchange tap; retrying (${attempt + 1}/${attempts})`);
      }
    }
    throw new Error(`Shopify POS did not open the return picker after ${attempts} coordinate taps on the Return or exchange action.`);
  },

  async isSheetOpen(): Promise<boolean> {
    return isPresent(s.returnSheetTitle);
  },

  /** Leaves the picker. The cart keeps whatever lines were selected. */
  async closeSheetWithBack(): Promise<void> {
    if (!await this.isSheetOpen()) return;
    await browser.$(s.returnSheetBack).click();
    await waitForGone(s.returnSheetTitle, { timeout: 20_000, timeoutMsg: 'Shopify POS did not leave the return picker after Back.' });
  },

  /** Confirms the selection. Done stays disabled until at least one line is selected. */
  async finishSelection(): Promise<void> {
    const done = browser.$(s.returnSheetDone);
    await browser.waitUntil(async () => await done.isExisting() && await done.isEnabled(), {
      timeout: 20_000, timeoutMsg: 'The return picker never enabled Done; no line appears to be selected.',
    });
    await done.click();
    await waitForGone(s.returnSheetTitle, { timeout: 20_000, timeoutMsg: 'Shopify POS did not close the return picker after Done.' });
  },

  /**
   * Selects one line by its POS label and waits for its panel to exist. The
   * item is a Button while unselected and becomes an Other once expanded, so
   * the arrival of its uniquely named restock switch is the completion signal.
   */
  async selectItem(label: string): Promise<void> {
    if (await this.hasPanel(label)) return;
    await waitForPresent(s.returnItemButton(label), {
      timeout: 20_000,
      timeoutMsg: `The return picker does not list an item named "${label}". Confirm the line is returnable and that its POS label matches the order read-back.`,
    });
    await browser.$(s.returnItemButton(label)).click();
    await browser.waitUntil(() => this.hasPanel(label), {
      timeout: 20_000, timeoutMsg: `Shopify POS did not expand the return options for "${label}" after it was selected.`,
    });
  },

  async hasPanel(label: string): Promise<boolean> {
    return (await labelsOf(s.restockSwitches)).includes(`${s.restockSwitchPrefix}${label}`);
  },

  /**
   * The ordinal position of an item's panel among the expanded ones, which is
   * the index every other per-line control is read at. Two selected lines that
   * share a POS label would make this ambiguous, so that fails closed here
   * rather than silently configuring the wrong line.
   */
  async panelIndexFor(label: string): Promise<number> {
    const names = await labelsOf(s.restockSwitches);
    const wanted = `${s.restockSwitchPrefix}${label}`;
    const matches = names.filter(name => name === wanted).length;
    if (!matches) throw new Error(`No expanded return panel for "${label}"; select the item first.`);
    if (matches > 1) {
      throw new Error(`The return picker shows ${matches} panels labelled "${label}", so its per-line options cannot be set unambiguously. Return these lines in separate runs.`);
    }
    return names.indexOf(wanted);
  },

  /** Reads back every per-line setting POS is currently showing, for the pre-commit check. */
  async readPanels(): Promise<{ label: string; quantity: number; restock: boolean; reason: ReturnReason | null }[]> {
    const switchNames = await labelsOf(s.restockSwitches);
    const switches = await browser.$$(s.restockSwitches).getElements();
    const quantities = await browser.$$(s.quantityInputs).getElements();
    const reasonNames = await labelsOf(s.reasonButtons(returnReasons.map(posLabelForReason)));
    const panels: { label: string; quantity: number; restock: boolean; reason: ReturnReason | null }[] = [];
    for (const [index, name] of switchNames.entries()) {
      const label = name.slice(s.restockSwitchPrefix.length);
      const quantityText = (await quantities[index]?.getAttribute('value')) ?? '';
      const quantity = Number(quantityText.trim());
      if (!Number.isSafeInteger(quantity) || quantity <= 0) throw new Error(`The return panel for "${label}" shows an unreadable quantity "${quantityText}".`);
      const chosen = reasonNames[index] ?? '';
      const reason = chosen === 'Return reason' ? null : (returnReasons.find(item => posLabelForReason(item) === chosen) ?? null);
      if (chosen && chosen !== 'Return reason' && !reason) throw new Error(`The return panel for "${label}" shows an unrecognised reason "${chosen}".`);
      panels.push({ label, quantity, restock: (await switches[index]?.getAttribute('value')) === '1', reason });
    }
    return panels;
  },

  /**
   * Raises the line quantity by tapping Increment, verifying the field after
   * each tap. The button disables at the line's returnable maximum, so a
   * quantity beyond it fails here rather than silently returning fewer units.
   */
  async setQuantity(label: string, quantity: number): Promise<void> {
    if (!Number.isSafeInteger(quantity) || quantity < 1) throw new Error(`A return quantity must be a positive integer; got ${quantity}.`);
    for (let guard = 0; guard <= quantity; guard++) {
      const index = await this.panelIndexFor(label);
      const input = (await browser.$$(s.quantityInputs).getElements())[index];
      const current = Number(((await input?.getAttribute('value')) ?? '').trim());
      if (current === quantity) return;
      if (!Number.isSafeInteger(current)) throw new Error(`The return panel for "${label}" shows an unreadable quantity.`);
      if (current > quantity) throw new Error(`The return panel for "${label}" already shows ${current}, above the requested ${quantity}; POS offers no way down to it in this flow.`);
      const increment = (await browser.$$(s.quantityIncrementButtons).getElements())[index];
      if (!increment || !await increment.isEnabled()) {
        throw new Error(`Shopify POS caps "${label}" at ${current} returnable unit(s), so ${quantity} cannot be returned.`);
      }
      await increment.click();
      await browser.waitUntil(async () => {
        const seen = (await browser.$$(s.quantityInputs).getElements())[index];
        return Number(((await seen?.getAttribute('value')) ?? '').trim()) > current;
      }, { timeout: 10_000, timeoutMsg: `The quantity for "${label}" did not rise above ${current} after Increment.` });
    }
    throw new Error(`The quantity for "${label}" did not reach ${quantity}.`);
  },

  /** Sets the per-line restock choice, tapping only when it differs from the switch's current value. */
  async setRestock(label: string, restock: boolean): Promise<void> {
    const index = await this.panelIndexFor(label);
    const control = (await browser.$$(s.restockSwitches).getElements())[index];
    if (!control) throw new Error(`No restock switch for "${label}".`);
    if (((await control.getAttribute('value')) === '1') === restock) return;
    await control.click();
    await browser.waitUntil(async () => {
      const seen = (await browser.$$(s.restockSwitches).getElements())[index];
      return ((await seen?.getAttribute('value')) === '1') === restock;
    }, { timeout: 10_000, timeoutMsg: `The restock switch for "${label}" did not move to ${restock ? 'on' : 'off'}.` });
  },

  /**
   * Chooses a return reason. The control is named "Return reason" until a
   * reason is picked, after which its name becomes the chosen label, which is
   * also how the choice is verified.
   */
  async setReason(label: string, reason: ReturnReason): Promise<void> {
    const wanted = posLabelForReason(reason);
    const index = await this.panelIndexFor(label);
    const selector = s.reasonButtons(returnReasons.map(posLabelForReason));
    const control = (await browser.$$(selector).getElements())[index];
    if (!control) throw new Error(`No return-reason control for "${label}".`);
    if ((await control.getAttribute('name')) === wanted) return;
    await control.click();
    await waitForPresent(s.reasonPickerOption(wanted), {
      timeout: 15_000, timeoutMsg: `Shopify POS did not offer the return reason "${wanted}".`,
    });
    await browser.$(s.reasonPickerOption(wanted)).click();
    await browser.waitUntil(async () => {
      const seen = (await browser.$$(selector).getElements())[index];
      return (await seen?.getAttribute('name')) === wanted;
    }, { timeout: 15_000, timeoutMsg: `The return reason for "${label}" did not become "${wanted}".` });
  },

  /** Types the per-line note. POS keeps it on the return line. */
  async setNote(label: string, note: string): Promise<void> {
    const index = await this.panelIndexFor(label);
    const field = (await browser.$$(s.returnNoteFields).getElements())[index];
    if (!field) throw new Error(`No note field for "${label}".`);
    await field.click();
    await field.setValue(note);
    await browser.waitUntil(async () => {
      const seen = (await browser.$$(s.returnNoteFields).getElements())[index];
      return ((await seen?.getAttribute('value')) ?? '') === note;
    }, { timeout: 15_000, timeoutMsg: `The note for "${label}" did not read back as typed; POS drops keystrokes while it re-renders.` });
  },

  async openExchangeSearch(): Promise<void> {
    const control = browser.$(s.addExchangeItemsButton);
    await browser.waitUntil(async () => await control.isExisting() && await control.isEnabled(), {
      timeout: 20_000, timeoutMsg: 'The return picker never enabled Add exchange items; select a line to return first.',
    });
    await control.click();
    await waitForPresent(s.searchTextInput, { timeout: 15_000, timeoutMsg: 'Shopify POS did not open product search for the exchange items.' });
  },

  /** The return (negative) and sale (positive) lines the cart is showing, by label. */
  async readCartLines(): Promise<{ returned: string[]; purchased: string[] }> {
    return { returned: await labelsOf(s.returnCartLines), purchased: await labelsOf(s.exchangeCartLines) };
  },

  /** The cart's own net, read from the control that would commit it. */
  async readCartTotal(): Promise<CartTotal> {
    await waitForPresent(s.checkoutButton, { timeout: 20_000, timeoutMsg: 'The POS cart control did not appear after the return selection.' });
    return readCartDirection((await browser.$(s.checkoutButton).getAttribute('label')) ?? '');
  },

  /**
   * Opens the refund-method chooser from a net-refund cart. This is the last
   * surface before money moves, so the caller records its commit attempt
   * before calling anything past this point.
   */
  async openRefundMethods(): Promise<void> {
    await browser.$(s.checkoutButton).click();
    await waitForPresent(s.refundMethodTitle, {
      timeout: 20_000, timeoutMsg: 'Shopify POS did not present the refund-method chooser.',
    });
  },

  async isRefundMethodOpen(): Promise<boolean> {
    return isPresent(s.refundMethodTitle);
  },
};
