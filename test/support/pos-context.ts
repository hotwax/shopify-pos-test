import { createHash } from 'node:crypto';
import { browser } from '@wdio/globals';
import { pos, type PosStoreContext } from '../screens/pos.ts';
import * as s from '../screens/pos.selectors.ts';
import { isPresent } from '../screens/wait.ts';
import { loadTargetDeviceBindings, type TargetDeviceBinding } from '../../core/safety/policy.ts';
import type { PosContextEvidence } from '../../core/safety/environment.ts';

/**
 * Proves, from the iPad itself, which approved store and location POS is
 * signed in to.
 *
 * Shopify POS never shows a Shopify GID, so a run cannot read one off the
 * screen. What it can read is the More-menu header, which names the store and
 * the location. The approved-target policy records those names next to the
 * GIDs, so the observed header selects a target rather than a run asserting
 * its own request back at itself.
 *
 * The full read has to open the More tab, which leaves whatever is on screen.
 * That is free while the cart is empty and destructive once a return cart
 * exists, so a run reads the context once at the start and then re-stamps it
 * before the irreversible tap. The re-stamp re-checks what can be re-checked
 * without navigating (same Appium session and iPad, POS still foregrounded,
 * no alert, no offline banner) and carries a method that says exactly that,
 * so the run record never overstates what was proven.
 */
export interface PosContextObservation {
  storeName: string;
  locationName: string;
  plan: string;
  /** The approved target this reading selected, or null when none claims it. */
  approved: { shopGid: string; locationGid: string } | null;
  why: string;
}

export type PosContextReader = {
  /** Opens More, reads the header, returns Home. Cart-destructive. */
  readFull(): Promise<PosContextEvidence>;
  /** Re-verifies the session and re-stamps the cached reading. Safe mid-cart. */
  restamp(): Promise<PosContextEvidence>;
  /** readFull() the first time, restamp() afterwards. */
  read(): Promise<PosContextEvidence>;
  /**
   * Reads the header and reports what it saw without demanding a match. A
   * rehearsal commits nothing, so an unapproved or unbound store is worth
   * reporting rather than refusing; only a run that moves money needs
   * readFull's guarantee.
   */
  observe(): Promise<PosContextObservation>;
};

function matchBinding(observed: PosStoreContext, bindings: TargetDeviceBinding[]): TargetDeviceBinding {
  if (!bindings.length) {
    throw new Error('No approved target declares the POS store and location names it is reachable under. Add "posStoreName" and "posLocationName" to the matching target in config/test-environments.json before running a transaction.');
  }
  const matches = bindings.filter(binding => binding.posStoreName === observed.storeName && binding.posLocationName === observed.locationName);
  if (matches.length > 1) throw new Error('More than one approved target claims the POS store and location this iPad is signed in to.');
  const match = matches[0];
  if (!match) {
    throw new Error(`Shopify POS is signed in to "${observed.storeName}" at "${observed.locationName}", which no approved target declares. Refusing to transact against an unapproved store or location.`);
  }
  return match;
}

/**
 * POS shows a banner while it is offline. The banner's exact identifiers are
 * not pinned to a verified build, so this matches any element whose name or
 * label mentions being offline and treats a match as "not safe to transact".
 * A build that words it differently would read as online, which is why the
 * coordinator still verifies every effect against Shopify afterwards.
 */
async function looksOffline(): Promise<boolean> {
  return isPresent('-ios predicate string:name CONTAINS[c] "offline" OR label CONTAINS[c] "offline"');
}

async function assertSameSession(udid: string): Promise<void> {
  if (!udid) throw new Error('The run has no observed iPad identity; set IOS_UDID for a transaction run.');
  const capability = (browser.capabilities as Record<string, unknown>)['appium:udid'] ?? (browser.capabilities as Record<string, unknown>).udid;
  if (typeof capability === 'string' && capability.trim() && capability.trim() !== udid) {
    throw new Error('The Appium session is attached to a different iPad than the run was planned for.');
  }
  // Read from the live session rather than guessed: Shopify POS ships as
  // com.jadedpixel.pos, and a wrong id makes queryAppState answer 1 ("not
  // installed") for an app that is plainly on screen (run-1789983922069).
  const capabilities = browser.capabilities as Record<string, unknown>;
  const bundleId = [capabilities['appium:bundleId'], capabilities.bundleId, process.env.POS_BUNDLE_ID]
    .map(value => (typeof value === 'string' ? value.trim() : ''))
    .find(value => value) ?? '';
  if (!bundleId) throw new Error('The Appium session does not say which app it is driving, so POS cannot be confirmed as the foreground app.');
  const state = await browser.queryAppState(bundleId);
  // 4 = running in the foreground. Anything else means POS is not the app the
  // next tap would land in.
  if (state !== 4) throw new Error(`Shopify POS (${bundleId}) is not the foreground app on the iPad; Appium reports app state ${state}.`);
  if (await looksOffline()) throw new Error('Shopify POS is showing an offline state; it is not safe to transact.');
}

