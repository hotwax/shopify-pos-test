import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pos } from '../screens/pos.ts';
import type { CartLineRequest } from '../screens/pos-cart.ts';
import { buildCart, payExactCash, readBoundedCartTotal } from '../flows/cash-sale.ts';
import { confirmCashOrder, createCashOrderIntent, locateRecentCashOrder } from '../scenarios/create-order.ts';
import { validateCreateOrder } from '../../core/safety/transaction-inputs.ts';
import { hashIntent } from '../../core/safety/intent.ts';
import { createScenarioContext } from '../support/context.ts';
import { readScenarioRequest } from '../support/input.ts';
import { reportProgress } from '../support/progress.ts';

/**
 * Orchestrates one bounded cash sale from the frozen request and records it
 * in the coordinator's business-effect ledger.
 *
 * The UI work lives in reusable pieces: `posCart` adds each line with the
 * routine the planner chose (single-variant tap, or multi-variant pick),
 * `posCheckout` bounds and takes the cash, and the cash-sale flow chains them.
 * Around the irreversible tap this spec records the commit attempt, finds the
 * new order through the OMS (newest POS order since the commit with this exact
 * total and line count), reads it back from Shopify through the coordinator
 * and only then confirms the effect. A failure after the attempt leaves the
 * run in needs-reconciliation rather than "failed", because the store may
 * hold an order by then.
 */
describe('Shopify POS cash order', () => {
  it('rings one bounded cash sale from exact product ids and confirms it in Shopify', async () => {
    const request = await readScenarioRequest();
    if (request.scriptId !== 'pos.create-cash-order') {
      throw new Error('This native spec is bound to the pos.create-cash-order request.');
    }
    if (request.assertionMode === 'pos') {
      throw new Error('A create-order run must verify beyond POS alone.');
    }
    // The same safety validation the planner ran, so a hand-built request
    // cannot smuggle in an unbounded line or an unknown selection value.
    const parameters = validateCreateOrder(request.parameters as unknown as Parameters<typeof validateCreateOrder>[0]);
    const lines: CartLineRequest[] = parameters.lines;

    // The frozen intent is what the ledger is keyed by. It needs the iPad
    // identity and the frozen target context, both bound by the coordinator.
    const context = createScenarioContext();
    const intent = createCashOrderIntent(parameters, request, process.env.IOS_UDID?.trim() ?? '');
    const intentHash = hashIntent(intent);

    const artifactDir = resolve(process.env.RUN_ARTIFACT_DIR ?? join('artifacts', 'create-cash-order'));
    await mkdir(artifactDir, { recursive: true });

    await reportProgress('Checking Shopify POS is on Home with an empty cart');
    await pos.assertHome();
    await pos.assertEmptyCart();
    await reportProgress('POS is on Home and the cart is empty');

    const cartLines = await buildCart(lines);
    const total = await readBoundedCartTotal(artifactDir);
    let notBefore = '';
    const payment = await payExactCash(total, artifactDir, {
      beforeCommit: async () => {
        // The OMS correlation looks for an order created no earlier than this.
        notBefore = new Date().toISOString();
        await reportProgress('Recording the commit attempt in the run ledger', { intentHash });
        await context.recordCommitAttempt(intentHash);
      },
    });

    // ---- the store holds an order from here on; every failure below is
    // reconciled by the coordinator, not reported as a clean failure ----
    await reportProgress('Correlating the sale to one POS order in the OMS');
    const order = await locateRecentCashOrder(context, {
      notBefore,
      total: { amount: (total.cents / 100).toFixed(2), currency: parameters.currency },
      lineCount: lines.length,
    });
    await reportProgress(`The OMS lists the sale as ${order.orderName}; reading it back from Shopify`, { orderGid: order.orderGid });
    await confirmCashOrder({ parameters, context, intentHash, order, tender: 'cash' });
    await reportProgress(`Shopify confirms ${order.orderName} with the approved lines; business effect confirmed`, { orderGid: order.orderGid });

    // The worker writes its own result.json after the spec, so the sale
    // record gets its own file.
    await writeFile(join(artifactDir, 'cash-sale.json'), JSON.stringify({
      orderGid: order.orderGid,
      orderName: order.orderName,
      intentHash,
      tenderedCents: total.cents,
      checkoutLabel: total.label,
      exactLabel: payment.exact.label,
      committedBy: payment.committedBy,
      currency: parameters.currency,
      lines: cartLines.map(line => ({
        variantGid: line.variantGid, productGid: line.productGid, quantity: line.quantity,
        plannedSelection: line.variantSelection ?? 'unknown', observedSelection: line.observedSelection,
      })),
    }, null, 2));
  });
});
