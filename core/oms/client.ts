import { randomUUID } from 'node:crypto';
import type {
  OmsOrderCustomer, Page } from '../../shared/contracts.ts';
import { buildOmsOrigin, normalizeOmsInstanceName } from '../../shared/oms-origin.ts';
import { OmsSessionStore, type FetchLike } from './auth.ts';
import { assertNamedReadQuery, listLocationsQuery, listPosOrdersQuery, resolveOrderQuery, searchCustomersQuery, searchOrdersQuery, searchVariantsAtLocationQuery, searchVariantsQuery, type NamedReadOperation } from './queries/documents.ts';
import { OmsError, boundedCursor, boundedSearch, canonicalOrigin, type OmsConnectionConfig, type OmsConnectionDraft, type OmsConnectionSummary, type OmsLocation, type OmsOrder, type OmsOrderDetail, type OmsOrderItem, type OmsOrderRecord, type OmsService, type OmsCustomer, type OmsPosOrder, type OmsShop, type OmsShopifyOrderAgreement, type OmsShopifyOrderAgreementSale, type OmsShopifyOrderDetail, type OmsShopifyOrderLine, type OmsShopifyFulfillment, type OmsShopifyRefund, type OmsShopifyReturn, type OmsShopifyOrderTransaction, type OmsVariant } from './types.ts';

function object(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object') throw new OmsError('invalid-data', 'The OMS returned an invalid JSON object.');
  return value as Record<string, any>;
}

function array(value: unknown): Record<string, any>[] {
  return Array.isArray(value) ? value.filter(item => item && typeof item === 'object') as Record<string, any>[] : [];
}

function responseData(body: Record<string, any>): Record<string, any> {
  const value = typeof body.response === 'string' ? JSON.parse(body.response) : body.response ?? body;
  const envelope = object(value);
  if (Array.isArray(envelope.errors) && envelope.errors.length) throw new OmsError('graphql', 'Shopify returned a GraphQL read error.');
  return object(envelope.data ?? envelope);
}

function page<T>(connection: Record<string, any>, map: (item: Record<string, any>) => T): Page<T> {
  const nodes = array(connection.nodes ?? connection.edges?.map((edge: Record<string, any>) => edge?.node));
  const pageInfo = object(connection.pageInfo ?? {});
  return { items: nodes.map(map), nextCursor: pageInfo.hasNextPage && typeof pageInfo.endCursor === 'string' ? pageInfo.endCursor : null };
}

function optionalInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

// Shopify returns per-location stock as a named quantity list. A missing level
// means the item is not stocked at that location, which is reported as unknown
// rather than as a zero the operator might trust.
function optionalBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

// Shopify's `Count` carries a precision. Only an EXACT count is surfaced as a
// number; an AT_LEAST lower bound is reported as null so the planner never
// shows "3 variants" for a product that has thirty.
function exactCount(value: unknown): number | null {
  if (!value || typeof value !== 'object') return null;
  const count = value as Record<string, unknown>;
  if (count.precision !== undefined && count.precision !== 'EXACT') return null;
  return optionalInteger(count.count);
}

function namedQuantity(level: unknown, name: string): number | null {
  if (!level || typeof level !== 'object') return null;
  const quantities = array((level as Record<string, any>).quantities);
  const match = quantities.find(entry => String(entry.name ?? '') === name);
  return match ? optionalInteger(match.quantity) : null;
}

function requiredString(value: unknown, label: string): string {
  const result = String(value ?? '').trim();
  if (!result) throw new OmsError('invalid-data', `The OMS returned a shop record without ${label}.`);
  return result;
}

function optionalString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    value = record.uomId ?? record.currencyUomId ?? record.id ?? record.code;
  }
  const result = String(value ?? '').trim();
  return result || null;
}

function optionalNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function requiredNumber(value: unknown, label: string): number {
  const result = optionalNumber(value);
  if (result === null || !Number.isSafeInteger(result)) throw new OmsError('invalid-data', `The OMS returned an invalid ${label}.`);
  return result;
}

function boundedStrings(value: unknown, label: string, maximum: number): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > maximum) throw new OmsError('invalid-data', `The OMS returned too many or invalid ${label}.`);
  return value.map(item => requiredString(item, label));
}

