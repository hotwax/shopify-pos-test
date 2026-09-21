import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { browser } from '@wdio/globals';
import * as s from '../screens/pos.selectors.ts';
import { readScenarioRequest } from '../support/input.ts';

/**
 * Discovery only, and deliberately narrow: it expects POS to already be on the
 * observed payment-selection surface left by pos.inspect-checkout-surface. It
 * opens the Cash tender surface and captures it. It never confirms a payment,
 * so no order is created.
 */
describe('Shopify POS cash tender surface inspection', () => {
  it('opens the observed Cash tender surface and captures it without completing a sale', async () => {
    const request = await readScenarioRequest();
    if (request.scriptId !== 'pos.inspect-cash-tender' || request.assertionMode !== 'pos') {
      throw new Error('This native spec is bound to the pos.inspect-cash-tender request.');
    }
    if (!await browser.$(s.checkoutSelectPayment).isDisplayed()) {
      throw new Error('POS is not on the observed payment selection surface. Run pos.inspect-checkout-surface first.');
    }

    const cash = await browser.$(s.cashTenderButton).getElement();
    if (await cash.getAttribute('label') !== 'Cash') {
      throw new Error('The observed cash tender button did not carry the expected Cash label.');
    }
    if (!await cash.isDisplayed() || !await cash.isEnabled() || await cash.getAttribute('hittable') !== 'true') {
      throw new Error('The observed Cash tender option is unavailable.');
    }
    await cash.click();

    await browser.waitUntil(async () => {
      const source = await browser.getPageSource();
      return !source.includes('Screen.CheckoutSelectPayment.Giftcard');
    }, { timeout: 20_000, timeoutMsg: 'Shopify POS did not leave the payment selection surface after Cash was tapped.' });

    const artifactDir = resolve(process.env.RUN_ARTIFACT_DIR ?? join('artifacts', 'inspection-cash-tender'));
    await mkdir(artifactDir, { recursive: true });
    await writeFile(join(artifactDir, 'cash-tender.xml'), await browser.getPageSource());
    await browser.saveScreenshot(join(artifactDir, 'cash-tender.png'));
  });
});
