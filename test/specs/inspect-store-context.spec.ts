import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { browser } from '@wdio/globals';
import { pos } from '../screens/pos.ts';
import * as s from '../screens/pos.selectors.ts';
import { readScenarioRequest } from '../support/input.ts';

describe('Shopify POS store-context inspection', () => {
  it('reads store, location and plan from More and returns to Home without changing settings', async () => {
    const request = await readScenarioRequest();
    if (request.scriptId !== 'pos.inspect-store-context' || request.assertionMode !== 'pos') {
      throw new Error('This native spec is bound to the pos.inspect-store-context read-only request.');
    }
    await pos.assertHome();

    const moreTab = await browser.$(s.moreTab).getElement();
    if (!await moreTab.isDisplayed() || !await moreTab.isEnabled() || await moreTab.getAttribute('hittable') !== 'true') {
      throw new Error('The observed POS More tab is unavailable; inspect the current build before changing selectors.');
    }
    await moreTab.click();
    await browser.waitUntil(async () => await browser.$(s.moreScreen).isDisplayed(), {
      timeout: 20_000,
      timeoutMsg: 'Shopify POS did not open the More menu.',
    });

    const context = await pos.readStoreContext();
    const artifactDir = resolve(process.env.RUN_ARTIFACT_DIR ?? join('artifacts', 'inspection-store-context'));
    await mkdir(artifactDir, { recursive: true });
    await writeFile(join(artifactDir, 'store-context.xml'), await browser.getPageSource());
    await browser.saveScreenshot(join(artifactDir, 'store-context.png'));
    await writeFile(join(artifactDir, 'store-context.json'), JSON.stringify({ ...context, settingsReadOnly: true }, null, 2));

    const homeTab = await browser.$(s.homeTab).getElement();
    if (!await homeTab.isDisplayed() || !await homeTab.isEnabled() || await homeTab.getAttribute('hittable') !== 'true') {
      throw new Error('POS store context was read, but the observed Home tab was unavailable for cleanup.');
    }
    await homeTab.click();
    await browser.waitUntil(async () => await browser.$(s.homeScreen).isDisplayed() && await homeTab.isSelected(), {
      timeout: 20_000,
      timeoutMsg: 'Shopify POS did not return to Home after the read-only store-context inspection.',
    });
  });
});