function optionalMoney(value: unknown): string | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    value = (value as Record<string, unknown>).amount;
  }
  return optionalString(value);
}

function orderCustomer(raw: unknown): OmsOrderCustomer | null {
  // Planning metadata for a cloned order. Bounded and optional: an order with
  // no customer, or one the session cannot read, simply has none.
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  const gid = optionalString(value.id) ?? '';
  const field = (input: unknown): string => (optionalString(input) ?? '').slice(0, 120);
  const customer = { gid, firstName: field(value.firstName), lastName: field(value.lastName), email: field(value.email), phone: field(value.phone) };
  return customer.gid || customer.firstName || customer.lastName || customer.email || customer.phone ? customer : null;
}

function httpsImageUrl(value: unknown): string | null {
  const url = optionalString(value);
  if (!url) return null;
  try { return new URL(url).protocol === 'https:' ? url : null; } catch { return null; }
}

function shopIdentityGid(raw: Record<string, any>): string {
  // OMS returns the Shopify shop as a bare numeric id, but every consumer of a
  // frozen target context expects a GID. Project it the same way the primary
  // location is projected, and pass an already-formed GID through untouched.
  const direct = optionalString(raw.shopGid ?? raw.shop?.id);
  if (direct) return direct;
  const numeric = optionalString(raw.shopifyShopId);
  return numeric && /^\d+$/.test(numeric) ? `gid://shopify/Shop/${numeric}` : String(numeric ?? '');
}

function shopPrimaryLocationGid(raw: Record<string, any>): string | null {
  const direct = optionalString(raw.primaryLocationGid ?? raw.locationGid ?? raw.primaryLocation?.id);
  if (direct) return direct;
  const numeric = optionalString(raw.primaryLocationId);
  return numeric && /^\d+$/.test(numeric) ? `gid://shopify/Location/${numeric}` : null;
}

function orderPageIndex(cursor: string | undefined): number {
  const value = boundedCursor(cursor);
  if (value === null) return 0;
  if (!/^\d+$/.test(value)) throw new OmsError('invalid-data', 'The OMS order page cursor is invalid.');
  const pageIndex = Number(value);
  if (!Number.isSafeInteger(pageIndex) || pageIndex > 10_000) throw new OmsError('invalid-data', 'The OMS order page cursor is out of range.');
  return pageIndex;
}

function mapOrderRecord(raw: Record<string, any>): OmsOrderRecord {
  const orderId = requiredString(raw.orderId, 'an OMS order ID');
  const groups = array(raw.shipGroups);
  const itemCount = Array.isArray(raw.contents)
    ? raw.contents.length
    : groups.reduce((count, group) => count + array(group.items).length, 0);
  return {
    orderId,
    orderName: optionalString(raw.orderName) ?? orderId,
    externalId: optionalString(raw.externalId),
    statusId: optionalString(raw.statusId ?? raw.orderStatusId),
    orderDate: optionalString(raw.orderDate),
    grandTotal: optionalMoney(raw.grandTotal),
    currency: optionalString(raw.currencyUom ?? raw.currency),
    itemCount,
  };
}

function mapOrderDetail(raw: Record<string, any>): OmsOrderDetail {
  const detail = object(raw.orderDetail);
  const orderId = requiredString(detail.orderId, 'an OMS order ID');
  const groups = array(detail.shipGroups);
  const items: OmsOrderItem[] = groups.flatMap(group => array(group.items).map(item => ({
    orderItemSeqId: requiredString(item.orderItemSeqId, 'an OMS order item ID'),
    productId: optionalString(item.productId) ?? '',
    productName: optionalString(item.internalName),
    sku: optionalString(item.sku),
    quantity: optionalNumber(item.quantity ?? item.itemQuantity),
    shippedQuantity: optionalNumber(item.shippedQuantity),
    returnableQuantity: optionalNumber(item.returnableQuantity),
    alreadyReturnedQuantity: optionalNumber(item.alreadyReturnedQuantity),
    unitPrice: optionalMoney(item.unitPrice),
    shipGroupSeqId: optionalString(item.shipGroupSeqId ?? group.shipGroupSeqId),
    facilityId: optionalString(item.facilityId ?? group.facilityId),
    itemStatusId: optionalString(item.itemStatusId),
  })));
  return {
    orderId,
    orderName: optionalString(detail.orderName) ?? orderId,
    externalId: optionalString(detail.orderExternalId ?? detail.externalId),
    statusId: optionalString(detail.orderStatusId ?? detail.statusId),
    orderDate: optionalString(detail.orderDate),
    grandTotal: optionalMoney(detail.grandTotal),
    currency: optionalString(detail.currencyUom ?? detail.currency),
    items,
  };
}

