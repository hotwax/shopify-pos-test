import { browser } from '@wdio/globals';
import * as s from './pos.selectors.ts';
import { readRowReference } from './reference.ts';

async function requireTouchable(element: WebdriverIO.Element, message: string): Promise<void> {
  if (!await element.isDisplayed() || !await element.isEnabled() ||
      await element.getAttribute('hittable') !== 'true') throw new Error(message);
}

async function requireNoAlert(): Promise<void> {
  if (await browser.$('XCUIElementTypeAlert').isDisplayed()) {
    throw new Error('Dismiss the blocking iOS/POS alert yourself before testing.');
  }
}

export const pos = {
  async assertHome(): Promise<void> {
    await requireNoAlert();
    const home = await browser.$(s.homeTab).getElement();
    if (!await browser.$(s.homeScreen).isDisplayed() || !await home.isSelected()) {
      throw new Error('Start on Shopify POS Home, with no dialog or order detail open.');
    }
    await requireTouchable(home, 'POS Home is blocked; dismiss the overlay yourself.');
  },

  async openOrders(): Promise<void> {
    await requireNoAlert();
    const tab = await browser.$(s.ordersTab).getElement();
    await requireTouchable(tab, 'Orders navigation is blocked or unavailable.');
    await tab.click();
    await browser.waitUntil(async () => {
      const screen = await browser.$(s.ordersScreen);
      if (!await screen.isDisplayed() || !await tab.isSelected()) return false;
      if (await screen.$(s.emptySearch).isDisplayed()) return true;
      const list = await browser.$(s.ordersList);
      return await list.isDisplayed() &&
        !await screen.$(s.loading).isDisplayed() &&
        (await list.$$(s.orderRows).getElements()).length > 0;
    }, {
      timeout: 20_000,
      timeoutMsg: 'No loaded order rows: the current list may be empty, still loading, or unsupported. Filters were not changed.',
    });
    if (await browser.$(s.ordersScreen).$(s.emptySearch).isDisplayed()) {
      throw new Error('The current Orders list is empty.');
    }
  },

  async openFirstOrder(): Promise<string> {
    await requireNoAlert();
    if (await browser.$(s.ordersScreen).$(s.emptySearch).isDisplayed()) {
      throw new Error('The current Orders list is empty.');
    }
    const list = await browser.$(s.ordersList);
    const scrolls = await list.$$(s.orderScroll).getElements();
    if (scrolls.length !== 1) throw new Error('Cannot identify exactly one order-list scroll container.');
    const scroll = scrolls[0];

    for (let attempt = 0; attempt < 10; attempt++) {
      // Always scroll up at least once. A rounded 0% indicator alone is not
      // enough; the first row must also start at the container's top edge.
      await browser.execute('mobile: scroll', { elementId: scroll.elementId, direction: 'up' });
      const bars = await scroll.$$(s.verticalScrollbars).getElements();
      const percentages = await bars.map(async bar => await bar.getAttribute('value'));
      const rows = await scroll.$$(s.orderRows).getElements();
      if (!rows.length) throw new Error('No order rows remain in the current list.');
      const first = rows[0];
      const rowPosition = await first.getLocation();
      const scrollPosition = await scroll.getLocation();
      if (!percentages.length || !percentages.every(value => value === '0%') ||
          Math.abs(rowPosition.y - scrollPosition.y) > 1) continue;

      const reference = readRowReference(await first.getAttribute(s.rowReference));
      const identity = await first.getAttribute('name');
      await requireTouchable(first, 'The first order row is blocked or unavailable.');
      // Refetch immediately before the tap so a list refresh cannot silently
      // change which row is first. A stale element also fails without retries.
      const freshRows = await scroll.$$(s.orderRows).getElements();
      if (!freshRows.length || await freshRows[0].getAttribute('name') !== identity ||
          readRowReference(await freshRows[0].getAttribute(s.rowReference)) !== reference) {
        throw new Error('The first order changed during selection; return to Home and rerun.');
      }
      await freshRows[0].click();
      return reference;
    }
    throw new Error('Could not establish the beginning of the order list within 10 upward scrolls.');
  },

  async assertOrderDetail(reference: string): Promise<void> {
    const content = await browser.$(s.detailContent);
    await content.waitForDisplayed({ timeout: 20_000 });
    const titles = await content.$$(s.detailReference).getElements();
    if (titles.length !== 1 || !await titles[0].isDisplayed()) {
      throw new Error('Expected exactly one visible order detail reference.');
    }
    if ((await titles[0].getAttribute('label'))?.trim() !== reference) {
      throw new Error('Order detail reference does not match the selected list row.');
    }
  },
};
