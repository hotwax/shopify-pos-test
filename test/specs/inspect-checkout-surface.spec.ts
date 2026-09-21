import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { browser } from '@wdio/globals';
import { pos } from '../screens/pos.ts';
import * as s from '../screens/pos.selectors.ts';
import { readScenarioRequest } from '../support/input.ts';

/**
 * Discovery only. Adds one bounded custom-sale line so the checkout and tender
 * surfaces become reachable, then captures them. It never taps a tender option
 * and never completes a sale, so no order is created. The cart is left with the
 * line in it; clear it in POS before the next run.
 */
describe('Shopify POS checkout surface inspection', () => {
  it('adds one $1.00 custom sale line and captures the checkout surface without paying', async () => {
    const request = await readScenarioRequest();
    if (request.scriptId !== 'pos.inspect-checkout-surface' || request.assertionMode !== 'pos') {
      throw new Error('This native spec is bound to the pos.inspect-checkout-surface request.');
    }
    const artifactDir = resolve(process.env.RUN_ARTIFACT_DIR ?? join('artifacts', 'inspection-checkout'));
    await mkdir(artifactDir, { recursive: true });

    await pos.assertHome();
    await browser.waitUntil(async () => (await pos.readCartState()).checkoutExists, {
      timeout: 15_000, timeoutMsg: 'The POS cart surface did not attach its checkout element after activation.',
    });
    await pos.assertEmptyCart();

    const tile = await browser.$(s.addCustomSaleTile).getElement();
    if (!await tile.isDisplayed() || !await tile.isEnabled() || await tile.getAttribute('hittable') !== 'true') {
      throw new Error('The observed Add custom sale tile is not available.');
    }
    await tile.click();
    await browser.waitUntil(async () => await browser.$(s.customSaleScreen).isDisplayed(), {
      timeout: 15_000, timeoutMsg: 'Shopify POS did not present the custom sale surface.',
    });

    // $1.00 entered as cents on the observed numeric keypad.
    for (const digit of ['1', '0', '0']) {
      const key = await browser.$(s.numericKey(digit)).getElement();
      if (!await key.isDisplayed() || !await key.isEnabled()) throw new Error(`The observed numeric key ${digit} is unavailable.`);
      await key.click();
    }

    const price = await browser.$(s.customSalePriceField).getElement();
    const priceValue = await price.getAttribute('value');
    if (!priceValue?.includes('1.00')) {
      throw new Error(`The custom sale price did not reach the expected bounded amount; it read ${priceValue}.`);
    }

    const save = await browser.$(s.customSaleSaveButton).getElement();
    await browser.waitUntil(async () => await save.isEnabled(), {
      timeout: 10_000, timeoutMsg: 'The custom sale Save action never became enabled after a price was entered.',
    });
    await writeFile(join(artifactDir, 'custom-sale-filled.xml'), await browser.getPageSource());
    await browser.saveScreenshot(join(artifactDir, 'custom-sale-filled.png'));
    await save.click();

    // The line is now in the cart, so checkout must become actionable.
    await browser.waitUntil(async () => {
      const state = await pos.readCartState();
      return state.checkoutExists && state.checkoutEnabled;
    }, { timeout: 20_000, timeoutMsg: 'Checkout did not become enabled after the custom sale line was added.' });
    await writeFile(join(artifactDir, 'cart-with-line.xml'), await browser.getPageSource());
    await browser.saveScreenshot(join(artifactDir, 'cart-with-line.png'));

    const checkout = await browser.$(s.checkoutButton).getElement();
    if (await checkout.getAttribute('hittable') !== 'true') throw new Error('Checkout is enabled but not hittable.');
    await checkout.click();

    await browser.waitUntil(async () => {
      const source = await browser.getPageSource();
      return !source.includes('Screen.Home.Tile.AddCustomSale');
    }, { timeout: 20_000, timeoutMsg: 'Shopify POS did not leave Home after checkout was tapped.' });

    await writeFile(join(artifactDir, 'checkout-surface.xml'), await browser.getPageSource());
    await browser.saveScreenshot(join(artifactDir, 'checkout-surface.png'));
  });
});
