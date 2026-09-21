import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { browser } from '@wdio/globals';
import { pos } from '../screens/pos.ts';
import * as s from '../screens/pos.selectors.ts';
import { readScenarioRequest } from '../support/input.ts';

/**
 * Discovery only. Searches products, taps one exact product row by its Shopify
 * product id, and captures whatever surface follows, so the add-to-cart contract
 * can be identified for both single and multi variant products. No payment.
 */
describe('Shopify POS product selection inspection', () => {
  it('selects one exact product row by id and captures the resulting surface', async () => {
    const request = await readScenarioRequest();
    if (request.scriptId !== 'pos.inspect-product-selection' || request.assertionMode !== 'pos') {
      throw new Error('This native spec is bound to the pos.inspect-product-selection request.');
    }
    const term = String(request.parameters?.search ?? '');
    const productId = String(request.parameters?.productId ?? '');
    if (!/^\d{5,20}$/.test(productId)) throw new Error('An exact numeric Shopify product id is required.');
    const artifactDir = resolve(process.env.RUN_ARTIFACT_DIR ?? join('artifacts', 'inspection-product-selection'));
    await mkdir(artifactDir, { recursive: true });

    await pos.assertHome();
    await browser.waitUntil(async () => (await pos.readCartState()).checkoutExists, {
      timeout: 15_000, timeoutMsg: 'The POS cart surface did not attach its checkout element after activation.',
    });
    await pos.assertEmptyCart();

    const search = await browser.$(s.searchBar).getElement();
    if (await search.getAttribute('hittable') !== 'true') throw new Error('The observed Home search control is unavailable.');
    await search.click();
    await browser.waitUntil(async () => await browser.$(s.searchTextInput).isDisplayed(), {
      timeout: 15_000, timeoutMsg: 'Shopify POS did not expose the product search input.',
    });
    await pos.typeProductSearch(term);

    const row = await browser.$(s.productRow(productId));
    await browser.waitUntil(async () => await row.isExisting() && await row.isDisplayed(), {
      timeout: 20_000, timeoutMsg: `Search for "${term}" did not list the exact product id ${productId}.`,
    });
    await writeFile(join(artifactDir, 'results-before-select.xml'), await browser.getPageSource());

    const element = await row.getElement();
    if (!await element.isEnabled() || await element.getAttribute('hittable') !== 'true') {
      throw new Error(`The product row for ${productId} is present but not actionable.`);
    }
    await element.click();

    await browser.waitUntil(async () => {
      const state = await pos.readCartState();
      if (state.checkoutEnabled) return true;
      const source = await browser.getPageSource();
      return source.includes('Variant') || source.includes('Screen.Product');
    }, { timeout: 20_000, timeoutMsg: 'Tapping the product row produced neither a cart line nor a recognizable product surface.' });

    await writeFile(join(artifactDir, 'after-select.xml'), await browser.getPageSource());
    await browser.saveScreenshot(join(artifactDir, 'after-select.png'));
  });
});
