import type { Money, TargetContext } from '../../shared/contracts.ts';
import type { OmsOrder, OmsPosOrder, OmsService, OmsShopifyOrderDetail } from './types.ts';
import { OmsError } from './types.ts';
import { compareMoney } from '../safety/money.ts';

export interface ObservedOrderInput {
  observedName: string;
  runMarker?: string;
}

export interface ObservedOrderResult {
  orderGid: string;
  orderName: string;
}

function exactOrderGid(value: string): boolean { return /^gid:\/\/shopify\/Order\/[A-Za-z0-9_-]+$/.test(value); }

async function assertFrozenShop(service: OmsService, context: TargetContext): Promise<void> {
  const connection = service.connections().find(item => item.id === context.connectionId);
  if (!connection || connection.origin !== context.omsOrigin || connection.state !== 'connected' || connection.userId !== context.userId) {
    throw new OmsError('authorization', 'The OMS session does not match the frozen run context.');
  }
  const shops = await service.shops(context.connectionId);
  const shop = shops.find(item => item.connectorShopId === context.connectorShopId);
  if (!shop || shop.shopGid !== context.shopGid || shop.shopDomain !== context.shopDomain) {
    throw new OmsError('authorization', 'The selected OMS shop does not match the frozen run context.');
  }
}

export async function resolveObservedOrder(service: OmsService, context: TargetContext, input: ObservedOrderInput): Promise<ObservedOrderResult> {
  const observedName = input.observedName.trim();
  if (!observedName || observedName.length > 120) throw new OmsError('invalid-data', 'The observed POS order reference is empty or too long.');
  if (input.runMarker !== undefined && (input.runMarker.length > 200 || /[\0\r\n]/.test(input.runMarker))) throw new OmsError('invalid-data', 'The observed POS run marker is invalid.');

  await assertFrozenShop(service, context);

  const matches: OmsOrder[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < 10; page++) {
    const result = await service.searchOrders(context.connectionId, context.connectorShopId, { search: observedName, cursor });
    matches.push(...result.items.filter(item => item.name.trim() === observedName));
    if (!result.nextCursor) break;
    if (seenCursors.has(result.nextCursor)) throw new OmsError('invalid-data', 'The OMS order search returned a repeated page cursor.');
    seenCursors.add(result.nextCursor);
    cursor = result.nextCursor;
    if (page === 9) throw new OmsError('invalid-data', 'The OMS order search did not finish within the bounded page limit.');
  }
  if (!matches.length) throw new OmsError('invalid-data', 'The observed POS order was not found in the selected OMS shop.');
  if (matches.length !== 1 || !exactOrderGid(matches[0].gid)) throw new OmsError('invalid-data', 'The observed POS order reference is ambiguous or has an invalid Shopify identity.');
  return { orderGid: matches[0].gid, orderName: matches[0].name.trim() };
}

export async function resolveShopifyOrder(service: OmsService, context: TargetContext, input: { orderGid: string }): Promise<OmsShopifyOrderDetail> {
  if (!exactOrderGid(input.orderGid)) throw new OmsError('invalid-data', 'The Shopify order identity is invalid.');
  await assertFrozenShop(service, context);
  const lines = [] as OmsShopifyOrderDetail['lines'];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  let first: OmsShopifyOrderDetail | undefined;
  for (let page = 0; page < 10; page++) {
    const detail = await service.resolveOrder(context.connectionId, context.connectorShopId, { gid: input.orderGid, cursor });
    if (detail.gid !== input.orderGid) throw new OmsError('invalid-data', 'The OMS returned a different Shopify order identity than requested.');
    if (!first) first = detail;
    else if (detail.name !== first.name) throw new OmsError('invalid-data', 'The OMS returned inconsistent Shopify order readback.');
    lines.push(...detail.lines);
    if (!detail.nextCursor) return { ...first, lines, nextCursor: null };
    if (seenCursors.has(detail.nextCursor)) throw new OmsError('invalid-data', 'The Shopify order detail returned a repeated page cursor.');
    seenCursors.add(detail.nextCursor);
    cursor = detail.nextCursor;
    if (page === 9) throw new OmsError('invalid-data', 'The Shopify order detail did not finish within the bounded page limit.');
  }
  throw new OmsError('invalid-data', 'The Shopify order detail could not be completed.');
}

