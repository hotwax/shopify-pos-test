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
  request: RunRequest;
  lastSequence: number;
  sourceHash: string;
  createdAt: string;
  resourceIds: Record<string, string[]>;
  assertions: { lane: 'pos' | 'shopify' | 'oms'; status: string; message: string }[];
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