export function createPosContextReader(root: string, udid: string): PosContextReader {
  let cached: { binding: TargetDeviceBinding; observed: PosStoreContext; sourceHash: string } | null = null;

  /** Opens More, reads the header, returns Home. Shared by readFull and observe. */
  async function readHeader(): Promise<PosStoreContext> {
    const moreTab = await browser.$(s.moreTab).getElement();
    if (!await moreTab.isDisplayed() || !await moreTab.isEnabled()) throw new Error('The observed POS More tab is unavailable, so the store context cannot be proven.');
    await moreTab.click();
    await browser.waitUntil(async () => browser.$(s.moreScreen).isDisplayed(), { timeout: 20_000, timeoutMsg: 'Shopify POS did not open the More menu to read the store context.' });
    let observed: PosStoreContext;
    try {
      observed = await pos.readStoreContext();
    } finally {
      // Always come back, even when the header could not be parsed: leaving
      // POS on More would fail the next step for an unrelated reason.
      const homeTab = await browser.$(s.homeTab).getElement();
      if (await homeTab.isDisplayed() && await homeTab.isEnabled()) {
        await homeTab.click();
        await browser.waitUntil(async () => browser.$(s.homeScreen).isDisplayed(), { timeout: 20_000, timeoutMsg: 'Shopify POS did not return to Home after reading the store context.' });
      }
    }
    return observed;
  }

  async function readFull(): Promise<PosContextEvidence> {
    await assertSameSession(udid);
    const bindings = await loadTargetDeviceBindings(root);
    // Checked before anything on the iPad moves: without a binding the answer
    // is already no, and navigating to More would only cost a round trip and
    // leave POS somewhere the caller did not expect.
    if (!bindings.length) matchBinding({ storeName: '', locationName: '', plan: '' }, bindings);
    const observed = await readHeader();
    const binding = matchBinding(observed, bindings);

    // Hashes the exact reading, not the plan, so two runs that saw different
    // screens can never share an evidence hash.
    const sourceHash = createHash('sha256').update(JSON.stringify([udid, observed.storeName, observed.locationName, observed.plan, binding.shopGid, binding.locationGid])).digest('hex');
    cached = { binding, observed, sourceHash };
    return {
      udid,
      shopGid: binding.shopGid,
      locationGid: binding.locationGid,
      observedAt: new Date().toISOString(),
      method: 'pos-more-header',
      evidenceHash: sourceHash,
      online: true,
    };
  }

  async function restamp(): Promise<PosContextEvidence> {
    if (!cached) throw new Error('The POS store context has not been read yet, so it cannot be re-verified.');
    await assertSameSession(udid);
    return {
      udid,
      shopGid: cached.binding.shopGid,
      locationGid: cached.binding.locationGid,
      observedAt: new Date().toISOString(),
      method: 'pos-more-header+session-recheck',
      evidenceHash: cached.sourceHash,
      online: true,
    };
  }

  async function observe(): Promise<PosContextObservation> {
    const bindings = await loadTargetDeviceBindings(root);
    const observed = await readHeader();
    const match = bindings.find(binding => binding.posStoreName === observed.storeName && binding.posLocationName === observed.locationName);
    return {
      ...observed,
      approved: match ? { shopGid: match.shopGid, locationGid: match.locationGid } : null,
      why: match
        ? 'matches an approved target'
        : bindings.length
          ? 'no approved target declares this POS store and location'
          : 'no approved target declares POS store and location names; add posStoreName and posLocationName to config/test-environments.json',
    };
  }

  return { readFull, restamp, observe, read: async () => (cached ? restamp() : readFull()) };
}
