import type { TargetContext } from '../../shared/contracts.ts';
import type { OmsOrder, OmsService } from './types.ts';
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

export async function resolveObservedOrder(service: OmsService, context: TargetContext, input: ObservedOrderInput): Promise<ObservedOrderResult> {
  const observedName = input.observedName.trim();
  if (!observedName || observedName.length > 120) throw new OmsError('invalid-data', 'The observed POS order reference is empty or too long.');
  if (input.runMarker !== undefined && (input.runMarker.length > 200 || /[\0\r\n]/.test(input.runMarker))) throw new OmsError('invalid-data', 'The observed POS run marker is invalid.');

  const connection = service.connections().find(item => item.id === context.connectionId);
  if (!connection || connection.origin !== context.omsOrigin || connection.state !== 'connected' || connection.userId !== context.userId) {
    throw new OmsError('authorization', 'The OMS session does not match the frozen run context.');
  }
  const shops = await service.shops(context.connectionId);
  const shop = shops.find(item => item.connectorShopId === context.connectorShopId);
  if (!shop || shop.shopGid !== context.shopGid || shop.shopDomain !== context.shopDomain) {
    throw new OmsError('authorization', 'The selected OMS shop does not match the frozen run context.');
  }

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
