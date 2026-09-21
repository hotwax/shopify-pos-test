import { pos } from '../screens/pos.ts';
import { readScenarioRequest } from '../support/input.ts';

describe('Shopify POS Orders', () => {
  it('opens the first listed order from Home', async () => {
    const request = await readScenarioRequest();
    if (request.scriptId !== 'pos.open-first-order' || request.assertionMode !== 'pos') {
      throw new Error('This native spec is bound to the pos.open-first-order read-only request.');
    }
    await pos.assertHome();
    await pos.openOrders();
    const reference = await pos.openFirstOrder();
    await pos.assertOrderDetail(reference);
  });
});
