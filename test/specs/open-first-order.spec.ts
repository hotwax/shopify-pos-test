import { pos } from '../screens/pos.ts';

describe('Shopify POS Orders', () => {
  it('opens the first listed order from Home', async () => {
    await pos.assertHome();
    await pos.openOrders();
    const reference = await pos.openFirstOrder();
    await pos.assertOrderDetail(reference);
  });
});
