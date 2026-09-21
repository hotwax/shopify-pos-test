import { readScenarioRequest } from '../support/input.ts';

describe('Shopify POS mutation workflows', () => {
  it('fails closed until the live native selector and readback contract is approved', async () => {
    const request = await readScenarioRequest();
    if (!['pos.create-cash-order'].includes(request.scriptId)) {
      throw new Error('This native spec is bound only to the registered POS mutation scenarios.');
    }
    throw new Error('Native POS mutation execution is not registered yet. Complete live selector, test-store context and post-action readback verification before enabling this scenario.');
  });
});
