import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { browser } from '@wdio/globals';
import { pos } from '../screens/pos.ts';

describe('Shopify POS cart precondition inspection', () => {
  it('confirms an empty cart from Home without opening checkout', async () => {
    await pos.assertHome();
    await pos.assertEmptyCart();
    const artifactDir = resolve(process.env.RUN_ARTIFACT_DIR ?? join('artifacts', 'inspection-cart'));
    await mkdir(artifactDir, { recursive: true });
    await writeFile(join(artifactDir, 'empty-cart.xml'), await browser.getPageSource());
    await browser.saveScreenshot(join(artifactDir, 'empty-cart.png'));
  });
});
