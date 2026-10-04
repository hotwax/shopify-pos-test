import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { browser } from '@wdio/globals';
import { pos } from '../screens/pos.ts';
import * as s from '../screens/pos.selectors.ts';
import { readScenarioRequest } from '../support/input.ts';
import { posPin } from '../screens/pos-pin.ts';

describe('Shopify POS order-action inspection', () => {
  it('captures the first order detail without opening a return or exchange flow', async () => {
    const request = await readScenarioRequest();
    await posPin.unlockIfLocked();
    if (request.scriptId !== 'pos.inspect-order-actions' || request.assertionMode !== 'pos') {
      throw new Error('This native spec is bound to the pos.inspect-order-actions read-only request.');
    }
    await pos.assertHome();
    await pos.openOrders();
    const reference = await pos.openFirstOrder();
    await pos.assertOrderDetail(reference);

    const actions = await browser.$$(s.returnOrExchangeAction);
    let visible = 0;
    let action: WebdriverIO.Element | undefined;
    for (const candidate of actions) {
      if (await candidate.isDisplayed()) {
        visible++;
        action = candidate;
      }
    }

    const artifactDir = resolve(process.env.RUN_ARTIFACT_DIR ?? join('artifacts', 'inspection-order-actions'));
    await mkdir(artifactDir, { recursive: true });
    await writeFile(join(artifactDir, 'order-actions.xml'), await browser.getPageSource());
    await browser.saveScreenshot(join(artifactDir, 'order-actions.png'));
    await writeFile(join(artifactDir, 'order-actions.json'), JSON.stringify({
      visibleActionCount: visible,
      enabled: action ? await action.isEnabled() : false,
      hittable: action ? await action.getAttribute('hittable') : null,
    }, null, 2));

    if (visible !== 1) {
      throw new Error('The current order detail did not expose exactly one visible Return or exchange action; inspect the captured accessibility tree before changing selectors.');
    }
  });
});
