import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { browser } from '@wdio/globals';
import { readScenarioRequest } from '../support/input.ts';
import { posPin } from '../screens/pos-pin.ts';
import * as s from '../screens/pos.selectors.ts';

describe('Shopify POS Home navigation utility', () => {
  it('returns to Home through the observed native tab without resetting POS', async () => {
    const request = await readScenarioRequest();
    await posPin.unlockIfLocked();
    if (request.scriptId !== 'pos.navigate-home' || request.assertionMode !== 'pos') {
      throw new Error('This native spec is bound to the pos.navigate-home read-only request.');
    }
    if (await browser.$('XCUIElementTypeAlert').isDisplayed()) {
      throw new Error('Dismiss the blocking iOS/POS alert yourself before testing.');
    }

    const homeTab = await browser.$(s.homeTab).getElement();
    let closedSearch = false;
    let closedDetail = false;
    if (await browser.$(s.searchScreen).isDisplayed()) {
      const backButtons = await browser.$$(s.searchBackButton);
      let back: WebdriverIO.Element | undefined;
      for (const candidate of backButtons) {
        if (await candidate.isDisplayed()) {
          back = candidate;
          break;
        }
      }
      if (!back || !await back.isEnabled() || await back.getAttribute('hittable') !== 'true') {
        throw new Error('The observed POS Search Back button is unavailable; inspect the current build before changing selectors.');
      }
      await back.click();
      closedSearch = true;
      await browser.waitUntil(async () => !await browser.$(s.searchScreen).isDisplayed(), {
        timeout: 20_000,
        timeoutMsg: 'Shopify POS did not close the read-only Search surface.',
      });
    }
    // A discovery run can leave the custom sale modal open, which covers the tab
    // bar. Cancel is the observed dismissal and adds nothing to the cart.
    let closedCustomSale = false;
    if (await browser.$(s.customSaleScreen).isDisplayed()) {
      const cancel = await browser.$(s.customSaleCancelButton).getElement();
      if (await cancel.getAttribute('label') !== 'Cancel') {
        throw new Error('The custom sale action bar did not expose the observed Cancel action; inspect the current build before changing selectors.');
      }
      if (!await cancel.isDisplayed() || !await cancel.isEnabled() || await cancel.getAttribute('hittable') !== 'true') {
        throw new Error('The observed custom sale Cancel action is unavailable.');
      }
      await cancel.click();
      closedCustomSale = true;
      await browser.waitUntil(async () => !await browser.$(s.customSaleScreen).isDisplayed(), {
        timeout: 20_000,
        timeoutMsg: 'Shopify POS did not close the custom sale surface after Cancel.',
      });
    }
    void closedCustomSale;

    if (await browser.$(s.detailScreen).isDisplayed() || !await homeTab.isDisplayed()) {
      const close = await browser.$(s.detailCloseButton).getElement();
      if (!await close.isDisplayed() || !await close.isEnabled() || await close.getAttribute('hittable') !== 'true') {
        throw new Error('The observed POS Home tab and order-detail Close button are unavailable; inspect the current build before changing selectors.');
      }
      await close.click();
      closedDetail = true;
      await browser.waitUntil(async () => await homeTab.isDisplayed(), {
        timeout: 20_000,
        timeoutMsg: 'Shopify POS did not expose the Home tab after closing the read-only detail surface.',
      });
    }
    if (!await homeTab.isEnabled() || await homeTab.getAttribute('hittable') !== 'true') {
      throw new Error('The observed POS Home tab is not available; inspect the current build before changing selectors.');
    }
    const alreadyHome = await browser.$(s.homeScreen).isDisplayed() && await homeTab.isSelected();
    if (!alreadyHome) await homeTab.click();
    await browser.waitUntil(async () => await browser.$(s.homeScreen).isDisplayed() && await homeTab.isSelected(), {
      timeout: 20_000,
      timeoutMsg: 'Shopify POS did not return to Home after selecting the observed Home tab.',
    });

    const artifactDir = resolve(process.env.RUN_ARTIFACT_DIR ?? join('artifacts', 'navigation-home'));
    await mkdir(artifactDir, { recursive: true });
    await writeFile(join(artifactDir, 'home-navigation.xml'), await browser.getPageSource());
    await browser.saveScreenshot(join(artifactDir, 'home-navigation.png'));
    await writeFile(join(artifactDir, 'home-navigation.json'), JSON.stringify({ alreadyHome, closedSearch, closedDetail, homeSelected: true }, null, 2));
  });
});
