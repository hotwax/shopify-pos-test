export type Effect = 'read-only' | 'create-order' | 'return' | 'exchange';
export type AssertionMode = 'pos' | 'pos-shopify' | 'pos-shopify-oms';

export type RunState =
  | 'validating'
  | 'preparing'
  | 'running'
  | 'verifying'
  | 'passed'
  | 'failed'
  | 'blocked'
  | 'cancelled'
  | 'interrupted'
  | 'needs-reconciliation';

export type BusinessEffect = 'not-started' | 'attempted' | 'confirmed' | 'unknown';

export interface Money { amount: string; currency: string }

export interface ScriptDefinition {
  schemaVersion: 1;
  id: string;
  name: string;
  description: string;
  domain: string;
  scenario: string;
  scenarioVersion: number;
  parameters: Record<string, unknown>;
  assertionMode: AssertionMode;
  tags: string[];
  /** Derived from the trusted scenario registry; never accepted from JSON. */
  effect?: Effect;
}

export interface ScenarioDescriptor {
  id: string;
  version: number;
  effect: Effect;
  entry: string;
  parameterSchema: Record<string, unknown>;
  requiredCapabilities: string[];
  supportedAssertionModes: AssertionMode[];
}

export interface DeviceProfile {
  id: string;
  /** Friendly label shown to operators; id remains an internal stable key. */
  name?: string;
  udid: string;
  model?: string;
  os?: string;
  teamId: string;
  wdaBundleId: string;
}

export interface SetupDefaults {
  developmentTeamIds: string[];
  recommendedWdaBundleId: string;
}

export interface TargetContext {
  connectionId: string;
  omsOrigin: string;
  userId: string;
  connectorShopId: string;
  shopGid: string;
  shopDomain: string;
  locationGid: string;
  apiVersion: string;
}

export interface RunRequest {
  scriptId: string;
  deviceProfileId: string;
  parameters: Record<string, unknown>;
  assertionMode: AssertionMode;
  expectedRevision: string;
  context?: TargetContext;
}

export interface RunEvent {
  protocolVersion: 1;
  runId: string;
  sequence: number;
  at: string;
  type: 'run-state' | 'step-started' | 'step-finished' | 'assertion' |
    'artifact' | 'business-effect';
  stepId?: string;
  data: Record<string, unknown>;
}

export interface RunRecord {
  id: string;
  state: RunState;
  effect: BusinessEffect;
  statusMessage?: string;
  request: RunRequest;
  lastSequence: number;
  sourceHash: string;
  createdAt: string;
  resourceIds: Record<string, string[]>;
  assertions: { lane: 'pos' | 'shopify' | 'oms'; status: string; message: string }[];
  businessEffectIntentHash?: string;
}

export interface SetupCheck {
  id: string;
  state: 'unchecked' | 'checking' | 'ready' | 'action' | 'blocked' | 'unsupported';
  message: string;
  checkedAt?: string;
  actions: string[];
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface OmsConnectionSummary {
  id: string;
  label: string;
  origin: string;
  state: 'configured' | 'connected' | 'expired' | 'error';
  userId?: string;
  username?: string;
  userFullName?: string;
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

export interface SavedOmsConnection {
  id: string;
  instanceName: string;
  username: string;
  label: string;
  autoConnect: boolean;
  updatedAt: string;
}

export interface OmsPosOrderItem { title: string; quantity: number }

export interface OmsPosOrder {
  gid: string;
  name: string;
  createdAt: string | null;
  financialStatus: string | null;
  fulfillmentStatus: string | null;
  customerName: string | null;
  total: Money | null;
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
export interface OmsOrder { gid: string; name: string; financialStatus: string | null; fulfillmentStatus: string | null; }
export interface OmsShopifyOrderLine {
  gid: string;
  quantity: number;
  refundableQuantity: number | null;
  unitPrice: Money | null;
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
  amount: Money | null;
}
export interface OmsShopifyOrderAgreementSale {
  actionType: string;
  lineType: string;
  quantity: number;
  amount: Money | null;
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
  total: Money | null;
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
export interface OmsLocation { gid: string; name: string; }
