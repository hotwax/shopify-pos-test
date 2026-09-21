import { browser } from '@wdio/globals';
import type { OmsShopifyOrderDetail } from '../../shared/contracts.ts';
import type { PosContextEvidence } from '../../core/safety/environment.ts';
import type { ObservedExchangeSummary, ObservedReturnSummary } from '../../core/safety/transaction-flow.ts';
import type { ExchangeParameters, RefundMethod, ReturnParameters } from '../../core/safety/transaction-inputs.ts';
import type { ExchangeOrderDriver } from '../scenarios/exchange-order.ts';
import type { ReturnOrderDriver } from '../scenarios/return-order.ts';
import { pos } from '../screens/pos.ts';
import { exchangeCartTarget, posCart, type CartLineRequest } from '../screens/pos-cart.ts';
import { posReturn, posItemLabel, type CartTotal } from '../screens/pos-return.ts';
import * as s from '../screens/pos.selectors.ts';
import { isPresent, waitForPresent } from '../screens/wait.ts';
import type { PosContextReader } from '../support/pos-context.ts';
import { reportProgress } from '../support/progress.ts';

/**
 * Drives one Shopify POS return or exchange from an approved plan.
 *
 * The division of labour matters for safety. `posReturn` knows the screens and
 * commits nothing; this module sequences them and stops at the last surface
 * before money moves; the scenario records the commit attempt and only then
 * calls `commitCash`. So every irreversible tap in a return happens after the
 * ledger already holds the attempt, and a crash between the two leaves the run
 * in needs-reconciliation rather than silently losing a refund.
 *
 * The other thing this module owns is the translation between Shopify's world
 * and POS's. A plan is written in line GIDs; POS shows product titles. The map
 * is built from the source order read back through the OMS, so a label that
 * two lines share fails closed here instead of configuring the wrong line.
 */

/** POS label for each approved source line, from the order read-back. */
export function buildLineLabels(source: OmsShopifyOrderDetail, lineGids: string[]): Map<string, string> {
  const byGid = new Map(source.lines.map(line => [line.gid, line]));
  const labels = new Map<string, string>();
  for (const gid of lineGids) {
    const line = byGid.get(gid);
    if (!line) throw new Error(`The approved return line ${gid} is not present in the source order read-back.`);
    if (!line.productTitle?.trim()) throw new Error(`The source order line ${gid} has no product title, so it cannot be found in the POS return picker.`);
    labels.set(gid, posItemLabel(line.productTitle, line.variantTitle));
  }
  const seen = new Map<string, string>();
  for (const [gid, label] of labels) {
    const first = seen.get(label);
    if (first) throw new Error(`Source lines ${first} and ${gid} both read as "${label}" in Shopify POS, so their return options cannot be told apart. Return them in separate runs.`);
    seen.set(label, gid);
  }
  return labels;
}

function moneyOf(total: CartTotal, currency: string): { amount: string; currency: string } {
  return { amount: (total.cents / 100).toFixed(2), currency };
}

const refundMethodSelectors: Record<RefundMethod, { selector: string; what: string }> = {
  cash: { selector: s.refundMethodCash, what: 'Cash, Original payment' },
  'gift-card': { selector: s.refundMethodGiftCard, what: 'Gift card' },
};

/**
 * Opens the picker on the approved order and configures every approved line.
 * Leaves the picker open, because the per-line settings are only readable
 * while the panels are expanded.
 */
async function openAndConfigure(parameters: ReturnParameters, labels: Map<string, string>): Promise<void> {
  await reportProgress(`Opening POS order ${parameters.orderReference ?? ''} to return ${parameters.lines.length} line(s)`);
  const opened = await pos.openOrderByReference(parameters.orderReference ?? '');
  // The detail has to be on screen before the return action is probed. Without
  // this wait the run reads the list, not the detail, and reports that the
  // order exposes no Return or exchange action (run-1789983619552).
  await pos.assertOrderDetail(opened);
  if (!await posReturn.isReturnable()) {
    throw new Error('Shopify POS has disabled Return or exchange for this order, which is what it does for an order with nothing fulfilled. Choose a fulfilled order.');
  }
  await posReturn.openReturnSheet();
  for (const line of parameters.lines) {
    const label = labels.get(line.lineGid);
    if (!label) throw new Error('A configured return line has no POS label.');
    await posReturn.selectItem(label);
    if (line.quantity > 1) await posReturn.setQuantity(label, line.quantity);
    await posReturn.setRestock(label, line.restock);
    await posReturn.setReason(label, line.reason);
    if (line.note) await posReturn.setNote(label, line.note);
    await reportProgress(`Configured "${label}": quantity ${line.quantity}, restock ${line.restock ? 'on' : 'off'}, reason ${line.reason}`);
  }
}

