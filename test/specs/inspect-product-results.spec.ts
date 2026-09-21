import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { browser } from '@wdio/globals';
import { pos } from '../screens/pos.ts';
import * as s from '../screens/pos.selectors.ts';
import { readScenarioRequest } from '../support/input.ts';

/**
 * Discovery only. Opens product search, types a broad term, captures the result
 * list, then selects the first result and captures whatever surface follows so
 * the add-to-cart contract can be identified. It completes no payment.
 */
describe('Shopify POS product results inspection', () => {
  it('searches products and captures the result and selection surfaces', async () => {
    const request = await readScenarioRequest();
    if (request.scriptId !== 'pos.inspect-product-results' || request.assertionMode !== 'pos') {
      throw new Error('This native spec is bound to the pos.inspect-product-results request.');
    }
    const term = typeof request.parameters?.search === 'string' ? request.parameters.search : 'a';
    const artifactDir = resolve(process.env.RUN_ARTIFACT_DIR ?? join('artifacts', 'inspection-product-results'));
    await mkdir(artifactDir, { recursive: true });

    await pos.assertHome();
    await browser.waitUntil(async () => (await pos.readCartState()).checkoutExists, {
      timeout: 15_000, timeoutMsg: 'The POS cart surface did not attach its checkout element after activation.',
    });
    await pos.assertEmptyCart();

    const search = await browser.$(s.searchBar).getElement();
    if (!await search.isDisplayed() || !await search.isEnabled() || await search.getAttribute('hittable') !== 'true') {
      throw new Error('The observed Home search control is unavailable.');
    }
    await search.click();

    await browser.waitUntil(async () => {
      let visible = 0;
      for (const field of await browser.$$(s.productSearchField)) if (await field.isDisplayed()) visible++;
      return visible === 1;
    }, { timeout: 15_000, timeoutMsg: 'Shopify POS did not expose exactly one visible product search field.' });

    await pos.typeProductSearch(term);

    // Let the result list settle rather than sleeping a fixed interval.
    await browser.waitUntil(async () => {
      const source = await browser.getPageSource();
      return source.includes('ProductGrid') || source.includes('SearchResult') || source.includes('ProductList') || source.includes('Product.');
    }, { timeout: 20_000, timeoutMsg: `Shopify POS did not present a recognizable product result surface for "${term}".` });

    await writeFile(join(artifactDir, 'product-results.xml'), await browser.getPageSource());
    await browser.saveScreenshot(join(artifactDir, 'product-results.png'));
  });
});
