export type Effect = 'read-only' | 'create-order' | 'return' | 'exchange';
export type AssertionMode = 'pos' | 'pos-shopify' | 'pos-shopify-oms';

export type RunState =
  | 'validating'
  | 'preparing'
  | 'running'
  | 'awaiting-approval'
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
  udid: string;
  teamId: string;
  wdaBundleId: string;
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
    'artifact' | 'approval-required' | 'business-effect';
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
  pendingApproval?: PendingApproval;
  businessEffectIntentHash?: string;
}

export interface PendingApproval {
  intentHash: string;
  summary: {
    scenario: string;
    direction: 'collect' | 'even' | 'refund';
    amount: Money;
    lineCount: number;
    sourceOrderGid?: string;
  };
  requestedAt: string;
}

export interface SetupCheck {
  id: string;
  state: 'unchecked' | 'checking' | 'ready' | 'action' | 'blocked' | 'unsupported';
  message: string;
  checkedAt?: string;
  actions: string[];
}

export interface MutationReadiness {
  enabled: boolean;
  policyTargetCount: number;
  reasons: string[];
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
}

export interface OmsVariant { gid: string; productGid: string; title: string; productTitle: string; sku: string | null; }
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
}
export interface OmsShopifyOrderDetail {
  gid: string;
  legacyResourceId: string | null;
  name: string;
  financialStatus: string | null;
  fulfillmentStatus: string | null;
  total: Money | null;
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
