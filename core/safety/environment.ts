import type { TargetContext } from '../../shared/contracts.ts';

const contextKeys = ['connectionId', 'omsOrigin', 'userId', 'connectorShopId', 'shopGid', 'shopDomain', 'locationGid', 'apiVersion'];
const shopGid = /^gid:\/\/shopify\/Shop\/[A-Za-z0-9_-]+$/;
const locationGid = /^gid:\/\/shopify\/Location\/[A-Za-z0-9_-]+$/;

function bounded(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum && !/[\0\r\n]/.test(value) && value.trim() === value;
}

/** Validates a frozen run target without contacting an external system. */
export function isValidTargetContext(value: unknown): value is TargetContext {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const context = value as Partial<TargetContext>;
  if (Object.keys(context).sort().join('|') !== contextKeys.slice().sort().join('|')) return false;
  if (!bounded(context.connectionId, 80) || !/^[A-Za-z0-9_-]+$/.test(context.connectionId)) return false;
  if (!bounded(context.omsOrigin, 256)) return false;
  try {
    const origin = new URL(context.omsOrigin);
    if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash || origin.origin !== context.omsOrigin) return false;
  } catch { return false; }
  return bounded(context.userId, 160) && bounded(context.connectorShopId, 160) &&
    bounded(context.shopGid, 160) && shopGid.test(context.shopGid) &&
    bounded(context.shopDomain, 253) && !context.shopDomain.includes('/') &&
    bounded(context.locationGid, 160) && locationGid.test(context.locationGid) &&
    bounded(context.apiVersion, 32) && /^\d{4}-\d{2}$/.test(context.apiVersion);
}

export interface PosContextEvidence {
  udid: string;
  shopGid: string;
  locationGid: string;
  observedAt: string;
  method: string;
  evidenceHash: string;
  online: boolean;
}

function same(left: string, right: string): boolean { return left.length > 0 && left === right; }

export function assertAllowedTarget(context: TargetContext, evidence: PosContextEvidence, approvedTargets: TargetContext[], now = Date.now(), maxAgeMs = 5 * 60 * 1000): void {
  if (!evidence.online) throw new Error('POS is offline; the target context is not safe for a transaction.');
  const observed = Date.parse(evidence.observedAt);
  if (!Number.isFinite(observed) || now - observed < 0 || now - observed > maxAgeMs) throw new Error('POS context evidence is missing or stale.');
  if (!evidence.method || !evidence.evidenceHash) throw new Error('POS context evidence is incomplete.');
  if (!same(context.shopGid, evidence.shopGid) || !same(context.locationGid, evidence.locationGid)) throw new Error('The POS shop or location does not match the selected target.');
  if (!approvedTargets.some(target => target.connectionId === context.connectionId && target.omsOrigin === context.omsOrigin && target.userId === context.userId && target.connectorShopId === context.connectorShopId && target.shopGid === context.shopGid && target.shopDomain === context.shopDomain && target.locationGid === context.locationGid && target.apiVersion === context.apiVersion)) throw new Error('The selected target is not on the approved test-store allowlist.');
  if (!evidence.udid) throw new Error('The POS device identity is missing.');
}