/**
 * Reads every panel back while the picker is still open and maps it to the
 * approved line GIDs. This is the reading the pre-commit check compares, so it
 * is taken from the screen rather than from the plan that produced it.
 */
async function readObservedLines(labels: Map<string, string>): Promise<ObservedReturnSummary['lines']> {
  const byLabel = new Map([...labels].map(([gid, label]) => [label, gid]));
  const panels = await posReturn.readPanels();
  return panels.map(panel => {
    const lineGid = byLabel.get(panel.label);
    if (!lineGid) throw new Error(`The POS return picker is showing a line "${panel.label}" that the approved plan does not contain.`);
    return { lineGid, quantity: panel.quantity, restock: panel.restock, ...(panel.reason ? { reason: panel.reason } : {}) };
  });
}

/** Taps the approved refund method and waits for POS to reach its completed state. */
async function takeRefund(method: RefundMethod): Promise<void> {
  const choice = refundMethodSelectors[method];
  await waitForPresent(choice.selector, { timeout: 20_000, timeoutMsg: `Shopify POS did not offer the "${choice.what}" refund method.` });
  const control = browser.$(choice.selector);
  if (!await control.isEnabled()) throw new Error(`Shopify POS has disabled the "${choice.what}" refund method for this return.`);
  await reportProgress(`Taking the refund as "${choice.what}"`);
  await control.click();
  // What this tap commits is build-specific: on the observed build the cash
  // method may finish the refund outright or lead to one more confirmation.
  // Either way the attempt is already in the ledger, so the run waits for a
  // completed checkout and treats anything else as needing reconciliation.
  await browser.waitUntil(async () => isPresent(s.checkoutCompleteScreen), {
    timeout: 90_000,
    timeoutMsg: 'Shopify POS did not reach its completed state after the refund method was taken. The refund may or may not have been issued; reconcile this run against Shopify.',
  });
  const done = browser.$(s.checkoutCompleteDoneButton);
  if (await done.isExisting() && await done.isEnabled()) await done.click();
}

export function createReturnDriver(parameters: ReturnParameters, contextReader: PosContextReader): ReturnOrderDriver {
  let currency = 'USD';
  let observedLines: ObservedReturnSummary['lines'] = [];
  let observedTotal: CartTotal | null = null;

  return {
    readContextEvidence: () => contextReader.read(),

    async prepareReturn(plan: ReturnParameters, source: OmsShopifyOrderDetail): Promise<void> {
      currency = source.total?.currency ?? 'USD';
      const labels = buildLineLabels(source, plan.lines.map(line => line.lineGid));
      await openAndConfigure(plan, labels);
      observedLines = await readObservedLines(labels);
      await posReturn.finishSelection();
    },

    async selectCash(): Promise<void> {
      observedTotal = await posReturn.readCartTotal();
      if (observedTotal.direction !== 'refund') {
        throw new Error(`A return must leave the cart owing a refund, but POS reads "${observedTotal.label}".`);
      }
      // Opens the chooser only. Nothing here moves money; the method is tapped
      // in commitCash, after the ledger holds the attempt.
      await posReturn.openRefundMethods();
      const choice = refundMethodSelectors[parameters.refundMethod];
      await waitForPresent(choice.selector, { timeout: 20_000, timeoutMsg: `Shopify POS did not offer the approved "${choice.what}" refund method.` });
    },

    async readSummary(): Promise<ObservedReturnSummary> {
      if (!observedTotal) throw new Error('The POS return total has not been read yet.');
      if (!await posReturn.isRefundMethodOpen()) throw new Error('The POS refund-method chooser is no longer open, so the tender cannot be confirmed before commit.');
      return { lines: observedLines, refund: moneyOf(observedTotal, currency), tender: parameters.refundMethod };
    },

    commitCash: () => takeRefund(parameters.refundMethod),
  };
}

