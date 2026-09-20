import type { TargetContext } from '../../shared/contracts.ts';

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
