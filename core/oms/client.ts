import type { Page } from '../../shared/contracts.ts';
import { OmsSessionStore, type FetchLike } from './auth.ts';
import { assertNamedReadQuery, listLocationsQuery, searchOrdersQuery, searchVariantsQuery, type NamedReadOperation } from './queries/documents.ts';
import { OmsError, boundedCursor, boundedSearch, canonicalOrigin, type OmsConnectionConfig, type OmsConnectionSummary, type OmsLocation, type OmsOrder, type OmsService, type OmsShop, type OmsVariant } from './types.ts';

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

function requiredString(value: unknown, label: string): string {
  const result = String(value ?? '').trim();
  if (!result) throw new OmsError('invalid-data', `The OMS returned a shop record without ${label}.`);
  return result;
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

  async login(connectionId: string, credentials: { username: string; password: string }): Promise<OmsConnectionSummary> {
    const connection = this.connection(connectionId);
    const session = await this.sessions.login(connection, credentials);
    return { ...connection, state: 'connected', ...session };
  }

  async logout(connectionId: string): Promise<void> { await this.sessions.logout(this.connection(connectionId)); }

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
      shopGid: String(raw.shopifyShopId ?? raw.shopGid ?? raw.shop?.id ?? ''),
      shopDomain: String(raw.shopDomain ?? raw.domain ?? raw.shop?.domain ?? ''),
      name: String(raw.shopName ?? raw.name ?? raw.shop?.name ?? raw.shopDomain ?? 'Unnamed shop'),
      locationGid: raw.primaryLocationGid ?? raw.locationGid ?? raw.primaryLocation?.id ?? null,
      currency: raw.currency ?? null,
      timezone: raw.timezone ?? null,
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

  async searchVariants(connectionId: string, connectorShopId: string, input: { search: string; cursor?: string }): Promise<Page<OmsVariant>> {
    const data = await this.graphql(connectionId, connectorShopId, 'searchVariants', searchVariantsQuery, { first: 25, after: boundedCursor(input.cursor), query: boundedSearch(input.search) || null });
    return page(data.productVariants, raw => ({ gid: requiredString(raw.id, 'a variant ID'), productGid: requiredString(raw.product?.id, 'a product ID'), title: String(raw.title ?? 'Default'), productTitle: String(raw.product?.title ?? ''), sku: raw.sku == null ? null : String(raw.sku) }));
  }

  async searchOrders(connectionId: string, connectorShopId: string, input: { search: string; cursor?: string }): Promise<Page<OmsOrder>> {
    const data = await this.graphql(connectionId, connectorShopId, 'searchOrders', searchOrdersQuery, { first: 25, after: boundedCursor(input.cursor), query: boundedSearch(input.search) || null });
    return page(data.orders, raw => ({ gid: requiredString(raw.id, 'an order ID'), name: requiredString(raw.name, 'an order name'), financialStatus: raw.displayFinancialStatus == null ? null : String(raw.displayFinancialStatus), fulfillmentStatus: raw.displayFulfillmentStatus == null ? null : String(raw.displayFulfillmentStatus) }));
  }

  async listLocations(connectionId: string, connectorShopId: string, input: { cursor?: string }): Promise<Page<OmsLocation>> {
    const data = await this.graphql(connectionId, connectorShopId, 'listLocations', listLocationsQuery, { first: 25, after: boundedCursor(input.cursor) });
    return page(data.locations, raw => ({ gid: requiredString(raw.id, 'a location ID'), name: requiredString(raw.name, 'a location name') }));
  }
}
