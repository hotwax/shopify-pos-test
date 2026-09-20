import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { browser } from '@wdio/globals';

describe('Shopify POS native inspection', () => {
  it('captures the current accessibility tree without changing POS state', async () => {
    const artifactDir = resolve(process.env.RUN_ARTIFACT_DIR ?? join('artifacts', 'inspection'));
    await mkdir(artifactDir, { recursive: true });
    await writeFile(join(artifactDir, 'current-screen.xml'), await browser.getPageSource());
    await browser.saveScreenshot(join(artifactDir, 'current-screen.png'));
  });
});
