import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { browser } from '@wdio/globals';
import { pos } from '../screens/pos.ts';
import { posReset } from '../screens/pos-reset.ts';
import { posReturn } from '../screens/pos-return.ts';
import { buildLineLabels } from '../flows/return-exchange.ts';
import { exchangeCartTarget, posCart } from '../screens/pos-cart.ts';
import { validateExchange, validateReturn, type ExchangeParameters, type ReturnParameters } from '../../core/safety/transaction-inputs.ts';
import { assertReturnPrecommit } from '../../core/safety/transaction-flow.ts';
import { createScenarioContext } from '../support/context.ts';
import { createPosContextReader } from '../support/pos-context.ts';
import { readScenarioRequest } from '../support/input.ts';
import { reportProgress } from '../support/progress.ts';
import * as s from '../screens/pos.selectors.ts';

/**
 * Rehearses a return without issuing one.
 *
 * Everything a real return does is done here except the last tap: the order is
 * opened, the picker is opened, every approved line is selected and configured
 * with its quantity, restock, reason and note, the settings are read back off
 * the screen, the cart's own arithmetic is read, and the refund-method chooser
 * is opened so the approved method can be proven present and enabled. Then the
 * run backs out and clears the cart.
 *
 * This exists because the expensive, fragile part of a return is the device
 * work, not the commit, and there is no reason to spend a real refund to find
 * out that a product title changed or a control moved. A rehearsal that
 * reaches the refund-method chooser has proven every step the real run makes
 * before it records a commit attempt.
 *
 * It creates no business data: no method is tapped, and the cart is cleared.
 */
