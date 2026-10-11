import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pos } from '../screens/pos.ts';
import { posReset } from '../screens/pos-reset.ts';
import { exchangeCashOrder } from '../scenarios/exchange-order.ts';
import { createExchangeDriver } from '../flows/return-exchange.ts';
import { validateExchange, type ExchangeParameters } from '../../core/safety/transaction-inputs.ts';
import { createScenarioContext } from '../support/context.ts';
import { createPosContextReader } from '../support/pos-context.ts';
import { readScenarioRequest } from '../support/input.ts';
import { reportProgress } from '../support/progress.ts';
import { prepareDemoPosSession } from '../support/demo-pos-session.ts';

/**
 * Exchanges approved lines from one committed cash order for approved
 * replacements, and confirms the result in Shopify.
 *
 * The exchange reuses the return machinery for the returned side and the cash
 * sale's add-to-cart routines for the replacement side, so a multi-variant
 * replacement takes the same variant-picker path a sale does.
 *
 * Net-refund and even exchanges use their observed native controls. Collect
 * exchanges stop before the commit checkpoint until their cash-tender path
 * has been verified from inside an exchange cart.
 */
describe('Shopify POS cash exchange', () => {
  it('exchanges approved lines for approved replacements and confirms the result in Shopify', async () => {
    const request = await readScenarioRequest();
    if (request.scriptId !== 'pos.exchange-cash-order') {
      throw new Error('This native spec is bound to the pos.exchange-cash-order request.');
    }
    if (request.assertionMode === 'pos') {
      throw new Error('An exchange run must verify beyond POS alone.');
    }
    const parameters = validateExchangeRequest(request.parameters);

    const root = process.env.IOS_TESTING_ROOT ?? process.cwd();
    const udid = process.env.IOS_UDID?.trim() ?? '';
    const context = createScenarioContext();
    const contextReader = createPosContextReader(root, udid);
    const artifactDir = resolve(process.env.RUN_ARTIFACT_DIR ?? join('artifacts', 'exchange-cash-order'));
    await mkdir(artifactDir, { recursive: true });

    await reportProgress('Checking Shopify POS is on Home with an empty cart');
    if (request.context?.shopDomain === 'hotwax-demo.myshopify.com') await prepareDemoPosSession();
    await pos.assertHome();
    await pos.assertEmptyCart();

    const driver = createExchangeDriver(parameters, contextReader);
    let result: Awaited<ReturnType<typeof exchangeCashOrder>> | undefined;
    try {
      result = await exchangeCashOrder(parameters, request, context, driver, udid);
    } finally {
      await saveEvidence(artifactDir, result ? 'exchange-complete' : 'exchange-failed');
    }

    await writeFile(join(artifactDir, 'exchange.json'), JSON.stringify({
      sourceOrderGid: result.sourceOrderGid,
      orderReference: parameters.orderReference ?? null,
      direction: parameters.direction,
      netDue: result.netDue,
      refundMethod: parameters.refundMethod,
      collectMethod: parameters.collectMethod,
      customer: parameters.customer ?? null,
      returnLines: parameters.lines,
      replacements: parameters.replacements,
      affectedIds: result.affectedIds,
    }, null, 2));
    await reportProgress('Shopify confirms the exchange with the approved lines; business effect confirmed', { orderGid: result.sourceOrderGid });

    await posReset.clearCartAndReturnHome();
  });
});

function validateExchangeRequest(parameters: unknown): ExchangeParameters {
  const input = parameters as ExchangeParameters;
  const remaining = Object.fromEntries((input?.lines ?? []).map(line => [line.lineGid, Number.MAX_SAFE_INTEGER]));
  return validateExchange(input, remaining);
}

async function saveEvidence(artifactDir: string, name: string): Promise<void> {
  const { browser } = await import('@wdio/globals');
  try { await browser.saveScreenshot(join(artifactDir, `${name}.png`)); } catch { /* the screen may be gone */ }
  try { await writeFile(join(artifactDir, `${name}.xml`), await browser.getPageSource()); } catch { /* best effort */ }
}
