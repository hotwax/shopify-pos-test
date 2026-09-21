import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pos } from '../screens/pos.ts';
import { posReset } from '../screens/pos-reset.ts';
import { returnCashOrder } from '../scenarios/return-order.ts';
import { createReturnDriver } from '../flows/return-exchange.ts';
import { validateReturn, type ReturnParameters } from '../../core/safety/transaction-inputs.ts';
import { createScenarioContext } from '../support/context.ts';
import { createPosContextReader } from '../support/pos-context.ts';
import { readScenarioRequest } from '../support/input.ts';
import { reportProgress } from '../support/progress.ts';

/**
 * Returns approved lines from one committed cash order and confirms the
 * refund in Shopify.
 *
 * The scenario owns the safety sequence: read the source order, freeze the
 * intent, prove the POS store context, build the cart, compare what POS shows
 * against what was approved, record the commit attempt, and only then take the
 * refund. This spec supplies the device driver and the artifacts; it makes no
 * safety decision of its own.
 *
 * Every per-line choice the operator made (quantity, restock, reason, note)
 * is set in POS and read back off the screen before the commit, so a control
 * that silently did not take is caught while the return is still reversible.
 */
describe('Shopify POS cash return', () => {
  it('returns approved lines with their restock, reason and refund method, and confirms the refund in Shopify', async () => {
    const request = await readScenarioRequest();
    if (request.scriptId !== 'pos.return-cash-order') {
      throw new Error('This native spec is bound to the pos.return-cash-order request.');
    }
    if (request.assertionMode === 'pos') {
      throw new Error('A return run must verify beyond POS alone.');
    }
    // The same validation the planner ran, so a hand-built request cannot
    // smuggle in an ineligible line or an unknown refund method.
    const parameters = validateReturnRequest(request.parameters);

    const root = process.env.IOS_TESTING_ROOT ?? process.cwd();
    const udid = process.env.IOS_UDID?.trim() ?? '';
    const context = createScenarioContext();
    const contextReader = createPosContextReader(root, udid);
    const artifactDir = resolve(process.env.RUN_ARTIFACT_DIR ?? join('artifacts', 'return-cash-order'));
    await mkdir(artifactDir, { recursive: true });

    await reportProgress('Checking Shopify POS is on Home with an empty cart');
    await pos.assertHome();
    await pos.assertEmptyCart();

    const driver = createReturnDriver(parameters, contextReader);
    let result: Awaited<ReturnType<typeof returnCashOrder>> | undefined;
    try {
      result = await returnCashOrder(parameters, request, context, driver, udid);
    } finally {
      // Evidence first: a failed return is exactly the case where the screen
      // at the moment of failure is worth more than the stack.
      await saveEvidence(artifactDir, result ? 'return-complete' : 'return-failed');
    }

    await writeFile(join(artifactDir, 'return.json'), JSON.stringify({
      orderGid: result.orderGid,
      orderReference: parameters.orderReference ?? null,
      refundMethod: parameters.refundMethod,
      lines: parameters.lines,
      affectedIds: result.affectedIds,
    }, null, 2));
    await reportProgress('Shopify confirms the return with the approved lines; business effect confirmed', { orderGid: result.orderGid });

    // The next run starts from Home with an empty cart, whatever this one left.
    await posReset.clearCartAndReturnHome();
  });
});

function validateReturnRequest(parameters: unknown): ReturnParameters {
  const input = parameters as ReturnParameters;
  // Eligibility is re-checked inside the scenario against the live order
  // read-back; this pass only rejects a structurally invalid request early.
  const remaining = Object.fromEntries((input?.lines ?? []).map(line => [line.lineGid, Number.MAX_SAFE_INTEGER]));
  return validateReturn(input, remaining);
}

async function saveEvidence(artifactDir: string, name: string): Promise<void> {
  const { browser } = await import('@wdio/globals');
  try { await browser.saveScreenshot(join(artifactDir, `${name}.png`)); } catch { /* the screen may be gone */ }
  try { await writeFile(join(artifactDir, `${name}.xml`), await browser.getPageSource()); } catch { /* best effort */ }
}
