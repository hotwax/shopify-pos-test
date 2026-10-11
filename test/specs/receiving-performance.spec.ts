import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { browser } from '@wdio/globals';
import { readScenarioRequest } from '../support/input.ts';
import { pinPadTapCoordinates } from '../support/pos-pin.ts';

describe('Receiving in physical Shopify POS', () => {
  it('opens the embedded app and records loading without receiving inventory', async () => {
    const request = await readScenarioRequest();
    if (request.scriptId !== 'pos.receiving-performance' || request.assertionMode !== 'pos') {
      throw new Error('This spec requires the read-only Receiving performance request.');
    }
    if (process.env.POS_PRIVATE_INPUT !== '1') throw new Error('Private input logging must be enabled before reading saved shop access.');
    const artifactDir = resolve(process.env.RUN_ARTIFACT_DIR!);
    await mkdir(artifactDir, { recursive: true });
    // A retained iPad keyboard menu can cover the app Close control from a prior run.
    const retainedShowKeyboard = await browser.$('-ios predicate string:type == "XCUIElementTypeButton" AND name == "Show Keyboard" AND visible == 1');
    if (await retainedShowKeyboard.isExisting()) {
      await retainedShowKeyboard.click();
      await browser.waitUntil(() => browser.isKeyboardShown(), { timeout: 10_000 });
      await browser.saveScreenshot(join(artifactDir, 'retained-keyboard-expanded.png'));
      const hide = await browser.$('-ios predicate string:type == "XCUIElementTypeButton" AND name == "Hide keyboard" AND visible == 1');
      if (await hide.isExisting()) await hide.click();
    }
    const pinScreen = await browser.$('~Screen.PinVerification');
    if (request.parameters.verifyPinEntry && !await pinScreen.isDisplayed()) {
      const modal = await browser.$('-ios predicate string:type == "XCUIElementTypeOther" AND name == "Receiving"');
      if (await modal.isExisting()) await browser.$('-ios predicate string:type == "XCUIElementTypeButton" AND name == "Close" AND visible == 1').click();
      await browser.$('~Screen.Home').waitForExist({ timeout: 15_000 });
      await browser.$('~Component.AppNavigation.TabBar.NavUtility.lockScreen').click();
      await pinScreen.waitForDisplayed({ timeout: 10_000 });
    }
    if (await pinScreen.isDisplayed()) {
      const staleKeyboard = await browser.$('-ios predicate string:type == "XCUIElementTypeButton" AND name == "Hide keyboard" AND visible == 1');
      if (await staleKeyboard.isExisting()) {
        await staleKeyboard.click();
        await browser.waitUntil(async () => !await browser.isKeyboardShown(), { timeout: 10_000 });
      }
      const shopName = String(request.parameters.shopName);
      const currentShop = await browser.$(`-ios predicate string:type == "XCUIElementTypeStaticText" AND name == "${shopName.replaceAll('"', '\\"')}" AND visible == 1`);
      if (!await currentShop.isDisplayed()) throw new Error('The current POS shop does not match the configured login shop.');
      const accessPath = resolve(process.env.IOS_TESTING_ROOT!, '.runtime/shop-pins.local.json');
      if ((await stat(accessPath)).mode & 0o077) throw new Error('The local shop access file must have mode 0600.');
      const access = JSON.parse(await readFile(accessPath, 'utf8'));
      const savedPin = access.shops?.[shopName]?.posPin;
      const pin = typeof savedPin === 'string' || typeof savedPin === 'number' ? String(savedPin) : '';
      if (!/^\d{4,6}$/.test(pin)) throw new Error('No valid local POS PIN is saved for the configured shop.');
      try {
        const settings = await browser.getSettings();
        let touchSequenceMs = 0;
        try {
          // This visible static keypad is already verified. Avoid an idle wait per digit.
          await browser.updateSettings({ waitForIdleTimeout: 0, animationCoolOffTimeout: 0 });
          const remove = await browser.$('~Component.PINPad.KeyPad.DeleteButton');
          for (let remaining = 6; remaining > 0 && await remove.isEnabled(); remaining--) await remove.click();
          // Cleanup can move the keypad; map only after the keyboard is gone.
          if (await browser.isKeyboardShown()) {
            await staleKeyboard.click();
            await browser.waitUntil(async () => !await browser.isKeyboardShown(), { timeout: 10_000 });
          }
          const keypad = pinPadTapCoordinates(await browser.getPageSource(), pin);
          const entryStarted = Date.now();
          for (const point of keypad) {
            await browser.execute('mobile: tap', point);
            await browser.pause(100);
          }
          touchSequenceMs = Date.now() - entryStarted;
        } finally {
          await browser.updateSettings({ waitForIdleTimeout: settings.waitForIdleTimeout, animationCoolOffTimeout: settings.animationCoolOffTimeout });
        }
        await writeFile(join(artifactDir, 'pin-entry-timing.json'), JSON.stringify({ touchSequenceMs, measurement: 'Mapped ordered taps; excludes keypad discovery, unfinished-entry cleanup, timing-setting changes and Home verification. No PIN or touch coordinates recorded.' }, null, 2));
        const submit = await browser.$('~Component.PINPad.KeyPad.SubmitButton');
        if (await pinScreen.isDisplayed() && await submit.isEnabled()) await submit.click();
        await browser.waitUntil(async () =>
          !await pinScreen.isExisting() && (await browser.$('~Screen.Home').isExisting() ||
          await browser.$('-ios predicate string:type == "XCUIElementTypeOther" AND name == "Receiving"').isExisting()),
        { timeout: 15_000 });
      } catch { throw new Error('Saved POS login did not reach Home. No PIN was recorded in the test output.'); }
    }
    const receivingModal = await browser.$('-ios predicate string:type == "XCUIElementTypeOther" AND name == "Receiving"');
    if (await receivingModal.isExisting()) await browser.$('-ios predicate string:type == "XCUIElementTypeButton" AND name == "Close" AND visible == 1').click();
    await browser.$('~Screen.Home').waitForExist({ timeout: 15_000 });
    if (await pinScreen.isExisting() || await receivingModal.isExisting() || !await browser.$('~Component.AppNavigation.BottomTabs.Home').isSelected()) {
      throw new Error('Receiving performance requires unlocked POS Home.');
    }
    // POS sometimes leaves Home's AX visibility false after closing its app modal.
    // The captured Home screen and selected Home tab identify this observed tile.
    const tile = await browser.$('-ios predicate string:type == "XCUIElementTypeButton" AND name == "Receiving"');
    await tile.waitForExist({ timeout: 10_000 });
    const capture = async (name: string) => {
      await writeFile(join(artifactDir, `${name}.xml`), await browser.getPageSource());
      await browser.saveScreenshot(join(artifactDir, `${name}.png`));
    };
    await capture('home');
    await browser.startRecordingScreen({ videoType: 'libx264', videoFps: 10, videoScale: '1390:-2', timeLimit: 300, forceRestart: true });
    try {
      const openedAt = Date.now();
      const rect = await browser.getElementRect(await tile.elementId);
      await browser.execute('mobile: tap', { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) });
      const samples: { name: string; elapsedMs: number }[] = [];
      const trackingRow = () => browser.$('-ios predicate string:type == "XCUIElementTypeButton" AND name CONTAINS "M100053" AND visible == 1');
      for (const name of ['opened', 'toolbar-ready', 'first-order-ready'] as const) {
        if (name === 'toolbar-ready') await browser.$('-ios predicate string:type == "XCUIElementTypeSearchField" AND name == "search text" AND visible == 1').waitForExist({ timeout: 60_000 });
        if (name === 'first-order-ready') await trackingRow().waitForExist({ timeout: 60_000 });
        samples.push({ name, elapsedMs: Date.now() - openedAt });
        await capture(name);
      }
      await writeFile(join(artifactDir, 'loading-samples.json'), JSON.stringify({
        shopName: request.parameters.shopName, samples,
        measurement: 'Elapsed time includes WDA tap and screenshot/accessibility capture overhead; not an in-app latency benchmark.',
      }, null, 2));
      const contexts = await browser.execute('mobile: getContexts', { waitForWebviewMs: 2_000 }) as any[];
      const safeContexts = contexts.map(context => {
        let url: string | undefined;
        try { const parsed = new URL(context.url); url = parsed.origin + parsed.pathname; } catch { /* native context has no URL */ }
        return { id: context.id, bundleId: context.bundleId, title: context.title, url };
      });
      await writeFile(join(artifactDir, 'contexts.json'), JSON.stringify(safeContexts, null, 2));
      const receivingContext = contexts.find(context => context.url?.includes('/apps/receiving-hotwax-demo'));
      if (!receivingContext) throw new Error('The real embedded Receiving webview is unavailable for performance inspection.');
      await browser.switchContext(receivingContext.id);
      const frames = await browser.execute(() => [...document.querySelectorAll('iframe')].map((frame, index) => {
        let url = '';
        try { const parsed = new URL(frame.src); url = parsed.origin + parsed.pathname; } catch { /* omit invalid URLs */ }
        return { index, title: frame.title, id: frame.id, url };
      }));
      await writeFile(join(artifactDir, 'frames.json'), JSON.stringify(frames, null, 2));
      if (frames.length !== 1) throw new Error('Inspect the embedded frame inventory before choosing a Receiving frame.');
      if (request.parameters.expectedFrameOrigin && new URL(frames[0].url).origin !== request.parameters.expectedFrameOrigin) {
        throw new Error('The iPad Receiving tile is not loading the requested local preview origin.');
      }
      await writeFile(join(artifactDir, 'webview-diagnostics.json'), JSON.stringify({
        url: frames[0].url,
        javascriptInspection: 'Safari remote debugger blocks this cross-origin Receiving frame; native measurements only.',
      }, null, 2));
      await browser.switchContext('NATIVE_APP');
      if (request.parameters.startupOnly) return;
      const actionTimes: { action: string; durationMs: number }[] = [];
      const measure = async (action: string, work: () => Promise<void>) => {
        const start = Date.now();
        await work();
        actionTimes.push({ action, durationMs: Date.now() - start });
        await writeFile(join(artifactDir, 'action-times.json'), JSON.stringify({
          measurement: 'Native automation observation time, including WDA round trips and typing. Use video to assess visual response.',
          actionTimes,
        }, null, 2));
      };
      await trackingRow().waitForExist({ timeout: 30_000 });
      const search = () => browser.$('-ios predicate string:type == "XCUIElementTypeSearchField" AND name == "search text" AND visible == 1');
      await measure('tracking-search', async () => {
        await search().click();
        await search().setValue('78552488');
        await browser.waitUntil(async () => {
          const rows = await browser.$$('-ios predicate string:type == "XCUIElementTypeButton" AND name CONTAINS "Item count:" AND visible == 1').getElements();
          return await search().getAttribute('value') === '78552488' && rows.length === 1 && await trackingRow().isExisting();
        }, { timeout: 15_000 });
      });
      await capture('tracking-search');
      await measure('tracking-enter-to-detail', async () => {
        await browser.keys('Enter');
        await browser.$('-ios predicate string:type == "XCUIElementTypeStaticText" AND name == "Transfer Order Details" AND visible == 1').waitForExist({ timeout: 20_000 });
      });
      if (request.parameters.verifyScannerKeyboard) {
        await browser.waitUntil(async () => !await browser.isKeyboardShown(), { timeout: 10_000 });
        await capture('detail-without-keyboard');
        const scanField = await browser.$('-ios predicate string:type == "XCUIElementTypeTextField" AND name == "Scan items" AND visible == 1');
        const scanRect = await browser.getElementRect(await scanField.elementId);
        await browser.execute("mobile: tap", { x: Math.round(scanRect.x + scanRect.width / 2), y: Math.round(scanRect.y + scanRect.height / 2) });
        if (request.parameters.expandCompactKeyboard && !await browser.isKeyboardShown()) {
          await capture('scanner-compact-keyboard');
          const compactKeyboard = await browser.$('-ios predicate string:type == "XCUIElementTypeButton" AND name == "Keyboard" AND visible == 1');
          await compactKeyboard.waitForExist({ timeout: 5_000 });
          await compactKeyboard.click();
          await capture('scanner-keyboard-menu');
          const showKeyboard = await browser.$('-ios predicate string:type == "XCUIElementTypeButton" AND name == "Show Keyboard" AND visible == 1');
          await showKeyboard.waitForExist({ timeout: 5_000 });
          await showKeyboard.click();
        }
        await browser.waitUntil(() => browser.isKeyboardShown(), { timeout: 10_000 });
        await capture('scanner-manual-keyboard');
        await scanField.setValue('audit-entry');
        if (await scanField.getAttribute('value') !== 'audit-entry') throw new Error('Manual scan input did not retain typed text.');
        await capture('scanner-manual-entry');
        await scanField.clearValue();
        // WDA clearValue can dismiss the full keyboard on this iPadOS build.
        const hideKeyboard = await browser.$('-ios predicate string:type == "XCUIElementTypeButton" AND name == "Hide keyboard" AND visible == 1');
        if (await hideKeyboard.isExisting()) await hideKeyboard.click();
      }
      await capture('tracking-detail');
      const back = await browser.$('-ios predicate string:type == "XCUIElementTypeButton" AND (name == "back" OR name == "Back") AND visible == 1');
      await measure('detail-back-to-list', async () => {
        await back.click();
        await search().waitForExist({ timeout: 15_000 });
      });
      await search().clearValue();
      await measure('completed-page', async () => {
        await browser.$('-ios predicate string:type == "XCUIElementTypeButton" AND name == "COMPLETED" AND visible == 1').click();
        await browser.waitUntil(async () => !await browser.$('-ios predicate string:name == "Loading" AND visible == 1').isExisting(), { timeout: 30_000 });
      });
      await capture('completed');
      await measure('back-to-cached-open', async () => {
        await browser.$('-ios predicate string:type == "XCUIElementTypeButton" AND name == "OPEN" AND visible == 1').click();
        await trackingRow().waitForExist({ timeout: 15_000 });
      });
      await capture('open-again');
      if (request.parameters.verifySecondaryPages) {
        for (const page of ['Settings', 'Purchase Orders', 'Returns']) {
          await browser.$(`-ios predicate string:type == "XCUIElementTypeLink" AND name == "${page}" AND visible == 1`).click();
          const marker = page === 'Settings' ? 'Force scan' : page;
          await browser.$(`-ios predicate string:type == "XCUIElementTypeStaticText" AND name == "${marker}" AND visible == 1`).waitForExist({ timeout: 20_000 });
          if (page !== 'Settings') await search().waitForExist({ timeout: 20_000 });
          await capture('secondary-' + page.toLowerCase().replaceAll(' ', '-'));
        }
        await browser.$('-ios predicate string:type == "XCUIElementTypeLink" AND name == "Transfer Orders" AND visible == 1').click();
        await search().waitForExist({ timeout: 20_000 });
        await capture('secondary-return-to-transfers');
      }
      if (request.parameters.verifySourceUpdate) {
        if (!request.parameters.expectedFrameOrigin) throw new Error('Source-update verification requires a verified local preview origin.');
        const sourcePath = '/Users/adityapatel/Documents/GitHub/ionic-apps/accxui/apps/receiving/src/views/TransferOrders.vue';
        const source = await readFile(sourcePath, 'utf8');
        const originalTitle = '<ion-title>{{ translate("Transfer Orders") }}</ion-title>';
        const markerTitle = '<ion-title>Transfer Orders (local source check)</ion-title>';
        if (!source.includes(originalTitle)) throw new Error('Inspect the current primary checkout title before modifying it.');
        const marked = source.replace(originalTitle, markerTitle);
        const marker = () => browser.$('-ios predicate string:type == "XCUIElementTypeStaticText" AND name == "Transfer Orders (local source check)" AND visible == 1');
        await search().setValue('78552488');
        const hideKeyboard = await browser.$('-ios predicate string:type == "XCUIElementTypeButton" AND name == "Hide keyboard" AND visible == 1');
        if (await hideKeyboard.isExisting()) await hideKeyboard.click();
        await writeFile(sourcePath, marked);
        try {
          await measure('local-source-update-to-pos', async () => {
            await marker().waitForExist({ timeout: 15_000 });
          });
          if (await search().getAttribute('value') !== '78552488') throw new Error('The source update reset the active tracking search.');
          await capture('source-marker');
        } finally {
          if (await readFile(sourcePath, 'utf8') !== marked) throw new Error('The source changed during verification; inspect it before restoring.');
          await writeFile(sourcePath, source);
        }
        await browser.waitUntil(async () => !await marker().isExisting(), { timeout: 15_000 });
        await trackingRow().waitForExist({ timeout: 30_000 });
        if (await search().getAttribute('value') !== '78552488') throw new Error('Restoring the source reset the active tracking search.');
        await capture('source-restored');
      }
    } finally {
      const recording = await browser.stopRecordingScreen();
      if (recording) await writeFile(join(artifactDir, 'receiving-pos.mp4'), Buffer.from(recording, 'base64'));
    }
  });
});