describe('Shopify POS return rehearsal', () => {
  it('builds and verifies a complete return cart, then clears it without refunding', async () => {
    const request = await readScenarioRequest();
    // Bound to the SCENARIO, not to one catalog entry: several stored
    // rehearsals (a return, a greater exchange) run this same spec with
    // different fixtures, and the catalog validator already enforces which
    // entries may point at it.
    const rehearsalScripts = ['pos.rehearse-return', 'pos.rehearse-exchange'];
    if (!rehearsalScripts.includes(request.scriptId)) {
      throw new Error(`This native spec runs the pos.rehearse-return scenario; it is not bound to the ${request.scriptId} request.`);
    }
    const input = request.parameters as unknown as ExchangeParameters;
    const remaining = Object.fromEntries((input?.lines ?? []).map(line => [line.lineGid, Number.MAX_SAFE_INTEGER]));
    // Replacements make this an exchange rehearsal: the same return work,
    // plus the replacement side, still stopping before any tender.
    const isExchange = Array.isArray(input?.replacements) && input.replacements.length > 0;
    const parameters: ReturnParameters = isExchange ? validateExchange(input, remaining) : validateReturn(input, remaining);
    const exchange = isExchange ? parameters as ExchangeParameters : null;

    const root = process.env.IOS_TESTING_ROOT ?? process.cwd();
    const context = createScenarioContext();
    const artifactDir = resolve(process.env.RUN_ARTIFACT_DIR ?? join('artifacts', 'rehearse-return'));
    await mkdir(artifactDir, { recursive: true });

    // A rehearsal commits nothing and clears up after itself, so it also
    // prepares itself: an earlier failed run that left POS on an order detail
    // should not make the next rehearsal fail on the doorstep. The real
    // return and exchange specs keep asserting Home instead, because a
    // mutation run should not quietly tidy a state nobody explained.
    await posReset.clearCartAndReturnHome();

    // Read-only. A rehearsal is still useful against a store no approved
    // target claims, so it reports what the iPad says rather than refusing;
    // only a run that moves money needs readFull's guarantee.
    const contextReader = createPosContextReader(root, process.env.IOS_UDID?.trim() ?? '');
    const context_ = await contextReader.observe();
    const storeContext = context_.approved
      ? `${context_.storeName} at ${context_.locationName} (${context_.approved.shopGid}, ${context_.approved.locationGid})`
      : `${context_.storeName} at ${context_.locationName} — NOT APPROVED: ${context_.why}`;
    await reportProgress(`POS store context: ${storeContext}`);

    const source = await context.readShopifyOrder(parameters.orderGid);
    const labels = buildLineLabels(source, parameters.lines.map(line => line.lineGid));

    await reportProgress(`Opening ${parameters.orderReference ?? source.name ?? ''}`);
    const opened = await pos.openOrderByReference(parameters.orderReference ?? source.name ?? '');
    await pos.assertOrderDetail(opened);

    // Captured before the probe, so a run that cannot find the action still
    // leaves behind the screen it was actually looking at.
    await writeFile(join(artifactDir, 'order-detail.xml'), await browser.getPageSource());
    await browser.saveScreenshot(join(artifactDir, 'order-detail.png'));
    const returnable = await posReturn.isReturnable();
    if (!returnable) {
      throw new Error('Shopify POS has disabled Return or exchange for this order, which is what it does when nothing on the order is fulfilled. The rehearsal proved the order is not returnable on POS.');
    }

    await posReturn.openReturnSheet();
    for (const line of parameters.lines) {
      const label = labels.get(line.lineGid)!;
      await posReturn.selectItem(label);
      if (line.quantity > 1) await posReturn.setQuantity(label, line.quantity);
      await posReturn.setRestock(label, line.restock);
      await posReturn.setReason(label, line.reason);
      if (line.note) await posReturn.setNote(label, line.note);
      await reportProgress(`Configured "${label}": quantity ${line.quantity}, restock ${line.restock ? 'on' : 'off'}, reason ${line.reason}`);
    }

    const panels = await posReturn.readPanels();
    await browser.saveScreenshot(join(artifactDir, 'configured-panels.png'));
    await writeFile(join(artifactDir, 'configured-panels.xml'), await browser.getPageSource());

    // The replacement side goes through the same product search a sale uses,
    // opened from inside the picker, so a multi-variant replacement takes the
    // same variant-picker path rather than a second implementation.
    if (exchange) {
      for (const line of exchange.replacements) {
        if (line.quantity !== 1) throw new Error('Only quantity 1 per replacement line is verified; add the extra units as separate lines.');
      }
      await posReturn.openExchangeSearch();
      for (const [index, line] of exchange.replacements.entries()) {
        await posCart.addItemToCart(line, exchangeCartTarget(index + 1));
        await reportProgress(`Added replacement ${line.search}`);
      }
      await posCart.closeProductSurfaces();
      await browser.saveScreenshot(join(artifactDir, 'exchange-cart.png'));
      await writeFile(join(artifactDir, 'exchange-cart.xml'), await browser.getPageSource());
    }

    const byLabel = new Map([...labels].map(([gid, label]) => [label, gid]));
    const observedLines = panels.map(panel => {
      const lineGid = byLabel.get(panel.label);
      if (!lineGid) throw new Error(`The POS return picker shows a line "${panel.label}" that the plan does not contain.`);
      return { lineGid, quantity: panel.quantity, restock: panel.restock, ...(panel.reason ? { reason: panel.reason } : {}) };
    });

    if (await posReturn.isSheetOpen()) await posReturn.finishSelection();
    const total = await posReturn.readCartTotal();
    await reportProgress(`The POS cart reads "${total.label}"`);
    const cartLines = await posReturn.readCartLines();

    // The same pre-commit comparison the real return makes, so a rehearsal
    // that passes has proven the plan would survive that gate too.
    assertReturnPrecommit(
      { lines: observedLines, refund: { amount: (total.cents / 100).toFixed(2), currency: source.total?.currency ?? 'USD' }, tender: parameters.refundMethod },
      parameters,
    );

    if (exchange && total.direction !== exchange.direction) {
      throw new Error(`The plan approves a "${exchange.direction}" exchange but POS reads "${total.label}". The rehearsal proved the direction would not match before any tender.`);
    }

    let refundMethodsOffered: string[] = [];
    if (total.direction === 'refund') {
      await posReturn.openRefundMethods();
      await browser.saveScreenshot(join(artifactDir, 'refund-methods.png'));
      await writeFile(join(artifactDir, 'refund-methods.xml'), await browser.getPageSource());
      for (const candidate of [
        { selector: s.refundMethodCash, name: 'Cash, Original payment' },
        { selector: s.refundMethodGiftCard, name: 'Gift card' },
        { selector: s.refundMethodSplit, name: 'Split refund' },
      ]) {
        const element = (await browser.$$(candidate.selector).getElements())[0];
        if (element) refundMethodsOffered.push(`${candidate.name}${await element.isEnabled() ? '' : ' (disabled)'}`);
      }
      await reportProgress(`POS offers: ${refundMethodsOffered.join(', ') || 'no recognised refund method'}`);
    }

    await writeFile(join(artifactDir, 'rehearsal.json'), JSON.stringify({
      orderGid: parameters.orderGid,
      orderReference: parameters.orderReference ?? null,
      storeContext,
      plannedLines: parameters.lines,
      observedPanels: panels,
      cart: { label: total.label, direction: total.direction, cents: total.cents, currency: source.total?.currency ?? 'USD', ...cartLines },
      ...(exchange ? { approvedDirection: exchange.direction, replacements: exchange.replacements } : {}),
      refundMethodsOffered,
      approvedRefundMethod: parameters.refundMethod,
      committed: false,
    }, null, 2));

    // Nothing was tendered, so clearing the cart leaves the store exactly as
    // the rehearsal found it.
    await posReset.clearCartAndReturnHome();
    await reportProgress('Rehearsal complete; the cart is cleared and no refund was issued');
  });
});
