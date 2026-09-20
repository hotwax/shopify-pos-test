import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { browser } from '@wdio/globals';
import { pos } from '../screens/pos.ts';
import * as s from '../screens/pos.selectors.ts';
import { readScenarioRequest } from '../support/input.ts';

describe('Shopify POS product search inspection', () => {
  it('opens the observed search control without selecting a product', async () => {
    const request = await readScenarioRequest();
    if (request.scriptId !== 'pos.inspect-product-search' || request.assertionMode !== 'pos') {
      throw new Error('This native spec is bound to the pos.inspect-product-search read-only request.');
    }
    await pos.assertHome();
    const searchButton = await browser.$(s.searchBar);
    if (!await searchButton.isDisplayed() || !await searchButton.isEnabled() || await searchButton.getAttribute('hittable') !== 'true') {
      throw new Error('The observed Shopify POS Home search control is not available. Inspect the current Home accessibility tree before changing selectors.');
    }
    await searchButton.click();
    await browser.waitUntil(async () => {
      const fields = await browser.$$(s.productSearchField);
      let visible = 0;
      for (const field of fields) if (await field.isDisplayed()) visible++;
      return visible === 1;
    }, { timeout: 10_000, timeoutMsg: 'Shopify POS did not expose exactly one visible product search field after opening Search.' });

    const artifactDir = resolve(process.env.RUN_ARTIFACT_DIR ?? join('artifacts', 'inspection-product-search'));
    await mkdir(artifactDir, { recursive: true });
    await writeFile(join(artifactDir, 'product-search.xml'), await browser.getPageSource());
    await browser.saveScreenshot(join(artifactDir, 'product-search.png'));
  });
});
