import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { browser } from '@wdio/globals';
import { pos } from '../screens/pos.ts';
import * as s from '../screens/pos.selectors.ts';
import { readScenarioRequest } from '../support/input.ts';

describe('Shopify POS return and exchange surface inspection', () => {
  it('opens the observed non-committing surface without selecting a line or tender', async () => {
    const request = await readScenarioRequest();
    if (request.scriptId !== 'pos.inspect-return-surface' || request.assertionMode !== 'pos') {
      throw new Error('This native spec is bound to the pos.inspect-return-surface read-only request.');
    }
    await pos.assertHome();
    await pos.openOrders();
    const reference = await pos.openFirstOrder();
    await pos.assertOrderDetail(reference);

    const actions = await browser.$$(s.returnOrExchangeAction);
    const visible = [];
    for (const candidate of actions) {
      if (await candidate.isDisplayed()) visible.push(candidate);
    }
    if (visible.length !== 1) {
      throw new Error('The current order detail did not expose exactly one visible Return or exchange action; inspect the captured order-action artifact before changing selectors.');
    }
    const action = visible[0];
    if (!await action.isEnabled() || await action.getAttribute('hittable') !== 'true') {
      throw new Error('The current Return or exchange action is not enabled and hittable for this order; no return/exchange surface was opened.');
    }

    const before = await browser.getPageSource();
    await action.click();
    await browser.waitUntil(async () => await browser.getPageSource() !== before, {
      timeout: 10_000,
      timeoutMsg: 'The Return or exchange surface did not change the native accessibility tree after opening.',
    });

    const artifactDir = resolve(process.env.RUN_ARTIFACT_DIR ?? join('artifacts', 'inspection-return-surface'));
    await mkdir(artifactDir, { recursive: true });
    await writeFile(join(artifactDir, 'return-surface.xml'), await browser.getPageSource());
    await browser.saveScreenshot(join(artifactDir, 'return-surface.png'));
    await writeFile(join(artifactDir, 'return-surface.json'), JSON.stringify({
      sourceOrderReference: reference,
      visibleActionCount: visible.length,
      openedSurface: true,
      selectedLine: false,
      selectedTender: false,
      committed: false,
    }, null, 2));
  });
});
