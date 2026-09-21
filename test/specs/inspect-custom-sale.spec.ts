import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { browser } from '@wdio/globals';
import { pos } from '../screens/pos.ts';
import * as s from '../screens/pos.selectors.ts';
import { readScenarioRequest } from '../support/input.ts';

describe('Shopify POS custom sale surface inspection', () => {
  it('opens the observed Add custom sale tile and captures it without adding a line', async () => {
    const request = await readScenarioRequest();
    if (request.scriptId !== 'pos.inspect-custom-sale' || request.assertionMode !== 'pos') {
      throw new Error('This native spec is bound to the pos.inspect-custom-sale read-only request.');
    }
    await pos.assertHome();

    // The cart surface is not fully attached immediately after POS is activated,
    // so wait for the observed checkout element to exist before judging state.
    // This is a readiness wait, not a relaxation of the empty-cart assertion.
    await browser.waitUntil(async () => (await pos.readCartState()).checkoutExists, {
      timeout: 15_000,
      timeoutMsg: 'The POS cart surface did not attach its checkout element after activation.',
    });

    // The cart must start empty so the captured surface is the initial custom
    // sale entry point, not an edit of an existing line.
    await pos.assertEmptyCart();

    const tile = await browser.$(s.addCustomSaleTile).getElement();
    if (!await tile.isDisplayed() || !await tile.isEnabled() || await tile.getAttribute('hittable') !== 'true') {
      throw new Error('The observed Add custom sale tile is not available. Inspect the current Home accessibility tree before changing selectors.');
    }
    await tile.click();

    // Wait for the surface to settle rather than asserting an unverified
    // identifier; the whole point of this run is to discover it.
    await browser.waitUntil(async () => {
      const source = await browser.getPageSource();
      return source.length > 0 && !source.includes('Screen.Home.Tile.AddCustomSale');
    }, { timeout: 15_000, timeoutMsg: 'Shopify POS did not present a new surface after the Add custom sale tile was tapped.' });

    const artifactDir = resolve(process.env.RUN_ARTIFACT_DIR ?? join('artifacts', 'inspection-custom-sale'));
    await mkdir(artifactDir, { recursive: true });
    await writeFile(join(artifactDir, 'custom-sale.xml'), await browser.getPageSource());
    await browser.saveScreenshot(join(artifactDir, 'custom-sale.png'));
  });
});