function mapMoneySet(raw: Record<string, any> | undefined): { amount: string; currency: string } | null {
  const money = raw?.shopMoney;
  if (!money || typeof money !== 'object') return null;
  const amount = optionalString(money.amount);
  const currency = optionalString(money.currencyCode);
  return amount && currency ? { amount, currency } : null;
}

function mapOrderTransaction(raw: Record<string, any>): OmsShopifyOrderTransaction {
  const id = requiredString(raw.id, 'an order transaction ID');
  if (!/^gid:\/\/shopify\/OrderTransaction\/[A-Za-z0-9_-]+$/.test(id)) throw new OmsError('invalid-data', 'The OMS returned an invalid order transaction ID.');
  return {
    id,
    kind: requiredString(raw.kind, 'an order transaction kind'),
    status: requiredString(raw.status, 'an order transaction status'),
    gateway: optionalString(raw.gateway),
    amount: mapMoneySet(raw.amountSet),
  };
}

function mapAgreementSale(raw: Record<string, any>): OmsShopifyOrderAgreementSale {
  const lineGid = optionalString(raw.lineItem?.id);
  if (lineGid && !/^gid:\/\/shopify\/LineItem\/[A-Za-z0-9_-]+$/.test(lineGid)) throw new OmsError('invalid-data', 'The OMS returned an invalid order agreement line ID.');
  const variantGid = optionalString(raw.lineItem?.variant?.id);
  if (variantGid && !/^gid:\/\/shopify\/ProductVariant\/[A-Za-z0-9_-]+$/.test(variantGid)) throw new OmsError('invalid-data', 'The OMS returned an invalid order agreement variant ID.');
  return {
    actionType: requiredString(raw.actionType, 'an order agreement action'),
    lineType: requiredString(raw.lineType, 'an order agreement line type'),
    quantity: requiredNumber(raw.quantity, 'order agreement quantity'),
    amount: mapMoneySet(raw.totalAmount),
    lineGid,
    variantGid,
  };
}

function mapOrderAgreement(raw: Record<string, any>): OmsShopifyOrderAgreement {
  const id = requiredString(raw.id, 'an order agreement ID');
  if (!/^gid:\/\/shopify\/SalesAgreement\/[A-Za-z0-9_-]+$/.test(id)) throw new OmsError('invalid-data', 'The OMS returned an invalid order agreement ID.');
  const happenedAt = requiredString(raw.happenedAt, 'an order agreement timestamp');
  if (!Number.isFinite(Date.parse(happenedAt))) throw new OmsError('invalid-data', 'The OMS returned an invalid order agreement timestamp.');
  const returnGid = optionalString(raw.return?.id);
  if (returnGid && !/^gid:\/\/shopify\/Return\/[A-Za-z0-9_-]+$/.test(returnGid)) throw new OmsError('invalid-data', 'The OMS returned an invalid return ID.');
  return {
    id,
    happenedAt,
    returnGid,
    returnName: optionalString(raw.return?.name),
    sales: array(raw.sales?.nodes).slice(0, 100).map(mapAgreementSale),
  };
}

function returnLineGid(value: unknown): string | null {
  const gid = optionalString(value);
  if (gid && !/^gid:\/\/shopify\/LineItem\/[A-Za-z0-9_-]+$/.test(gid)) throw new OmsError('invalid-data', 'The OMS returned an invalid return line item ID.');
  return gid;
}

