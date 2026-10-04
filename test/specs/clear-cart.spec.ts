import { posReset } from '../screens/pos-reset.ts';
import { readScenarioRequest } from '../support/input.ts';
import { posPin } from '../screens/pos-pin.ts';

/**
 * Explicit cart cleanup utility. Backs out of any open cash, payment, receipt,
 * more-actions or custom-sale surface, then clears the cart if it holds lines.
 * It completes no payment and touches no committed order, so it creates no
 * business data.
 */
describe('Shopify POS cart cleanup utility', () => {
  it('backs out of open checkout surfaces and clears an unsold cart', async () => {
    const request = await readScenarioRequest();
    await posPin.unlockIfLocked();
    if (request.scriptId !== 'pos.clear-cart' || request.assertionMode !== 'pos') {
      throw new Error('This native spec is bound to the pos.clear-cart request.');
    }
    await posReset.clearCartAndReturnHome();
  });
});