export interface RecentOrderInput {
  /** ISO time captured just before the committing tap on POS. */
  notBefore: string;
  total: Money;
  lineCount: number;
}

// The sidecar's clock and Shopify's are not the same clock. Ninety seconds of
// tolerance covers ordinary drift without reaching back to the previous run.
const CLOCK_SKEW_MS = 90_000;
const FUTURE_TOLERANCE_MS = 5 * 60_000;
/** The POS order preview is capped at this many lines by the reviewed query. */
const PREVIEW_LINE_CAP = 5;

function lineCountMatches(order: OmsPosOrder, lineCount: number): boolean {
  if (lineCount <= PREVIEW_LINE_CAP) return order.items.length === lineCount && !order.hasMoreItems;
  return order.items.length === PREVIEW_LINE_CAP && order.hasMoreItems;
}

/**
 * Finds the one POS order the run just created without reading anything from
 * the POS Orders tab: newest POS orders first, created no earlier than the
 * commit time (minus clock skew), with exactly the tendered total and the
 * approved line count. Zero or several matches fail closed; the caller then
 * reconciles instead of guessing. The match is an identity only: the caller
 * still reads the order back from Shopify and checks its lines.
 */
export async function resolveRecentPosOrder(service: OmsService, context: TargetContext, input: RecentOrderInput, now = Date.now()): Promise<ObservedOrderResult> {
  const notBefore = Date.parse(input.notBefore);
  if (!Number.isFinite(notBefore)) throw new OmsError('invalid-data', 'The commit time for the recent-order correlation is invalid.');
  if (!/^\d+(?:\.\d{1,4})?$/.test(input.total.amount) || !/^[A-Z]{3}$/.test(input.total.currency)) throw new OmsError('invalid-data', 'The tendered total for the recent-order correlation is invalid.');
  if (!Number.isSafeInteger(input.lineCount) || input.lineCount < 1 || input.lineCount > 1000) throw new OmsError('invalid-data', 'The line count for the recent-order correlation is invalid.');

  await assertFrozenShop(service, context);

  const earliest = notBefore - CLOCK_SKEW_MS;
  const latest = now + FUTURE_TOLERANCE_MS;
  const matches: OmsPosOrder[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  let reachedOlderOrders = false;
  for (let page = 0; page < 3 && !reachedOlderOrders; page++) {
    const result = await service.listPosOrders(context.connectionId, context.connectorShopId, { cursor });
    for (const order of result.items) {
      const createdAt = order.createdAt ? Date.parse(order.createdAt) : Number.NaN;
      if (!Number.isFinite(createdAt)) continue;
      // The list is newest first, so the first older order ends the search.
      if (createdAt < earliest) { reachedOlderOrders = true; break; }
      if (createdAt > latest || !order.total) continue;
      if (order.total.currency !== input.total.currency || compareMoney(order.total, input.total) !== 0) continue;
      if (!lineCountMatches(order, input.lineCount)) continue;
      matches.push(order);
    }
    if (!result.nextCursor) break;
    if (seenCursors.has(result.nextCursor)) throw new OmsError('invalid-data', 'The OMS POS order list returned a repeated page cursor.');
    seenCursors.add(result.nextCursor);
    cursor = result.nextCursor;
  }
  if (!matches.length) throw new OmsError('invalid-data', `No POS order created since ${input.notBefore} matches the tendered total ${input.total.amount} ${input.total.currency} with ${input.lineCount} line(s).`);
  if (matches.length > 1 || !exactOrderGid(matches[0]!.gid)) throw new OmsError('invalid-data', `More than one POS order created since ${input.notBefore} matches the tendered total; the sale must be reconciled by hand.`);
  return { orderGid: matches[0]!.gid, orderName: matches[0]!.name.trim() };
}