function mapShopifyReturn(raw: Record<string, any>): OmsShopifyReturn {
  const gid = requiredString(raw.id, 'a Shopify return ID');
  if (!/^gid:\/\/shopify\/Return\/[A-Za-z0-9_-]+$/.test(gid)) throw new OmsError('invalid-data', 'The OMS returned an invalid Shopify return ID.');
  return {
    gid,
    name: optionalString(raw.name),
    status: optionalString(raw.status),
    totalQuantity: optionalInteger(raw.totalQuantity),
    lines: array(raw.returnLineItems?.nodes).slice(0, 100).map(line => ({
      gid: requiredString(line.id, 'a Shopify return line ID'),
      quantity: optionalInteger(line.quantity) ?? 0,
      reason: optionalString(line.returnReason),
      reasonNote: optionalString(line.returnReasonNote),
      customerNote: optionalString(line.customerNote),
      // Absent on an UnverifiedReturnLineItem, which has no fulfillment link.
      lineGid: returnLineGid(line.fulfillmentLineItem?.lineItem?.id),
    })),
  };
}

function mapShopifyRefund(raw: Record<string, any>): OmsShopifyRefund {
  const gid = requiredString(raw.id, 'a Shopify refund ID');
  if (!/^gid:\/\/shopify\/Refund\/[A-Za-z0-9_-]+$/.test(gid)) throw new OmsError('invalid-data', 'The OMS returned an invalid Shopify refund ID.');
  return {
    gid,
    createdAt: optionalString(raw.createdAt),
    total: mapMoneySet(raw.totalRefundedSet),
    lines: array(raw.refundLineItems?.nodes).slice(0, 100).map(line => ({
      quantity: optionalInteger(line.quantity) ?? 0,
      restockType: optionalString(line.restockType),
      lineGid: returnLineGid(line.lineItem?.id),
    })),
    transactions: array(raw.transactions?.nodes).slice(0, 50).map(mapOrderTransaction),
  };
}

function mapShopifyFulfillment(raw: Record<string, any>): OmsShopifyFulfillment {
  const gid = requiredString(raw.id, 'a Shopify fulfillment ID');
  if (!/^gid:\/\/shopify\/Fulfillment\/[A-Za-z0-9_-]+$/.test(gid)) throw new OmsError('invalid-data', 'The OMS returned an invalid Shopify fulfillment ID.');
  return {
    gid,
    status: optionalString(raw.status),
    lines: array(raw.fulfillmentLineItems?.nodes).flatMap(line => {
      const lineGid = returnLineGid(line.lineItem?.id);
      return lineGid ? [{ lineGid, quantity: optionalInteger(line.quantity) ?? 0 }] : [];
    }),
  };
}

function mapShopifyOrder(raw: Record<string, any>): OmsShopifyOrderDetail {
  const gid = requiredString(raw.id, 'a Shopify order GID');
  if (!/^gid:\/\/shopify\/Order\/[A-Za-z0-9_-]+$/.test(gid)) throw new OmsError('invalid-data', 'The OMS returned an invalid Shopify order ID.');
  const lines: OmsShopifyOrderLine[] = array(raw.lineItems?.nodes).map(line => {
    const variant = line.variant && typeof line.variant === 'object' ? line.variant as Record<string, any> : undefined;
    const product = variant?.product && typeof variant.product === 'object' ? variant.product as Record<string, any> : undefined;
    return {
      gid: requiredString(line.id, 'a Shopify order line GID'),
      quantity: optionalNumber(line.quantity) ?? 0,
      refundableQuantity: optionalNumber(line.refundableQuantity),
      unitPrice: mapMoneySet(line.originalUnitPriceSet),
      variantGid: optionalString(variant?.id),
      variantTitle: optionalString(variant?.title),
      sku: optionalString(variant?.sku),
      productGid: optionalString(product?.id),
      productTitle: optionalString(product?.title),
      hasOnlyDefaultVariant: optionalBoolean(product?.hasOnlyDefaultVariant),
      productVariantCount: exactCount(product?.variantsCount),
    };
  });
  const pageInfo = raw.lineItems?.pageInfo && typeof raw.lineItems.pageInfo === 'object' ? raw.lineItems.pageInfo as Record<string, any> : {};
  const transactions = array(raw.transactions).slice(0, 100).map(mapOrderTransaction);
  const agreements = array(raw.agreements?.nodes).filter(item => item.__typename === 'ReturnAgreement').slice(0, 25).map(mapOrderAgreement);
  // A truncated return list would silently under-report what the store holds,
  // which is exactly what the read-back exists to rule out.
  if (object(raw.returns ?? {}).pageInfo?.hasNextPage === true) throw new OmsError('invalid-data', 'The order has more returns than the reviewed read-back document fetches.');
  const returns = array(raw.returns?.nodes).slice(0, 20).map(mapShopifyReturn);
  const refundNodes = array(raw.refunds);
  if (refundNodes.length >= 20) throw new OmsError('invalid-data', 'The order has more refunds than the reviewed read-back document fetches.');
  const refunds = refundNodes.map(mapShopifyRefund);
  const fulfillments = array(raw.fulfillments).slice(0, 25).map(mapShopifyFulfillment);
  return {
    gid,
    legacyResourceId: optionalString(raw.legacyResourceId),
    name: requiredString(raw.name, 'a Shopify order name'),
    financialStatus: optionalString(raw.displayFinancialStatus),
    fulfillmentStatus: optionalString(raw.displayFulfillmentStatus),
    total: mapMoneySet(raw.totalPriceSet),
    paymentGatewayNames: boundedStrings(raw.paymentGatewayNames, 'payment gateway names', 20),
    customer: orderCustomer(raw.customer),
    transactions,
    agreements,
    returnStatus: optionalString(raw.returnStatus),
    returns,
    refunds,
    fulfillments,
    lines,
    nextCursor: pageInfo.hasNextPage && typeof pageInfo.endCursor === 'string' ? pageInfo.endCursor : null,
  };
}

