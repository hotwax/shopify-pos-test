import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { browser } from '@wdio/globals';
import { readScenarioRequest } from '../support/input.ts';
import { reportProgress } from '../support/progress.ts';
import { prepareDemoPosSession } from '../support/demo-pos-session.ts';
import { createPosContextReader } from '../support/pos-context.ts';
import { pos } from '../screens/pos.ts';

/**
 * Read-only discovery walker. Starts from whatever POS is showing, captures
 * it, then performs the requested taps one at a time, capturing the tree and
 * a screenshot after each. It never taps a control whose label reads like a
 * committing action, so it can walk return, exchange and payment surfaces up
 * to the last non-committing step. It leaves POS where it stops.
 */
interface WalkStep { selector: string; capture: string; type?: string; tap?: 'element' | 'coordinate' }

const committing = /refund|complete|charge|pay\b|apply|confirm|process|accept|done/i;

function screenIds(source: string): Set<string> {
  return new Set(source.match(/name="Screen\.[A-Za-z0-9._-]+"/g) ?? []);
}

describe('Shopify POS discovery walk', () => {
  it('captures the current surface, then each requested non-committing tap', async () => {
    const request = await readScenarioRequest();
    if (request.scriptId !== 'pos.inspect-walk' || request.assertionMode !== 'pos') {
      throw new Error('This native spec is bound to the pos.inspect-walk read-only request.');
    }
    if (request.parameters.prepareDemoSession === true) {
      await prepareDemoPosSession();
      if (request.parameters.preserveCurrentSurface !== true) {
      const locationsTitle = browser.$('-ios predicate string:type == "XCUIElementTypeStaticText" AND name == "Locations" AND visible == 1');
      if (await locationsTitle.isExisting()) {
        const close = browser.$('-ios predicate string:type == "XCUIElementTypeButton" AND name == "Component.ActionBar.PrimaryActionButton" AND label == "Close" AND visible == 1');
        if (!await close.isEnabled()) throw new Error('The Locations picker has no observed Close control.');
        await close.click();
        await browser.waitUntil(async () => !await locationsTitle.isExisting(), { timeout: 10_000 });
      }
      // The observed cart popover hides its owning button and the tab bar.
      // Dismiss that non-committing overlay before reading the More header.
      const draftAction = browser.$('-ios predicate string:name == "Screen.MoreActions.SaveCart" AND visible == 1');
      if (await draftAction.isExisting()) {
        const owner = await browser.$('~Screen.Cart.MoreActionsButton').getElement();
        if (await owner.getAttribute('label') !== 'More actions' || !await owner.isEnabled()) throw new Error('The observed cart popover has no safe dismissal target.');
        const rect = await browser.getElementRect(owner.elementId);
        await browser.execute('mobile: tap', { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) });
        await browser.waitUntil(async () => !await draftAction.isExisting(), { timeout: 10_000 });
      }
      const reader = createPosContextReader(process.env.IOS_TESTING_ROOT ?? process.cwd(), process.env.IOS_UDID ?? '');
      const evidence = await reader.read();
      if (evidence.shopGid !== 'gid://shopify/Shop/67452731546') throw new Error('Demo discovery requires the exact hotwax-demo shop.');
      }
    }
    const steps = (request.parameters.steps ?? []) as WalkStep[];
    // Exact labels the operator explicitly allows despite reading like a
    // committing action (for example the cart's "Refund $120.00" control,
    // which only opens tender selection, the same as Checkout).
    const allowLabels = new Set(((request.parameters.allowLabels ?? []) as string[]).map(label => label.trim()));
    const artifactDir = resolve(process.env.RUN_ARTIFACT_DIR ?? join('artifacts', 'inspection-walk'));
    await mkdir(artifactDir, { recursive: true });

    const capture = async (name: string): Promise<string> => {
      const source = await browser.getPageSource();
      await writeFile(join(artifactDir, `${name}.xml`), source);
      await browser.saveScreenshot(join(artifactDir, `${name}.png`));
      return source;
    };
    let previous = await capture('00-start');

    for (const [index, step] of steps.entries()) {
      // Switching a real POS location reloads the local store data. Wait for
      // the requested observed control rather than treating that loader as a
      // missing selector or replaying the switch.
      await browser.$(step.selector).waitForDisplayed({ timeout: 60_000 });
      const element = await browser.$(step.selector).getElement();
      const label = (await element.getAttribute('label')) ?? (await element.getAttribute('name')) ?? '';
      if (committing.test(label) && !allowLabels.has(label.trim())) {
        throw new Error(`Refusing to tap "${label}" (${step.selector}): it reads like a committing action.`);
      }
      // POS's observed cart-actions popover marks its owning button unhittable.
      // Its live rectangle is a safe dismissal target only while that exact
      // non-committing overlay is visible; hidden controls otherwise refuse.
      const dismissCartActions = step.selector === '~Screen.Cart.MoreActionsButton' && step.tap === 'coordinate' && await browser.$('-ios predicate string:name == "Screen.MoreActions.SaveCart" AND visible == 1').isExisting();
      if (await element.getAttribute('hittable') !== 'true' && !(dismissCartActions && await element.isEnabled() && label === 'More actions')) throw new Error(`"${label}" (${step.selector}) is present but not hittable.`);
      await reportProgress(step.type !== undefined ? `Typing into "${label}"` : `Tapping "${label}"`, { selector: step.selector, capture: step.capture });
      const before = screenIds(previous);
      const rect = await browser.getElementRect(element.elementId);
      if (step.type !== undefined) {
        // Typing is text only; POS filters as you type, so give it a moment.
        if (step.selector === '~Component.SearchBar.TextInput') await pos.typeProductSearch(step.type);
        else {
          await element.click();
          await element.setValue(step.type);
          if (await element.getAttribute('value') !== step.type) throw new Error('The native field did not retain the exact requested text.');
        }
        await new Promise(resolvePause => setTimeout(resolvePause, 2_500));
        previous = await capture(`${String(index + 1).padStart(2, '0')}-${step.capture}`);
        continue;
      }
      // Some POS controls ignore element taps but take a raw coordinate tap
      // (the Return or exchange action, run-1789960050617). The operator says
      // which per step; guessing from tree changes misfires on tap highlights.
      const settled = async (timeout: number): Promise<boolean> => {
        try {
          await browser.waitUntil(async () => {
            const source = await browser.getPageSource();
            return [...screenIds(source)].some(id => !before.has(id)) || Math.abs(source.length - previous.length) > 400;
          }, { timeout, interval: 1_000 });
          return true;
        } catch { return false; }
      };
      const coordinateTap = () => browser.execute('mobile: tap', { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) });
      if (step.tap === 'coordinate') {
        await coordinateTap();
        // The Return or exchange action ignores a tap that lands while the
        // order detail is still settling (run-1789961047749); one retry after
        // a quiet 5 s is enough, and only when nothing at all changed.
        if (!await settled(5_000)) { await reportProgress(`Retrying the coordinate tap on "${label}"`); await coordinateTap(); if (!await settled(8_000)) await reportProgress(`No clear tree change after "${label}"; capturing anyway`); }
      } else {
        await element.click();
        if (!await settled(8_000)) await reportProgress(`No clear tree change after "${label}"; capturing anyway`);
      }
      await new Promise(resolvePause => setTimeout(resolvePause, 1_500));
      previous = await capture(`${String(index + 1).padStart(2, '0')}-${step.capture}`);
    }
  });
});
