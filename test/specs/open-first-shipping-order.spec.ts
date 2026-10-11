import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { browser } from '@wdio/globals';
import { pos } from '../screens/pos.ts';
import * as s from '../screens/pos.selectors.ts';
import { readScenarioRequest } from '../support/input.ts';

describe('Shopify POS Shipping orders', () => {
  it('opens the first Prepare for shipping order without changing it', async () => {
    const request = await readScenarioRequest();
    if (request.scriptId !== 'pos.open-first-shipping-order' || request.assertionMode !== 'pos') {
      throw new Error('This native spec is bound to the read-only shipping order request.');
    }

    if (await browser.$(s.uiExtensionModal).isDisplayed()) {
      const closeExtension = await browser.$(s.uiExtensionModal).$(s.detailCloseButton).getElement();
      if (!await closeExtension.isDisplayed() || !await closeExtension.isEnabled() ||
          await closeExtension.getAttribute('hittable') !== 'true') {
        throw new Error('The observed extension modal Close button is unavailable.');
      }
      await closeExtension.click();
      await browser.waitUntil(async () => !await browser.$(s.uiExtensionModal).isDisplayed(), {
        timeout: 20_000, timeoutMsg: 'Shopify POS did not close the extension modal.',
      });
    }
    if (await browser.$(s.detailScreen).isDisplayed()) {
      const close = await browser.$(s.orderDetailCloseButton).getElement();
      if (!await close.isDisplayed() || !await close.isEnabled() ||
          await close.getAttribute('hittable') !== 'true') {
        throw new Error('The observed order-detail Close button is unavailable.');
      }
      await close.click();
      await browser.$(s.homeTab).waitForDisplayed({ timeout: 20_000 });
    }
    if (!await browser.$(s.homeScreen).isDisplayed()) await pos.returnHome();
    await pos.assertHome();
    await pos.openOrdersScreen();
    const shipping = await browser.$(s.shippingOrdersNav).getElement();
    if (!await shipping.isDisplayed() || !await shipping.isEnabled() ||
        await shipping.getAttribute('hittable') !== 'true') {
      throw new Error('The observed Orders > Shipping navigation is unavailable.');
    }
    await shipping.click();

    const prepare = await browser.$(s.prepareForShippingTab);
    await prepare.waitForDisplayed({ timeout: 20_000 });
    if (!await prepare.isSelected()) {
      if (!await prepare.isEnabled() || await prepare.getAttribute('hittable') !== 'true') {
        throw new Error('The Prepare for shipping tab is unavailable.');
      }
      await prepare.click();
    }
    await browser.waitUntil(async () =>
      await prepare.isSelected() &&
      await browser.$(s.ordersList).isDisplayed() &&
      (await browser.$(s.ordersList).$$(s.orderRows).getElements()).length > 0,
    { timeout: 20_000, timeoutMsg: 'No loaded Prepare for shipping orders are visible.' });

    const reference = await pos.openFirstOrder();
    await pos.assertOrderDetail(reference);

    const artifactDir = resolve(process.env.RUN_ARTIFACT_DIR ?? join('artifacts', 'shipping-order'));
    await mkdir(artifactDir, { recursive: true });
    await writeFile(join(artifactDir, 'shipping-order-detail.xml'), await browser.getPageSource());
    await browser.saveScreenshot(join(artifactDir, 'shipping-order-detail.png'));
  });
});
