import type { TargetContext } from '../../shared/contracts.ts';
import type { OmsOrder, OmsService, OmsShopifyOrderDetail } from './types.ts';
import { OmsError } from './types.ts';

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
