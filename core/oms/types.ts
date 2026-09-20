import type { Page } from '../../shared/contracts.ts';

export interface OmsConnectionConfig {
  id: string;
  label: string;
  origin: string;
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
}

export interface OmsVariant {
  gid: string;
  productGid: string;
  title: string;
  productTitle: string;
  sku: string | null;
}

export interface OmsOrder {
  gid: string;
  name: string;
  financialStatus: string | null;
  fulfillmentStatus: string | null;
}

export interface OmsLocation {
  gid: string;
  name: string;
}

export interface OmsService {
  connections(): OmsConnectionSummary[];
  login(connectionId: string, credentials: { username: string; password: string }): Promise<OmsConnectionSummary>;
  logout(connectionId: string): Promise<void>;
  shops(connectionId: string): Promise<OmsShop[]>;
  searchVariants(connectionId: string, connectorShopId: string, input: { search: string; cursor?: string }): Promise<Page<OmsVariant>>;
  searchOrders(connectionId: string, connectorShopId: string, input: { search: string; cursor?: string }): Promise<Page<OmsOrder>>;
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
