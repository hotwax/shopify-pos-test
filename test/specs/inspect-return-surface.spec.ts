import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { browser } from '@wdio/globals';
import { pos } from '../screens/pos.ts';
import * as s from '../screens/pos.selectors.ts';
import { readScenarioRequest } from '../support/input.ts';
import { posPin } from '../screens/pos-pin.ts';

describe('Shopify POS return and exchange surface inspection', () => {
  it('opens the observed non-committing surface without selecting a line or tender', async () => {
    const request = await readScenarioRequest();
    await posPin.unlockIfLocked();
    if (request.scriptId !== 'pos.inspect-return-surface' || request.assertionMode !== 'pos') {
      throw new Error('This native spec is bound to the pos.inspect-return-surface read-only request.');
    }
    await pos.assertHome();
    await pos.openOrders();
    const requestedReference = typeof request.parameters.orderReference === 'string' ? request.parameters.orderReference : '';
    const reference = requestedReference ? await pos.openOrderByReference(requestedReference) : await pos.openFirstOrder();
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

    // Any tap highlight already changes the tree, so wait for a screen the
    // order detail did not have (a new Screen.* identifier) rather than for
    // the first difference, and give the surface time to slide in.
    const screenIds = (source: string): Set<string> => new Set(source.match(/name="Screen\.[A-Za-z0-9._-]+"/g) ?? []);
    const before = screenIds(await browser.getPageSource());
    let latest = '';
    const opened = async (timeout: number): Promise<boolean> => {
      try {
        await browser.waitUntil(async () => {
          latest = await browser.getPageSource();
          return [...screenIds(latest)].some(id => !before.has(id));
        }, { timeout, interval: 1_000 });
        return true;
      } catch { return false; }
    };
    // An element tap on this control returns success and does nothing on POS
    // 11.14.0 (runs run-1789959781552 and run-1789959914509), so a raw
    // coordinate tap at the control's centre is tried next.
    await action.click();
    let openedBy = 'element-click';
    if (!await opened(8_000)) {
      const rect = await browser.getElementRect(action.elementId);
      await browser.execute('mobile: tap', { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) });
      openedBy = 'coordinate-tap';
      if (!await opened(12_000)) throw new Error(`The Return or exchange surface did not add a new screen to the native accessibility tree after an element tap and a coordinate tap at (${Math.round(rect.x + rect.width / 2)}, ${Math.round(rect.y + rect.height / 2)}).`);
    }

    const artifactDir = resolve(process.env.RUN_ARTIFACT_DIR ?? join('artifacts', 'inspection-return-surface'));
    await mkdir(artifactDir, { recursive: true });
    await writeFile(join(artifactDir, 'return-surface.xml'), latest);
    await browser.saveScreenshot(join(artifactDir, 'return-surface.png'));
    await writeFile(join(artifactDir, 'return-surface.json'), JSON.stringify({
      sourceOrderReference: reference,
      visibleActionCount: visible.length,
      openedSurface: true,
      openedBy,
      selectedLine: false,
      selectedTender: false,
      committed: false,
    }, null, 2));
  });
});
