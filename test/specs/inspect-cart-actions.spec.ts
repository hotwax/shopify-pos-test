import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { browser } from '@wdio/globals';
import * as s from '../screens/pos.selectors.ts';
import { readScenarioRequest } from '../support/input.ts';

/**
 * Discovery only. Backs out of any open cash/payment surface, then opens the
 * cart's More actions menu and captures it so a clear-cart affordance can be
 * identified. It never completes a payment.
 */
describe('Shopify POS cart actions inspection', () => {
  it('backs out of checkout and captures the cart More actions menu', async () => {
    const request = await readScenarioRequest();
    if (request.scriptId !== 'pos.inspect-cart-actions' || request.assertionMode !== 'pos') {
      throw new Error('This native spec is bound to the pos.inspect-cart-actions request.');
    }
    const artifactDir = resolve(process.env.RUN_ARTIFACT_DIR ?? join('artifacts', 'inspection-cart-actions'));
    await mkdir(artifactDir, { recursive: true });

    if (await browser.$(s.acceptCashScreen).isDisplayed()) {
      const cancel = await browser.$(s.acceptCashCancelButton).getElement();
      if (await cancel.getAttribute('label') !== 'Cancel') throw new Error('The cash surface did not expose the observed Cancel action.');
      await cancel.click();
      await browser.waitUntil(async () => !await browser.$(s.acceptCashScreen).isDisplayed(), {
        timeout: 20_000, timeoutMsg: 'POS did not leave the cash surface after Cancel.',
      });
    }
    if (await browser.$(s.checkoutSelectPayment).isDisplayed()) {
      const close = await browser.$(s.customSaleCancelButton).getElement();
      if (await close.getAttribute('label') !== 'Close') throw new Error('The payment surface did not expose the observed Close action.');
      await close.click();
      await browser.waitUntil(async () => !await browser.$(s.checkoutSelectPayment).isDisplayed(), {
        timeout: 20_000, timeoutMsg: 'POS did not leave the payment selection surface after Close.',
      });
    }

    const more = await browser.$(s.cartMoreActionsButton).getElement();
    if (!await more.isDisplayed() || !await more.isEnabled() || await more.getAttribute('hittable') !== 'true') {
      throw new Error('The observed cart More actions button is unavailable.');
    }
    await more.click();
    await browser.waitUntil(async () => {
      const source = await browser.getPageSource();
      return source.includes('Clear') || source.includes('clear') || source.includes('Void');
    }, { timeout: 15_000, timeoutMsg: 'The cart More actions menu did not expose a recognizable clear action.' });

    await writeFile(join(artifactDir, 'cart-actions.xml'), await browser.getPageSource());
    await browser.saveScreenshot(join(artifactDir, 'cart-actions.png'));
  });
});