function shopApiVersion(raw: Record<string, any>): string | null {
  // The Shopify API version is configured on the OMS shop record, never supplied
  // by the operator. `shopifyConfig` is a many-relationship in the ShopifyShop
  // master, so it arrives as an array. Only a well-formed version is accepted,
  // and configs that disagree are treated as unresolved rather than guessed.
  const configs = Array.isArray(raw.shopifyConfig) ? raw.shopifyConfig : raw.shopifyConfig ? [raw.shopifyConfig] : [];
  const candidates = [raw.apiVersion, ...configs.map((config: any) => object(config).apiVersion)];
  const versions = new Set(candidates.map(value => String(value ?? '').trim()).filter(value => /^\d{4}-\d{2}$/.test(value)));
  return versions.size === 1 ? [...versions][0] : null;
}

export class OmsClient implements OmsService {
  private readonly connectionsById = new Map<string, OmsConnectionConfig>();
  private readonly sessions: OmsSessionStore;
  private readonly fetchImpl: FetchLike;

  constructor(connections: OmsConnectionConfig[], fetchImpl: FetchLike = fetch) {
    this.fetchImpl = fetchImpl;
    this.sessions = new OmsSessionStore(fetchImpl);
    for (const connection of connections) this.connectionsById.set(connection.id, { ...connection, origin: canonicalOrigin(connection.origin) });
  }

  private connection(id: string): OmsConnectionConfig {
    const connection = this.connectionsById.get(id);
    if (!connection) throw new OmsError('configuration', 'The selected OMS connection is not configured.');
    return connection;
  }

  connections(): OmsConnectionSummary[] {
    return [...this.connectionsById.values()].map(connection => ({ ...connection, ...this.sessions.status(connection.id) }));
  }

  addConnection(draft: OmsConnectionDraft): OmsConnectionSummary {
    let instanceName: string;
    try { instanceName = normalizeOmsInstanceName(draft.instanceName); }
    catch (error) { throw new OmsError('configuration', error instanceof Error ? error.message : 'The OMS instance name is invalid.'); }
    const origin = buildOmsOrigin(instanceName);
    const label = instanceName;
    const existing = [...this.connectionsById.values()].find(connection => connection.origin === origin);
    if (existing) return { ...existing, ...this.sessions.status(existing.id) };
    const connection: OmsConnectionConfig = { id: `oms-${randomUUID().replaceAll('-', '')}`, label, origin };
    this.connectionsById.set(connection.id, connection);
    return { ...connection, state: 'configured' };
  }

  async login(connectionId: string, credentials: { username: string; password: string }): Promise<OmsConnectionSummary> {
    const connection = this.connection(connectionId);
    const session = await this.sessions.login(connection, credentials);
    return { ...connection, state: 'connected', ...session };
  }