export function createExchangeDriver(parameters: ExchangeParameters, contextReader: PosContextReader): ExchangeOrderDriver {
  let currency = 'USD';
  let observedLines: ObservedReturnSummary['lines'] = [];
  let observedTotal: CartTotal | null = null;

  return {
    readContextEvidence: () => contextReader.read(),

    async prepareExchange(plan: ExchangeParameters, source: OmsShopifyOrderDetail): Promise<void> {
      // The intent, the planner and the Shopify read-back all carry the
      // customer choice, but no verified POS control has been observed for
      // changing it inside an exchange cart. Rather than tap a guessed
      // selector, or quietly leave the customer as-is while the plan says
      // otherwise, a non-keep choice stops here and names what is missing.
      if (plan.customer && plan.customer.action !== 'keep') {
        throw new Error(`This run approves "${plan.customer.action}" for the exchange customer, but no Shopify POS control for changing the customer inside an exchange cart has been observed and pinned yet. Run pos.inspect-order-actions against a customer order, add the verified selector, then rerun. The run has changed nothing.`);
      }
      currency = source.total?.currency ?? 'USD';
      const labels = buildLineLabels(source, plan.lines.map(line => line.lineGid));
      await openAndConfigure(plan, labels);
      observedLines = await readObservedLines(labels);
      // Replacements are added from inside the picker, through the same
      // product search a sale uses, so a multi-variant replacement takes the
      // same variant-picker path rather than a second implementation.
      await posReturn.openExchangeSearch();
      const lines: CartLineRequest[] = plan.replacements;
      // Same limit the cash sale enforces: a repeat tap has not been proven to
      // increment an existing line rather than add a second one, so a
      // multi-unit replacement fails closed instead of guessing.
      for (const line of lines) {
        if (line.quantity !== 1) throw new Error('Only quantity 1 per replacement line is verified; add the extra units as separate lines or split the run.');
      }
      for (const [index, line] of lines.entries()) await posCart.addItemToCart(line, exchangeCartTarget(index + 1));
      await posCart.closeProductSurfaces();
      if (await posReturn.isSheetOpen()) await posReturn.finishSelection();
      const cart = await posReturn.readCartLines();
      if (!cart.returned.length) throw new Error('The POS cart holds no return lines after the exchange was configured.');
      if (!cart.purchased.length) throw new Error('The POS cart holds no replacement lines after the exchange was configured.');
    },

    async selectCash(): Promise<void> {
      observedTotal = await posReturn.readCartTotal();
      if (observedTotal.direction !== parameters.direction) {
        throw new Error(`The approved exchange direction is "${parameters.direction}" but POS reads "${observedTotal.label}".`);
      }
      if (observedTotal.direction === 'refund') {
        await posReturn.openRefundMethods();
        const choice = refundMethodSelectors[parameters.refundMethod];
        await waitForPresent(choice.selector, { timeout: 20_000, timeoutMsg: `Shopify POS did not offer the approved "${choice.what}" refund method.` });
      }
    },

    async readSummary(): Promise<ObservedExchangeSummary> {
      if (!observedTotal) throw new Error('The POS exchange total has not been read yet.');
      const tender = observedTotal.direction === 'refund' ? parameters.refundMethod
        : observedTotal.direction === 'collect' ? parameters.collectMethod
        : 'none';
      return {
        returnLines: observedLines,
        // POS shows replacement lines by title, not by variant GID, and the
        // approved variants are what Shopify is read back for afterwards. The
        // cart was already proven non-empty on both sides in prepareExchange.
        purchaseLines: parameters.replacements.map(line => ({ variantGid: line.variantGid, quantity: line.quantity })),
        netDue: moneyOf(observedTotal, currency),
        tender,
      };
    },

    async commitCash(): Promise<void> {
      if (!observedTotal) throw new Error('The POS exchange total has not been read yet.');
      if (observedTotal.direction === 'refund') return takeRefund(parameters.refundMethod);
      throw new Error('Committing a collect or even exchange is not implemented yet; only a net-refund exchange can be completed by this run.');
    },
  };
}
