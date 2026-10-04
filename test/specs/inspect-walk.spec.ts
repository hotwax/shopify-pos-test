import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { browser } from '@wdio/globals';
import { readScenarioRequest } from '../support/input.ts';
import { posPin } from '../screens/pos-pin.ts';
import { reportProgress } from '../support/progress.ts';

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
    await posPin.unlockIfLocked();
    if (request.scriptId !== 'pos.inspect-walk' || request.assertionMode !== 'pos') {
      throw new Error('This native spec is bound to the pos.inspect-walk read-only request.');
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
      const element = await browser.$(step.selector).getElement();
      const label = (await element.getAttribute('label')) ?? (await element.getAttribute('name')) ?? '';
      if (committing.test(label) && !allowLabels.has(label.trim())) {
        throw new Error(`Refusing to tap "${label}" (${step.selector}): it reads like a committing action.`);
      }
      if (await element.getAttribute('hittable') !== 'true') throw new Error(`"${label}" (${step.selector}) is present but not hittable.`);
      await reportProgress(step.type !== undefined ? `Typing into "${label}"` : `Tapping "${label}"`, { selector: step.selector, capture: step.capture });
      const before = screenIds(previous);
      const rect = await browser.getElementRect(element.elementId);
      if (step.type !== undefined) {
        // Typing is text only; POS filters as you type, so give it a moment.
        await element.click();
        await element.setValue(step.type);
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
