import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pos } from '../screens/pos.ts';
import { posReset } from '../screens/pos-reset.ts';
import type { CartLineRequest } from '../screens/pos-cart.ts';
import { buildCart, readBoundedCartTotal } from '../flows/cash-sale.ts';
import { validateCreateOrder } from '../../core/safety/transaction-inputs.ts';
import { readScenarioRequest } from '../support/input.ts';
import { posPin } from '../screens/pos-pin.ts';
import { reportProgress } from '../support/progress.ts';

/**
 * Timing and rehearsal run for the cash-sale cart phase. It adds the frozen
 * lines exactly as the cash order would, reads the bounded total, then clears
 * the cart and stops. No checkout is opened and no order is created, so it can
 * be repeated freely while the screen routines are being tuned.
 */
describe('Shopify POS cart build rehearsal', () => {
  it('adds the frozen lines, reads the total, and clears the cart without paying', async () => {
    const request = await readScenarioRequest();
    await posPin.unlockIfLocked();
    if (request.scriptId !== 'pos.build-cart-only' || request.assertionMode !== 'pos') {
      throw new Error('This native spec is bound to the pos.build-cart-only request.');
    }
    const parameters = validateCreateOrder(request.parameters as unknown as Parameters<typeof validateCreateOrder>[0]);
    const lines: CartLineRequest[] = parameters.lines;
    const artifactDir = resolve(process.env.RUN_ARTIFACT_DIR ?? join('artifacts', 'build-cart-only'));
    await mkdir(artifactDir, { recursive: true });

    await reportProgress('Checking Shopify POS is on Home with an empty cart');
    await pos.assertHome();
    await pos.assertEmptyCart();
    await reportProgress('POS is on Home and the cart is empty');

    await buildCart(lines);
    const total = await readBoundedCartTotal(artifactDir);
    await reportProgress(`Cart built; total ${total.label}. Clearing the cart without checking out`);
    await posReset.clearCartAndReturnHome();
    await reportProgress('Cart cleared; POS is back on Home');
  });
});
