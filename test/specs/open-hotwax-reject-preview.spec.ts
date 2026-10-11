import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { browser } from '@wdio/globals';
import { pos } from '../screens/pos.ts';
import * as s from '../screens/pos.selectors.ts';
import { readScenarioRequest } from '../support/input.ts';

describe('HotWax Reject preview', () => {
  it('confirms item choices from the first page without submitting', async () => {
    const request = await readScenarioRequest();
    if (!['pos.open-hotwax-reject-preview', 'pos.open-hotwax-reject-multi-preview', 'pos.open-hotwax-fallback-preview', 'pos.open-hotwax-offline-preview', 'pos.open-hotwax-context-preview'].includes(request.scriptId) || request.assertionMode !== 'pos') {
      throw new Error('This spec is bound to the read-only HotWax Reject preview request.');
    }
    const button = (label: string) => browser.$(`-ios predicate string:type == "XCUIElementTypeButton" AND label == "${label}" AND visible == 1`);
    await browser.execute('mobile: activateApp', { bundleId: 'com.jadedpixel.pos' });
    const visibleExtension = '-ios predicate string:name == "Screen.UIExtensionModal" AND visible == 1';
    const visibleOrderDetail = '-ios predicate string:name == "Screen.OrderDetailsScreen" AND visible == 1';
    const multiOrder = request.parameters.orderReference as string | undefined;
    if (multiOrder && multiOrder !== 'HCDEV#5728') throw new Error('The multi-item stock assertions are bound to HCDEV#5728.');
    const confirmLabel = multiOrder ? 'Confirm rejection and pack' : 'Confirm rejection';
    const finalReason = multiOrder ? 'Not in Stock' : 'Damaged';
    if (await browser.$('~Screen.SingleSelectFiltersScreen').isDisplayed()) await button('Close').click();
    // Close the compact reason modal before tapping the underlying extension's Close button.
    if (await button('Apply reason').isDisplayed() && await button('Cancel').isDisplayed()) {
      await button('Cancel').click();
      await browser.waitUntil(async () => !await button('Apply reason').isDisplayed(), { timeout: 10_000 });
    }
    if (await button('Apply variance reason').isDisplayed() && await button('Cancel').isDisplayed()) {
      await button('Cancel').click();
      await browser.waitUntil(async () => !await button('Apply variance reason').isDisplayed(), { timeout: 10_000 });
    }
    if (await browser.$(visibleExtension).isDisplayed()) {
      await button('Close').click();
      await browser.waitUntil(async () => !await browser.$(visibleExtension).isDisplayed(), {
        timeout: 20_000,
      });
    }
    const currentReference = await browser.$('-ios predicate string:name == "OrderDetailsHeader.Title" AND visible == 1');
    const sameOrder = multiOrder && await browser.$(visibleOrderDetail).isDisplayed() &&
      await currentReference.isDisplayed() && (await currentReference.getAttribute('label'))?.trim() === multiOrder;
    // Repeated runs can reuse the verified order; a different order still goes through All orders search.
    if (await browser.$(visibleOrderDetail).isDisplayed() && !sameOrder) {
      await button('Close').click();
      await browser.waitUntil(async () => !await browser.$(visibleOrderDetail).isDisplayed(), {
        timeout: 20_000,
      });
    }
    const previewUrl = process.env.SHOPIFY_POS_PREVIEW_URL;
    async function attachPreview() {
      if (!previewUrl) return;
      await browser.execute('mobile: deepLink', { url: previewUrl });
      const consoleOpened = await browser.waitUntil(async () =>
        await browser.$('~POS Dev Console').isDisplayed(),
      { timeout: 12_000 }).catch(() => false);
      if (consoleOpened) {
        const persistence = await browser.$('~App persistence, Your dev extension will remain attached to POS even if POS is closed');
        if (await persistence.getAttribute('value') === '0') await persistence.click();
        await browser.$('~Component.ActionBar.PrimaryActionButton').click();
      }
    }
    await attachPreview();
    if (!await browser.$(s.detailScreen).isDisplayed()) {
      if (!await browser.$(s.homeScreen).isDisplayed()) await pos.returnHome();
      await pos.assertHome();
      await pos.openOrdersScreen();
      if (multiOrder) {
        await browser.$('~Screen.OrdersScreen.NavListContent.Item.OrdersWorkflow').click();
        await browser.$(s.orderSearchField).waitForDisplayed({ timeout: 10_000 });
        const posOnly = await browser.$('~Component.Filters.FilterButton.SaleType.Point of Sale');
        if (await posOnly.isDisplayed()) {
          await posOnly.click();
          const filterDir = resolve(process.env.RUN_ARTIFACT_DIR ?? 'artifacts/hotwax-reject-preview');
          await mkdir(filterDir, { recursive: true });
          await writeFile(join(filterDir, 'hotwax-order-channel.xml'), await browser.getPageSource());
          await browser.saveScreenshot(join(filterDir, 'hotwax-order-channel.png'));
          await browser.$('~Screen.SingleSelectfiltersScreen.FilterButton.ONLINE').click();
          await browser.waitUntil(async () => !await browser.$('~Screen.SingleSelectFiltersScreen').isDisplayed(), { timeout: 10_000 });
        }
        await pos.openOrderByReference(multiOrder);
        if (await button('Hide keyboard').isDisplayed()) await button('Hide keyboard').click();
      } else {
        await browser.$(s.shippingOrdersNav).click();
        const prepare = await browser.$(s.prepareForShippingTab);
        await prepare.waitForDisplayed({ timeout: 20_000 });
        if (!await prepare.isSelected()) await prepare.click();
        await browser.waitUntil(async () =>
          (await browser.$(s.ordersList).$$(s.orderRows).getElements()).length > 0,
        { timeout: 20_000 });
        await pos.openFirstOrder();
      }
    }
    const action = await browser.$('~HotWax Reject, by hc-rails-reassign-fulfillment');
    await action.waitForDisplayed({ timeout: 30_000,
      timeoutMsg: 'The Shopify dev preview is not attached to this POS order. Reopen its current mobile preview link.' });
    if (!await action.isEnabled() || await action.getAttribute('hittable') !== 'true') {
      throw new Error('HotWax Reject is not tappable on this order.');
    }
    await action.click();
    await browser.$(s.uiExtensionModal).waitForDisplayed({ timeout: 12_000,
      timeoutMsg: 'HotWax Reject did not open; refresh the Shopify POS dev preview.' });
    if (await button('Cancel').isDisplayed() && await button('Apply reason').isDisplayed()) await button('Cancel').click();
    await browser.waitUntil(async () => {
      return await browser.$('-ios predicate string:visible == 1 AND name IN {"No assigned items", "Unable to load items", "Ready for fulfillment", "Fulfillment is not ready", "Fulfillment does not match OMS", "OMS unavailable"}').isDisplayed();
    }, { timeout: 30_000, timeoutMsg: 'The HotWax Reject preview did not finish loading.' });

    const artifactDir = resolve(process.env.RUN_ARTIFACT_DIR ?? join('artifacts', 'hotwax-reject-preview'));
    await mkdir(artifactDir, { recursive: true });
    const previewSource = await browser.getPageSource();
    await writeFile(join(artifactDir, 'hotwax-reject-preview.xml'), previewSource);
    await browser.saveScreenshot(join(artifactDir, 'hotwax-reject-preview.png'));

    if (request.parameters.expectFallback) {
      const mode = request.parameters.expectFallback;
      const heading = mode === 'move-only' ? 'OMS unavailable' : 'Fulfillment does not match OMS';
      await browser.$(`~${heading}`).waitForDisplayed({ timeout: 30_000 });
      await button('Move fulfillment to Warehouse Agg').waitForDisplayed({ timeout: 15_000 });
      if (!await button('Move fulfillment to Warehouse Agg').isEnabled()) throw new Error('Shopify-only move is blocked by OMS availability.');
      if (await button('Confirm rejection and pack').isDisplayed()) throw new Error('Fallback must not pack any items.');
      if (mode === 'variance') {
        await button('Choose variance reason').waitForDisplayed({ timeout: 25_000 });
        await button('Choose variance reason').click();
        await button('Apply variance reason').waitForDisplayed({ timeout: 10_000 });
        const choice = (label: string) => browser.$(`-ios predicate string:type == "XCUIElementTypeOther" AND name BEGINSWITH "${label}, " AND visible == 1`);
        const stock = await browser.getPageSource();
        await writeFile(join(artifactDir, 'hotwax-fallback-variance-modal.xml'), stock);
        if (!stock.includes('Current · Available 26 · On-hand 26') || !stock.includes('Available 25 · On-hand 25 (−1)')) throw new Error('Real fallback stock variance preview is missing.');
        await browser.saveScreenshot(join(artifactDir, 'hotwax-fallback-variance-modal.png'));
        await choice('Damaged').click();
        await button('Apply variance reason').click();
        await button('Change variance reason').waitForDisplayed({ timeout: 10_000 });
        const selectedSource = await browser.getPageSource();
        if (!selectedSource.includes('Available 26 → 25 (−1)') || !selectedSource.includes('On-hand 26 → 25 (−1)')) throw new Error('The fallback summary lost its stock transition.');
        await button('Move fulfillment and record variance').waitForDisplayed({ timeout: 10_000 });
        if (!await button('Move fulfillment and record variance').isEnabled()) throw new Error('Fallback variance confirmation is disabled.');
        await button('Change variance reason').click();
        await button('Apply variance reason').waitForDisplayed({ timeout: 10_000 });
        await choice('No variance').click();
        await button('Cancel').click();
        await button('Change variance reason').waitForDisplayed({ timeout: 10_000 });
        if (!await button('Move fulfillment and record variance').isDisplayed()) throw new Error('Cancel cleared the selected variance.');
      } else if (await button('Choose variance reason').isDisplayed()) throw new Error('Offline fallback offered a variance write.');
      await writeFile(join(artifactDir, 'hotwax-fallback-confirmation.xml'), await browser.getPageSource());
      await browser.saveScreenshot(join(artifactDir, 'hotwax-fallback-confirmation.png'));
      // Read-only: never tap either move button or submit a variance.
      return;
    }

    if (process.env.SHOPIFY_POS_UI_ONLY !== '1' &&
        (!previewSource.includes('Ready for fulfillment') || !previewSource.includes('Choose rejection reason'))) {
      throw new Error('Shopify POS opened the extension, but the live OMS order or rejection reasons did not load.');
    }
    if (request.parameters.contextOnly) {
      if (!previewSource.includes('Ready for fulfillment') || !previewSource.includes('Choose rejection reason')) {
        throw new Error('The matching OMS fulfillment did not return after restoring the backend.');
      }
      return;
    }

    const choice = (label: string) => browser.$(`-ios predicate string:type == "XCUIElementTypeOther" AND name BEGINSWITH "${label}, " AND visible == 1`);
    const chooseReason = await button('Choose rejection reason');
    if (await chooseReason.isDisplayed()) {
      await chooseReason.click();
      await button('Apply reason').waitForDisplayed({ timeout: 10_000 });
      await browser.waitUntil(async () => await button('Apply reason').isEnabled(), { timeout: 25_000 });
      const reasonSource = await browser.getPageSource();
      await writeFile(join(artifactDir, 'hotwax-reject-reasons.xml'), reasonSource);
      await browser.saveScreenshot(join(artifactDir, 'hotwax-reject-reasons.png'));
      for (const reason of ['Mismatch', 'Not in Stock', 'Damaged', 'Worn Display']) {
        if (!reasonSource.includes(reason)) throw new Error(`Real OMS reason ${reason} is missing.`);
      }
      const keepY = (await choice('Keep for packing').getLocation()).y;
      const rejectY = (await choice('Mismatch').getLocation()).y;
      if (keepY >= rejectY) throw new Error('Keep for packing is not the first choice.');
      // The first observed row of HCDEV#5728 is Winter Jacket. The page source also contains the other row behind the modal.
      const available = multiOrder ? 125 : 99;
      const onHand = available + 1;
      if (!reasonSource.includes('Current → After (change)') ||
          !reasonSource.includes(`Available ${available} → ${available} (0)`) ||
          !reasonSource.includes(`Available ${available} → 0 (−${available})`) ||
          !reasonSource.includes(`On-hand ${onHand} → ${onHand} (0)`)) {
        throw new Error('The live local current/change/after inventory values are missing.');
      }
      const firstReason = multiOrder ? 'Damaged' : 'Not in Stock';
      await choice(firstReason).click();
      await browser.waitUntil(async () => (await choice(firstReason).getAttribute('traits') || '').includes('Selected'), { timeout: 10_000 });
      await writeFile(join(artifactDir, 'hotwax-reject-reason-selected.xml'), await browser.getPageSource());
      await button('Apply reason').click();
      await button('Change reason').waitForDisplayed({ timeout: 10_000 });
      await button('Change reason').click();
      await button('Apply reason').waitForDisplayed({ timeout: 10_000 });
      await browser.waitUntil(async () => await button('Apply reason').isEnabled(), { timeout: 25_000 });
      await choice(finalReason).click();
      if (!multiOrder) {
        await button('Cancel').click();
        await button('Change reason').waitForDisplayed({ timeout: 10_000 });
        if (!await browser.$('~Not in Stock').isDisplayed()) {
          throw new Error('Cancelling the modal changed the selected reason.');
        }
        await button('Change reason').click();
        await button('Apply reason').waitForDisplayed({ timeout: 10_000 });
        await browser.waitUntil(async () => await button('Apply reason').isEnabled(), { timeout: 25_000 });
        await choice('Keep for packing').click();
        await button('Apply reason').click();
        await button('Choose rejection reason').waitForDisplayed({ timeout: 10_000 });
        if (await button('Select an item to reject').isEnabled()) {
          throw new Error('Confirmation remained enabled after clearing the only rejection.');
        }
        await button('Choose rejection reason').click();
        await button('Apply reason').waitForDisplayed({ timeout: 10_000 });
        await browser.waitUntil(async () => await button('Apply reason').isEnabled(), { timeout: 25_000 });
        await choice('Damaged').click();
      }
      await button('Apply reason').click();
      await button('Change reason').waitForDisplayed({ timeout: 10_000 });
      if (!await browser.$(`~${finalReason}`).isDisplayed()) throw new Error('The new reason did not replace the previous choice.');
      const transition = multiOrder ? `Available ${available} → 0 (−${available})` : `Available ${available} → ${available} (0)`;
      if (!await browser.$(`-ios predicate string:visible == 1 AND name == "${transition}"`).isDisplayed()) {
        throw new Error('The selected item is missing its inventory transition on the full page.');
      }
      if (multiOrder) {
        // The rejected row now has Change reason; the sole Choose button belongs to the kept row.
        const keptButtons = await browser.$$('-ios predicate string:type == "XCUIElementTypeButton" AND label == "Choose rejection reason" AND visible == 1').getElements();
        if (keptButtons.length !== 1) throw new Error('Expected one rejected item and one kept item.');
        await keptButtons[0].click();
        await button('Apply reason').waitForDisplayed({ timeout: 10_000 });
        await browser.waitUntil(async () => await button('Apply reason').isEnabled(), { timeout: 25_000 });
        const secondSource = await browser.getPageSource();
        const secondAvailable = available === 189 ? 125 : 189;
        if (!secondSource.includes(`Available ${secondAvailable} → 0 (−${secondAvailable})`) ||
            !(await choice('Keep for packing').getAttribute('traits') || '').includes('Selected')) {
          throw new Error('The second item did not retain Keep for packing with its own real inventory balance.');
        }
        await writeFile(join(artifactDir, 'hotwax-reject-second-reasons.xml'), secondSource);
        await browser.saveScreenshot(join(artifactDir, 'hotwax-reject-second-reasons.png'));
        await choice('Not in Stock').click();
        await button('Cancel').click();
        await button('Choose rejection reason').waitForDisplayed({ timeout: 10_000 });
        if (!await browser.$(`~${finalReason}`).isDisplayed()) throw new Error('The second item modal changed the first item reason.');
      }
      if (!await button(confirmLabel).isDisplayed()) {
        const container = await browser.$(visibleExtension);
        const origin = await container.getLocation();
        const size = await container.getSize();
        await browser.execute('mobile: dragFromToForDuration', { duration: 0.3,
          fromX: origin.x + size.width * 0.6, fromY: origin.y + size.height * 0.75,
          toX: origin.x + size.width * 0.6, toY: origin.y + size.height * 0.35 });
      }
      await button(confirmLabel).waitForDisplayed({ timeout: 10_000 });
      if (!await button(confirmLabel).isEnabled()) throw new Error('The first page cannot be confirmed.');
      if (await button('Review 1 item').isDisplayed() || await button('Edit').isDisplayed()) {
        throw new Error('An unnecessary review step remains.');
      }
      const confirmationSource = await browser.getPageSource();
      if (!confirmationSource.includes(transition) || !await button('Change reason').isDisplayed()) {
        throw new Error('Confirmation is separated from the selected item and inventory transition.');
      }
      await writeFile(join(artifactDir, 'hotwax-reject-confirmation.xml'), confirmationSource);
      await browser.saveScreenshot(join(artifactDir, 'hotwax-reject-selection.png'));
      await browser.saveScreenshot(join(artifactDir, 'hotwax-reject-confirmation.png'));
      // Deliberately never tap Confirm: this scenario must not alter OMS fulfillment or inventory.
    }
  });
});
