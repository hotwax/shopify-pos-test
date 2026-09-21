import type { Page } from '../../shared/contracts.ts';

export interface OmsConnectionConfig {
  id: string;
  label: string;
  origin: string;
}

export interface OmsConnectionDraft {
  instanceName: string;
}

export interface OmsConnectionSummary extends OmsConnectionConfig {
  state: 'configured' | 'connected' | 'expired' | 'error';
  userId?: string;
  expiresAt?: string;
  error?: string;
}

export interface OmsShop {
  connectorShopId: string;
  shopGid: string;
  shopDomain: string;
  name: string;
  locationGid: string | null;
  currency: string | null;
  timezone: string | null;
  apiVersion: string | null;
}

export interface OmsPosOrderItem { title: string; quantity: number }

export interface OmsPosOrder {
  gid: string;
  name: string;
  createdAt: string | null;
  financialStatus: string | null;
  fulfillmentStatus: string | null;
  customerName: string | null;
  total: { amount: string; currency: string } | null;
  items: OmsPosOrderItem[];
  /** True when the order has more lines than the preview shows. */
  hasMoreItems: boolean;
}

export interface OmsCustomer {
  gid: string;
  displayName: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  orderCount: number | null;
  location: string | null;
}

export interface OmsVariant {
  gid: string;
  productGid: string;
  title: string;
  productTitle: string;
  sku: string | null;
  price: string | null;
  compareAtPrice: string | null;
  availableForSale: boolean | null;
  productStatus: string | null;
  imageUrl: string | null;
  inventoryTracked: boolean | null;
  // Stock at the expected POS location. `null` means it was not read (no
  // location scope) or the item is untracked, which is not the same as zero.
  availableAtLocation: number | null;
  totalInventory: number | null;
  // Variant facts of the parent product. POS adds a product with only the
  // default variant straight to the cart but opens a variant picker for a
  // multi-variant product, so the planner records which to expect. `null`
  // means the field was not read (the unscoped explorer query) or Shopify
  // reported an inexact count.
  hasOnlyDefaultVariant: boolean | null;
  productVariantCount: number | null;
}

export interface OmsOrder {
  gid: string;
  name: string;
  financialStatus: string | null;
  fulfillmentStatus: string | null;
}

export interface OmsShopifyOrderLine {
  gid: string;
  quantity: number;
  refundableQuantity: number | null;
  unitPrice: { amount: string; currency: string } | null;
  variantGid: string | null;
  variantTitle: string | null;
  sku: string | null;
  productGid: string | null;
  productTitle: string | null;
  // Same product variant facts as OmsVariant, so a cart seeded from an order
  // can plan the POS add-to-cart path too.
  hasOnlyDefaultVariant: boolean | null;
  productVariantCount: number | null;
}

export interface OmsShopifyOrderTransaction {
  id: string;
  kind: string;
  status: string;
  gateway: string | null;
  amount: { amount: string; currency: string } | null;
}

export interface OmsShopifyOrderAgreementSale {
  actionType: string;
  lineType: string;
  quantity: number;
  amount: { amount: string; currency: string } | null;
  lineGid: string | null;
  variantGid: string | null;
}

export interface OmsShopifyOrderAgreement {
  id: string;
  happenedAt: string;
  returnGid: string | null;
  returnName: string | null;
  sales: OmsShopifyOrderAgreementSale[];
}

export interface OmsOrderCustomer {
  gid: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
}

export interface OmsShopifyOrderDetail {
  gid: string;
  legacyResourceId: string | null;
  name: string;
  financialStatus: string | null;
  fulfillmentStatus: string | null;
  total: { amount: string; currency: string } | null;
  paymentGatewayNames: string[];
  customer: OmsOrderCustomer | null;
  transactions: OmsShopifyOrderTransaction[];
  agreements: OmsShopifyOrderAgreement[];
  lines: OmsShopifyOrderLine[];
  nextCursor: string | null;
}

export interface OmsOrderRecord {
  orderId: string;
  orderName: string;
  externalId: string | null;
  statusId: string | null;
  orderDate: string | null;
  grandTotal: string | null;
  currency: string | null;
  itemCount: number;
}

export interface OmsOrderItem {
  orderItemSeqId: string;
  productId: string;
  productName: string | null;
  sku: string | null;
  quantity: number | null;
  shippedQuantity: number | null;
  returnableQuantity: number | null;
  alreadyReturnedQuantity: number | null;
  unitPrice: string | null;
  shipGroupSeqId: string | null;
  facilityId: string | null;
  itemStatusId: string | null;
}

export interface OmsOrderDetail {
  orderId: string;
  orderName: string;
  externalId: string | null;
  statusId: string | null;
  orderDate: string | null;
  grandTotal: string | null;
  currency: string | null;
  items: OmsOrderItem[];
}

export interface OmsLocation {
  gid: string;
  name: string;
}

export interface OmsService {
  connections(): OmsConnectionSummary[];
  addConnection?(draft: OmsConnectionDraft): OmsConnectionSummary;
  health?(connectionId: string): Promise<OmsConnectionSummary>;
  login(connectionId: string, credentials: { username: string; password: string }): Promise<OmsConnectionSummary>;
  logout(connectionId: string): Promise<void>;
  shops(connectionId: string): Promise<OmsShop[]>;
  searchVariants(connectionId: string, connectorShopId: string, input: { search: string; cursor?: string; locationGid?: string }): Promise<Page<OmsVariant>>;
  searchCustomers(connectionId: string, connectorShopId: string, input: { search: string; cursor?: string }): Promise<Page<OmsCustomer>>;
  listPosOrders(connectionId: string, connectorShopId: string, input?: { cursor?: string }): Promise<Page<OmsPosOrder>>;
  searchOrders(connectionId: string, connectorShopId: string, input: { search: string; cursor?: string }): Promise<Page<OmsOrder>>;
  resolveOrder(connectionId: string, connectorShopId: string, input: { gid: string; cursor?: string }): Promise<OmsShopifyOrderDetail>;
  searchOrderRecords(connectionId: string, input: { search?: string; cursor?: string }): Promise<Page<OmsOrderRecord>>;
  getOrderDetail(connectionId: string, orderId: string): Promise<OmsOrderDetail>;
  listLocations(connectionId: string, connectorShopId: string, input: { cursor?: string }): Promise<Page<OmsLocation>>;
}

export class OmsError extends Error {
  constructor(public readonly code: 'configuration' | 'authentication' | 'authorization' | 'rate-limited' | 'transport' | 'graphql' | 'invalid-data', message: string, public readonly status?: number) {
    super(message);
    this.name = 'OmsError';
  }
}

export function canonicalOrigin(input: string): string {
  let url: URL;
  try { url = new URL(input); } catch { throw new OmsError('configuration', 'The OMS origin is not a valid URL.'); }
  if (url.protocol !== 'https:') throw new OmsError('configuration', 'The OMS origin must use HTTPS.');
  if (url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) {
    throw new OmsError('configuration', 'The OMS origin must contain only an HTTPS host.');
  }
  return url.origin;
}

export function boundedCursor(cursor: string | undefined): string | null {
  if (cursor === undefined || cursor === '') return null;
  if (cursor.length > 512) throw new OmsError('invalid-data', 'The pagination cursor is too large.');
  return cursor;
}

export function boundedSearch(search: string | undefined): string {
  const value = search?.trim() ?? '';
  if (value.length > 200) throw new OmsError('invalid-data', 'The search text is too long.');
  return value;
}