  async logout(connectionId: string): Promise<void> { await this.sessions.logout(this.connection(connectionId)); }

  async health(connectionId: string): Promise<OmsConnectionSummary> {
    const connection = this.connection(connectionId);
    try {
      await this.get(connectionId, '/rest/s1/admin/user/profile');
    } catch (error) {
      if (error instanceof OmsError && error.code === 'authentication') this.sessions.clear(connectionId);
      throw error;
    }
    return { ...connection, ...this.sessions.status(connectionId) };
  }

  private async get(connectionId: string, path: string): Promise<unknown> {
    const connection = this.connection(connectionId);
    let response: Response;
    try {
      response = await this.fetchImpl(`${connection.origin}${path}`, { method: 'GET', redirect: 'manual', headers: { Accept: 'application/json', Authorization: `Bearer ${this.sessions.token(connectionId)}` } });
    } catch { throw new OmsError('transport', 'The OMS request could not be completed.'); }
    if (response.status >= 300 && response.status < 400) throw new OmsError('transport', 'The OMS returned a redirect; credentials were not forwarded.');
    const body = await response.json().catch(() => ({})) as unknown;
    if (!response.ok) throw new OmsError(response.status === 401 ? 'authentication' : response.status === 403 ? 'authorization' : response.status === 429 ? 'rate-limited' : 'transport', `The OMS read failed with HTTP ${response.status}.`, response.status);
    return body;
  }

  async shops(connectionId: string): Promise<OmsShop[]> {
    const body = await this.get(connectionId, '/rest/s1/sob/shopify/shops');
    const container = Array.isArray(body) ? body : object(body);
    const rows = Array.isArray(container) ? array(container) : array(container.shops ?? container.data ?? container.results);
    return rows.map(raw => ({
      connectorShopId: requiredString(raw.shopId ?? raw.connectorShopId ?? raw.id, 'a connector shop ID'),
      shopGid: shopIdentityGid(raw),
      shopDomain: String(raw.shopDomain ?? raw.domain ?? raw.shop?.domain ?? ''),
      name: String(raw.shopName ?? raw.name ?? raw.shop?.name ?? raw.shopDomain ?? 'Unnamed shop'),
      locationGid: shopPrimaryLocationGid(raw),
      currency: raw.currency ?? null,
      timezone: raw.timezone ?? null,
      apiVersion: shopApiVersion(raw),
    }));
  }

  private async selectedShop(connectionId: string, connectorShopId: string): Promise<void> {
    if (!connectorShopId.trim()) throw new OmsError('invalid-data', 'A connector shop must be selected.');
    const shops = await this.shops(connectionId);
    if (!shops.some(shop => shop.connectorShopId === connectorShopId)) throw new OmsError('authorization', 'The selected shop is not available to this OMS session.');
  }

