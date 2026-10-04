import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { browser } from '@wdio/globals';
import { pos } from '../screens/pos.ts';
import * as s from '../screens/pos.selectors.ts';
import { readScenarioRequest } from '../support/input.ts';
import { posPin } from '../screens/pos-pin.ts';

describe('Shopify POS location-context inspection', () => {
  it('reads the configured POS location and returns to Home without changing settings', async () => {
    const request = await readScenarioRequest();
    await posPin.unlockIfLocked();
    if (request.scriptId !== 'pos.inspect-location' || request.assertionMode !== 'pos') {
      throw new Error('This native spec is bound to the pos.inspect-location read-only request.');
    }
    await pos.assertHome();

    const moreTab = await browser.$(s.moreTab).getElement();
    if (!await moreTab.isDisplayed() || !await moreTab.isEnabled() || await moreTab.getAttribute('hittable') !== 'true') {
      throw new Error('The observed POS More tab is unavailable; inspect the current build before changing selectors.');
    }
    await moreTab.click();
    await browser.waitUntil(async () => await browser.$(s.moreScreen).isDisplayed(), {
      timeout: 20_000,
      timeoutMsg: 'Shopify POS did not open the More menu.',
    });

    const settingsMenu = await browser.$(s.settingsMenu).getElement();
    if (!await settingsMenu.isDisplayed() || !await settingsMenu.isEnabled() || await settingsMenu.getAttribute('hittable') !== 'true') {
      throw new Error('The observed POS Settings menu item is unavailable; inspect the current build before changing selectors.');
    }
    await settingsMenu.click();
    await browser.waitUntil(async () => await browser.$(s.settingsScreen).isDisplayed(), {
      timeout: 20_000,
      timeoutMsg: 'Shopify POS did not open Settings from the More menu.',
    });

    const locations = await browser.$$(s.settingsLocationItem);
    const visible = [];
    for (const candidate of locations) {
      if (await candidate.isDisplayed()) visible.push(candidate);
    }
    if (visible.length !== 1) {
      throw new Error('The current POS Settings screen did not expose exactly one visible location item.');
    }
    const locationName = String(await visible[0].getAttribute('label') ?? '').trim();
    if (!locationName) throw new Error('The current POS location item has no readable label.');

    const artifactDir = resolve(process.env.RUN_ARTIFACT_DIR ?? join('artifacts', 'inspection-location'));
    await mkdir(artifactDir, { recursive: true });
    await writeFile(join(artifactDir, 'pos-location.xml'), await browser.getPageSource());
    await browser.saveScreenshot(join(artifactDir, 'pos-location.png'));
    await writeFile(join(artifactDir, 'pos-location.json'), JSON.stringify({
      locationName,
      source: 'Screen.Settings.LocationsItem',
      settingsReadOnly: true,
    }, null, 2));

    const homeTab = await browser.$(s.homeTab).getElement();
    if (!await homeTab.isDisplayed() || !await homeTab.isEnabled() || await homeTab.getAttribute('hittable') !== 'true') {
      throw new Error('POS location was read, but the observed Home tab was unavailable for cleanup.');
    }
    await homeTab.click();
    await browser.waitUntil(async () => await browser.$(s.homeScreen).isDisplayed() && await homeTab.isSelected(), {
      timeout: 20_000,
      timeoutMsg: 'Shopify POS did not return to Home after the read-only Settings inspection.',
    });
  });
});
