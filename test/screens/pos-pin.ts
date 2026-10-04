import { browser } from '@wdio/globals';
import { readPosPin } from '../../core/storage/pos-pin.ts';
import * as s from './pos.selectors.ts';
import { clickIfPresent, enabledIfPresent, isPresent, waitForGone } from './wait.ts';

const elementKey = 'element-6066-11e4-a52e-4f735466cecf';

interface Point { x: number; y: number }

export async function tapPinDigits<Key>(pin: string, keys: Map<string, Key>, tap: (key: Key) => Promise<unknown>): Promise<void> {
  const keysInPinOrder = [...pin].map(digit => keys.get(digit));
  if (keysInPinOrder.some(key => key === undefined)) throw new Error('The Shopify POS PIN pad is missing a digit button.');
  for (const key of keysInPinOrder as Key[]) await tap(key);
}

async function pinPadKeyCenters(): Promise<Map<string, Point>> {
  const keys = await browser.findElements('-ios predicate string', `name BEGINSWITH "${s.pinDigitButtonPrefix}"`) as Record<string, string>[];
  const centers = new Map<string, Point>();
  for (const key of keys) {
    const id = key[elementKey] ?? key.ELEMENT;
    const digit = String(await browser.getElementAttribute(id, 'name')).slice(s.pinDigitButtonPrefix.length);
    const rect = await browser.getElementRect(id);
    centers.set(digit, { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) });
  }
  return centers;
}

async function tapScreenPointWithoutLogging(point: Point): Promise<void> {
  const { hostname, port } = browser.options;
  const response = await fetch(`http://${hostname}:${port}/session/${browser.sessionId}/actions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-appium-is-sensitive': 'true' },
    body: JSON.stringify({ actions: [{ type: 'pointer', id: 'pin-finger', parameters: { pointerType: 'touch' }, actions: [
      { type: 'pointerMove', duration: 0, origin: 'viewport', x: point.x, y: point.y },
      { type: 'pointerDown', button: 0 },
      { type: 'pause', duration: 50 },
      { type: 'pointerUp', button: 0 },
    ] }] }),
  });
  if (!response.ok) throw new Error(`A PIN pad tap failed with HTTP ${response.status}.`);
}

async function savedPin(): Promise<string | null> {
  const udid = process.env.IOS_UDID?.trim();
  if (!udid) throw new Error('The native worker does not know which iPad it is driving.');
  return readPosPin(process.env.IOS_TESTING_ROOT ?? process.cwd(), udid);
}

export const posPin = {
  async unlockIfLocked(): Promise<void> {
    if (!await isPresent(s.pinScreen)) return;
    const pin = await savedPin();
    if (!pin) throw new Error('Shopify POS is asking for a staff PIN, and no PIN is saved for this iPad. Save it on the iPad setup page, then run the test again.');
    await tapPinDigits(pin, await pinPadKeyCenters(), tapScreenPointWithoutLogging);
    if (await enabledIfPresent(s.pinSubmitButton)) await clickIfPresent(s.pinSubmitButton);
    await waitForGone(s.pinScreen, { timeout: 10_000, timeoutMsg: 'Shopify POS did not accept the saved staff PIN. Replace it on the iPad setup page, then run the test again.' });
  },
};
