import { browser } from '@wdio/globals';
import { pos } from './pos.ts';
import { waitForPresent } from './wait.ts';

export async function assertSelectedCustomer(displayName: string): Promise<void> {
  const selected = browser.$('~Screen.Cart.CustomerRowText');
  if (!await selected.isDisplayed() || await selected.getAttribute('label') !== displayName.trim()) throw new Error('The POS cart no longer carries the exact planned customer; no sale was attempted.');
}

/** Existing-customer selection observed on the physical Demo iPad. */
export async function attachExistingCustomer(displayName: string): Promise<void> {
  const name = displayName.trim();
  if (!name || /[\x00\r\n"\\]/.test(name)) throw new Error('A bounded exact native customer name is required.');
  const selected = browser.$('~Screen.Cart.CustomerRowText');
  if (await selected.isExisting()) {
    if (await selected.getAttribute('label') === name) { await assertSelectedCustomer(name); return; }
    throw new Error('The native cart already belongs to a different customer; no sale was attempted.');
  }
  const add = browser.$('~Screen.Cart.AddCustomerRow');
  if (!await add.isDisplayed() || !await add.isEnabled()) throw new Error('POS does not offer its observed Add customer control.');
  await add.click();
  await waitForPresent('~Component.SearchBar.TextInput', { timeout: 20_000, timeoutMsg: 'POS did not open its customer search.' });
  // The observed Avery search finds Morgan's exact row without typing a
  // longer phrase through POS's character-dropping native input path.
  await pos.typeProductSearch(name.split(/\s+/).at(-1)!);
  const query = `-ios predicate string:type == "XCUIElementTypeButton" AND name == "Screen.CustomersList.ListCellButton${name}" AND label == "${name}" AND visible == 1`;
  await waitForPresent(query, { timeout: 20_000, timeoutMsg: 'POS did not find the exact planned customer.' });
  const rows = await browser.$$(query).getElements();
  if (rows.length !== 1) throw new Error('The native customer search does not identify one exact customer.');
  if (!await rows[0]!.isEnabled()) throw new Error('The exact native customer row is disabled.');
  await rows[0]!.click();
  await browser.waitUntil(async () => await selected.isDisplayed() && await selected.getAttribute('label') === name, {
    timeout: 20_000, timeoutMsg: 'The native POS cart did not retain the exact selected customer.',
  });
}
