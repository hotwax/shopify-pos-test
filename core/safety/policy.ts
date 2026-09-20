import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { TargetContext } from '../../shared/contracts.ts';

interface EnvironmentPolicyFile {
  schemaVersion: 1;
  targets: TargetContext[];
}

function required(value: unknown, label: string, max = 300): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`The test-store target policy contains an invalid ${label}.`);
  return value;
}

function target(value: unknown): TargetContext {
  if (!value || typeof value !== 'object') throw new Error('The test-store target policy contains an invalid target.');
  const item = value as Record<string, unknown>;
  if (item.testOnly !== true) throw new Error('The test-store target policy requires every target to be explicitly marked test-only.');
  const connectionId = required(item.connectionId, 'connection ID', 80);
  if (!/^[a-zA-Z0-9_-]+$/.test(connectionId)) throw new Error('The test-store target policy contains an invalid connection ID.');
  const omsOrigin = required(item.omsOrigin, 'OMS origin');
  let origin: URL;
  try { origin = new URL(omsOrigin); } catch { throw new Error('The test-store target policy contains an invalid OMS origin.'); }
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.search || origin.hash || (origin.pathname !== '/' && origin.pathname !== '')) throw new Error('The test-store target policy requires an HTTPS origin without credentials or a path.');
  const shopGid = required(item.shopGid, 'Shopify shop GID');
  const locationGid = required(item.locationGid, 'Shopify location GID');
  if (!/^gid:\/\/shopify\/Shop\/[A-Za-z0-9_-]+$/.test(shopGid) || !/^gid:\/\/shopify\/Location\/[A-Za-z0-9_-]+$/.test(locationGid)) throw new Error('The test-store target policy contains an invalid Shopify shop or location GID.');
  const apiVersion = required(item.apiVersion, 'Shopify API version', 30);
  if (!/^\d{4}-\d{2}$/.test(apiVersion)) throw new Error('The test-store target policy contains an invalid Shopify API version.');
  return {
    connectionId,
    omsOrigin: origin.origin,
    userId: required(item.userId, 'OMS user ID'),
    connectorShopId: required(item.connectorShopId, 'connector shop ID'),
    shopGid,
    shopDomain: required(item.shopDomain, 'Shopify shop domain'),
    locationGid,
    apiVersion,
  };
}

export async function loadApprovedTargets(root: string): Promise<TargetContext[]> {
  let raw: string;
  try { raw = await readFile(join(resolve(root), 'config', 'test-environments.json'), 'utf8'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw new Error('The test-store target policy could not be read.');
  }
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error('The test-store target policy is not valid JSON.'); }
  if (!value || typeof value !== 'object' || (value as Record<string, unknown>).schemaVersion !== 1 || !Array.isArray((value as Record<string, unknown>).targets)) throw new Error('The test-store target policy must declare schemaVersion 1 and an array of targets.');
  const targets = (value as { targets: unknown[] }).targets.map(target);
  const identities = new Set<string>();
  for (const item of targets) {
    const identity = JSON.stringify([item.connectionId, item.userId, item.connectorShopId, item.shopGid, item.locationGid, item.apiVersion]);
    if (identities.has(identity)) throw new Error('The test-store target policy contains a duplicate target.');
    identities.add(identity);
  }
  return targets;
}

export type { EnvironmentPolicyFile };
