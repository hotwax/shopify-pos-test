import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { browser } from '@wdio/globals';
import { pinPadTapCoordinates } from './pos-pin.ts';

/** Reuse existing Demo access; never alter locking settings or log inputs. */
export async function prepareDemoPosSession(): Promise<void> {
  await browser.execute('mobile: activateApp', { bundleId: 'com.jadedpixel.pos' });
  // Activation can report Home before the lock overlay finishes appearing.
  // Match the visible PIN view rather than the retained hidden container.
  await browser.pause(750);
  const pinSelector = '-ios predicate string:name == "Screen.PinVerification" AND visible == 1';
  // Re-query the predicate each time. An already-resolved element can remain
  // in POS's tree after unlock; isExisting on that cached handle does not
  // re-evaluate the visibility predicate.
  const pinVisible = async () => await browser.$(pinSelector).isExisting();
  if (await pinVisible()) {
    if (process.env.POS_PRIVATE_INPUT !== '1') throw new Error('Saved Demo access requires private input logging.');
    const shop = await browser.$('-ios predicate string:type == "XCUIElementTypeStaticText" AND name == "hotwax-demo" AND visible == 1');
    if (!await shop.isDisplayed()) throw new Error('Saved Demo access cannot be used in another POS shop.');
    const path = resolve(process.env.IOS_TESTING_ROOT!, '.runtime/shop-pins.local.json');
    if ((await stat(path)).mode & 0o077) throw new Error('Saved POS access requires a private local file.');
    const saved = JSON.parse(await readFile(path, 'utf8')).shops?.['hotwax-demo']?.posPin;
    const pin = typeof saved === 'string' || typeof saved === 'number' ? String(saved) : '';
    if (!/^\d{4,6}$/.test(pin)) throw new Error('Saved Demo POS access is unavailable.');
    try {
      const settings = await browser.getSettings();
      try {
        await browser.updateSettings({ waitForIdleTimeout: 0, animationCoolOffTimeout: 0 });
        const remove = await browser.$('~Component.PINPad.KeyPad.DeleteButton');
        for (let remaining = 6; remaining > 0 && await remove.isEnabled(); remaining--) await remove.click();
        const points = pinPadTapCoordinates(await browser.getPageSource(), pin);
        for (const point of points) {
          await browser.execute('mobile: tap', point);
          await browser.pause(100);
        }
      } finally {
        await browser.updateSettings({ waitForIdleTimeout: settings.waitForIdleTimeout, animationCoolOffTimeout: settings.animationCoolOffTimeout });
      }
      const submit = await browser.$('~Component.PINPad.KeyPad.SubmitButton');
      if (await pinVisible() && await submit.isEnabled()) await submit.click();
      // POS can retain the hidden PIN view after signing in. Its visibility
      // determines whether the user is still being asked for a PIN.
      await browser.waitUntil(async () => !await pinVisible(), { timeout: 15_000 });
    } catch { throw new Error('Saved Demo POS sign-in did not finish; no input was recorded.'); }
  }
  // Only dismiss an observed non-committing app panel. An unsold cart stays intact.
  const receiving = await browser.$('-ios predicate string:type == "XCUIElementTypeOther" AND name == "Receiving" AND visible == 1');
  if (await receiving.isExisting()) {
    const close = await browser.$('-ios predicate string:type == "XCUIElementTypeButton" AND name == "Close" AND visible == 1');
    if (!await close.isExisting() || !await close.isEnabled()) throw new Error('Receiving cannot be closed through its observed control.');
    const rect = await browser.getElementRect(await close.elementId);
    await browser.execute('mobile: tap', { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) });
    await browser.waitUntil(async () => !await receiving.isExisting(), { timeout: 15_000 });
    await browser.execute('mobile: activateApp', { bundleId: 'com.jadedpixel.pos' });
  }
}