  private async graphql(connectionId: string, connectorShopId: string, operation: NamedReadOperation, queryText: string, variables: Record<string, unknown>): Promise<Record<string, any>> {
    assertNamedReadQuery(operation, queryText);
    await this.selectedShop(connectionId, connectorShopId);
    const connection = this.connection(connectionId);
    let response: Response;
    try {
      response = await this.fetchImpl(`${connection.origin}/rest/s1/shopify/graphql`, {
        method: 'POST', redirect: 'manual',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${this.sessions.token(connectionId)}` },
        body: JSON.stringify({ shopId: connectorShopId, queryText, variables }),
      });
    } catch { throw new OmsError('transport', 'The OMS GraphQL request could not be completed.'); }
    if (response.status >= 300 && response.status < 400) throw new OmsError('transport', 'The OMS returned a redirect; credentials were not forwarded.');
    const body = object(await response.json().catch(() => ({})));
    const effectiveStatus = Number(body.statusCode ?? response.status);
    if (!response.ok || effectiveStatus >= 400) throw new OmsError(response.status === 401 || effectiveStatus === 401 ? 'authentication' : response.status === 403 || effectiveStatus === 403 ? 'authorization' : response.status === 429 || effectiveStatus === 429 ? 'rate-limited' : 'transport', `The OMS GraphQL read failed with HTTP ${effectiveStatus}.`, effectiveStatus);
    return responseData(body);
  }

  async searchVariants(connectionId: string, connectorShopId: string, input: { search: string; cursor?: string; locationGid?: string }): Promise<Page<OmsVariant>> {
    const locationGid = String(input.locationGid ?? '').trim();
    if (locationGid && !/^gid:\/\/shopify\/Location\/[A-Za-z0-9_-]+$/.test(locationGid)) throw new OmsError('invalid-data', 'The location scope must be an exact Shopify location GID.');
    const variables = { first: 25, after: boundedCursor(input.cursor), query: boundedSearch(input.search) || null };
    const data = locationGid
      ? await this.graphql(connectionId, connectorShopId, 'searchVariantsAtLocation', searchVariantsAtLocationQuery, { ...variables, locationId: locationGid })
      : await this.graphql(connectionId, connectorShopId, 'searchVariants', searchVariantsQuery, variables);
    return page(data.productVariants, raw => ({
      gid: requiredString(raw.id, 'a variant ID'),
      productGid: requiredString(raw.product?.id, 'a product ID'),
      title: String(raw.title ?? 'Default'),
      productTitle: String(raw.product?.title ?? ''),
      sku: raw.sku == null ? null : String(raw.sku),
      price: optionalString(raw.price),
      compareAtPrice: optionalString(raw.compareAtPrice),
      availableForSale: typeof raw.availableForSale === 'boolean' ? raw.availableForSale : null,
      productStatus: optionalString(raw.product?.status),
      // A variant may have its own image; otherwise the product's featured one
      // stands in. Only https URLs are surfaced to the browser.
      imageUrl: httpsImageUrl(raw.image?.url ?? raw.product?.featuredImage?.url),
      inventoryTracked: typeof raw.inventoryItem?.tracked === 'boolean' ? raw.inventoryItem.tracked : null,
      availableAtLocation: locationGid ? namedQuantity(raw.inventoryItem?.inventoryLevel, 'available') : null,
      totalInventory: optionalInteger(raw.inventoryQuantity),
      hasOnlyDefaultVariant: optionalBoolean(raw.product?.hasOnlyDefaultVariant),
      productVariantCount: exactCount(raw.product?.variantsCount),
    }));
  }

  // Recent POS-originated orders, newest first, for the "use an existing order"
  // picker. The item preview is capped by the reviewed document, so an order
  // with more lines reports that rather than showing a short list as complete.
  async listPosOrders(connectionId: string, connectorShopId: string, input: { cursor?: string } = {}): Promise<Page<OmsPosOrder>> {
    const data = await this.graphql(connectionId, connectorShopId, 'listPosOrders', listPosOrdersQuery, { first: 25, after: boundedCursor(input.cursor) });
    return page(data.orders, raw => {
      const lineItems = object(raw.lineItems ?? {});
      return {
        gid: requiredString(raw.id, 'an order ID'),
        name: requiredString(raw.name, 'an order name'),
        createdAt: optionalString(raw.createdAt),
        financialStatus: optionalString(raw.displayFinancialStatus),
        fulfillmentStatus: optionalString(raw.displayFulfillmentStatus),
        customerName: optionalString(raw.customer?.displayName),
        total: mapMoneySet(raw.totalPriceSet),
        items: array(lineItems.nodes).map(item => ({ title: String(item.title ?? 'Unnamed item'), quantity: optionalInteger(item.quantity) ?? 0 })),
        hasMoreItems: object(lineItems.pageInfo ?? {}).hasNextPage === true,
      };
    });
  }

  // Read-only customer lookup for planning. It never creates or edits a
  // customer; the app exposes no Shopify mutation.
  async searchCustomers(connectionId: string, connectorShopId: string, input: { search: string; cursor?: string }): Promise<Page<OmsCustomer>> {
    const data = await this.graphql(connectionId, connectorShopId, 'searchCustomers', searchCustomersQuery, { first: 25, after: boundedCursor(input.cursor), query: boundedSearch(input.search) || null });
    return page(data.customers, raw => ({
      gid: requiredString(raw.id, 'a customer ID'),
      displayName: String(raw.displayName ?? [raw.firstName, raw.lastName].filter(Boolean).join(' ') ?? '').trim() || 'Unnamed customer',
      firstName: optionalString(raw.firstName),
      lastName: optionalString(raw.lastName),
      email: optionalString(raw.email),
      phone: optionalString(raw.phone),
      orderCount: optionalInteger(raw.numberOfOrders),
      location: [object(raw.defaultAddress ?? {}).city, object(raw.defaultAddress ?? {}).province, object(raw.defaultAddress ?? {}).country].map(part => String(part ?? '').trim()).filter(Boolean).join(', ') || null,
    }));
  }

  async searchOrders(connectionId: string, connectorShopId: string, input: { search: string; cursor?: string }): Promise<Page<OmsOrder>> {
    const data = await this.graphql(connectionId, connectorShopId, 'searchOrders', searchOrdersQuery, { first: 25, after: boundedCursor(input.cursor), query: boundedSearch(input.search) || null });
    return page(data.orders, raw => ({ gid: requiredString(raw.id, 'an order ID'), name: requiredString(raw.name, 'an order name'), financialStatus: raw.displayFinancialStatus == null ? null : String(raw.displayFinancialStatus), fulfillmentStatus: raw.displayFulfillmentStatus == null ? null : String(raw.displayFulfillmentStatus) }));
  }

  async resolveOrder(connectionId: string, connectorShopId: string, input: { gid: string; cursor?: string }): Promise<OmsShopifyOrderDetail> {
    if (!/^gid:\/\/shopify\/Order\/[A-Za-z0-9_-]+$/.test(input.gid)) throw new OmsError('invalid-data', 'The Shopify order identifier must be an exact order GID.');
    const data = await this.graphql(connectionId, connectorShopId, 'resolveOrder', resolveOrderQuery, { id: input.gid, lineFirst: 50, lineAfter: boundedCursor(input.cursor) });
    if (!data.order || typeof data.order !== 'object') throw new OmsError('invalid-data', 'The selected Shopify order was not found in the selected shop.');
    return mapShopifyOrder(data.order as Record<string, any>);
  }

  async searchOrderRecords(connectionId: string, input: { search?: string; cursor?: string }): Promise<Page<OmsOrderRecord>> {
    const search = boundedSearch(input.search);
    const base = new URLSearchParams({ pageSize: '25', orderTypeId: 'SALES_ORDER', orderByField: '-orderDate' });
    if (search) {
      // The OMS list resource supports exact field filters. Try the three stable
      // identifiers in order so a caller can paste an OMS ID, order name, or
      // connector external ID without introducing an arbitrary query proxy.
      for (const field of ['orderId', 'orderName', 'externalId']) {
        const params = new URLSearchParams(base);
        params.set(field, search);
        const rows = array(await this.get(connectionId, `/rest/s1/oms/orders?${params.toString()}`));
        if (rows.length) return { items: rows.map(mapOrderRecord), nextCursor: null };
      }
      return { items: [], nextCursor: null };
    }
    const pageIndex = orderPageIndex(input.cursor);
    base.set('pageIndex', String(pageIndex));
    const rows = array(await this.get(connectionId, `/rest/s1/oms/orders?${base.toString()}`));
    return { items: rows.map(mapOrderRecord), nextCursor: rows.length === 25 ? String(pageIndex + 1) : null };
  }

  async getOrderDetail(connectionId: string, orderId: string): Promise<OmsOrderDetail> {
    const value = orderId.trim();
    if (!/^[A-Za-z0-9_.-]{1,120}$/.test(value)) throw new OmsError('invalid-data', 'The OMS order ID is invalid.');
    return mapOrderDetail(object(await this.get(connectionId, `/rest/s1/oms/orders/${encodeURIComponent(value)}`)));
  }

  async listLocations(connectionId: string, connectorShopId: string, input: { cursor?: string }): Promise<Page<OmsLocation>> {
    const data = await this.graphql(connectionId, connectorShopId, 'listLocations', listLocationsQuery, { first: 25, after: boundedCursor(input.cursor) });
    return page(data.locations, raw => ({ gid: requiredString(raw.id, 'a location ID'), name: requiredString(raw.name, 'a location name') }));
  }
}
