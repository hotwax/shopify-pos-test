import { browser } from '@wdio/globals';

/**
 * One-round-trip presence checks.
 *
 * `browser.$(sel).isExisting()` costs two Appium commands on a lazily resolved
 * element (a find, then a find-all), and `waitForDisplayed` makes XCTest wait
 * for the app to go idle on every poll, which POS is not while a surface is
 * animating. A single protocol find is one command, stops at the first match
 * (`useFirstMatch`), needs no idle, and answers both "is it there" and "is it
 * gone" (a miss comes back as a "no such element" result, not an exception).
 * Every wait in the screen objects goes through these so the cost per poll
 * stays at one command. Measured: find-all 532 ms, single find 427 ms, miss
 * 215 ms (run-1789957151452).
 */
function strategy(selector: string): { using: string; value: string } {
  if (selector.startsWith('~')) return { using: 'accessibility id', value: selector.slice(1) };
  const predicate = '-ios predicate string:';
  if (selector.startsWith(predicate)) return { using: '-ios predicate string', value: selector.slice(predicate.length) };
  const chain = '-ios class chain:';
  if (selector.startsWith(chain)) return { using: '-ios class chain', value: selector.slice(chain.length) };
  if (/^XCUIElementType[A-Za-z]+$/.test(selector)) return { using: 'class name', value: selector };
  throw new Error(`Presence checks support accessibility-id, predicate, class-chain and class-name selectors only: ${selector}`);
}

export async function isPresent(selector: string): Promise<boolean> {
  const { using, value } = strategy(selector);
  try {
    const result = await browser.findElement(using, value) as Record<string, unknown> | null;
    return Boolean(result) && !('error' in (result as Record<string, unknown>));
  } catch (cause) {
    // A "no such element" surfaced as an exception is still just "not here".
    if (cause instanceof Error && /no such element/i.test(cause.message)) return false;
    throw cause;
  }
}

/** How many elements match. Use only where the number itself matters. */
export async function count(selector: string): Promise<number> {
  return (await browser.$$(selector).getElements()).length;
}

export async function waitForPresent(selector: string, options: { timeout: number; timeoutMsg: string; interval?: number }): Promise<void> {
  await browser.waitUntil(() => isPresent(selector), options);
}

export async function waitForGone(selector: string, options: { timeout: number; timeoutMsg: string; interval?: number }): Promise<void> {
  await browser.waitUntil(async () => !await isPresent(selector), options);
}

/**
 * Protocol-level reads for controls that may vanish between two commands.
 * `browser.$(sel).isEnabled()` on an element that has just left the tree makes
 * WebdriverIO wait its implicit 20 s for the element to come back before it
 * throws (run-1789957407927 lost a 15 s commit window to exactly that). A raw
 * find plus a raw attribute read never waits: a miss is simply `null`.
 */
export async function enabledIfPresent(selector: string): Promise<boolean | null> {
  const { using, value } = strategy(selector);
  try {
    const found = await browser.findElement(using, value) as Record<string, string> | null;
    if (!found || 'error' in found) return null;
    const id = found['element-6066-11e4-a52e-4f735466cecf'] ?? found.ELEMENT;
    if (!id) return null;
    return Boolean(await browser.isElementEnabled(id));
  } catch (cause) {
    if (cause instanceof Error && /no such element|stale element/i.test(cause.message)) return null;
    throw cause;
  }
}

/** Taps the control if it is present right now; returns whether it was. Never waits. */
export async function clickIfPresent(selector: string): Promise<boolean> {
  const { using, value } = strategy(selector);
  try {
    const found = await browser.findElement(using, value) as Record<string, string> | null;
    if (!found || 'error' in found) return false;
    const id = found['element-6066-11e4-a52e-4f735466cecf'] ?? found.ELEMENT;
    if (!id) return false;
    await browser.elementClick(id);
    return true;
  } catch (cause) {
    if (cause instanceof Error && /no such element|stale element/i.test(cause.message)) return false;
    throw cause;
  }
}
