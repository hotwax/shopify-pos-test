import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { OmsShopifyOrderDetail } from '../../shared/contracts.ts';

export interface ObservedOrderBridgeInput {
  observedName: string;
  runMarker?: string;
}

export interface ObservedOrderBridgeRequest {
  id: string;
  runId: string;
  operation: 'resolveObservedOrder';
  observedName: string;
  runMarker?: string;
  requestedAt: string;
}

export interface ShopifyOrderBridgeInput {
  orderGid: string;
}

export interface ShopifyOrderBridgeRequest {
  id: string;
  runId: string;
  operation: 'readShopifyOrder';
  orderGid: string;
  requestedAt: string;
}

export interface RecentOrderBridgeInput {
  /** ISO time captured just before the committing tap on POS. */
  notBefore: string;
  totalAmount: string;
  totalCurrency: string;
  lineCount: number;
}

export interface RecentOrderBridgeRequest {
  id: string;
  runId: string;
  operation: 'resolveRecentOrder';
  notBefore: string;
  totalAmount: string;
  totalCurrency: string;
  lineCount: number;
  requestedAt: string;
}

export type BridgeRequest = ObservedOrderBridgeRequest | ShopifyOrderBridgeRequest | RecentOrderBridgeRequest;

export interface ObservedOrderBridgeResponse {
  id: string;
  runId: string;
  operation: 'resolveObservedOrder';
  ok: boolean;
  orderGid?: string;
  orderName?: string;
  error?: string;
  respondedAt: string;
}

export interface ShopifyOrderBridgeResponse {
  id: string;
  runId: string;
  operation: 'readShopifyOrder';
  ok: boolean;
  order?: OmsShopifyOrderDetail;
  error?: string;
  respondedAt: string;
}

export interface RecentOrderBridgeResponse {
  id: string;
  runId: string;
  operation: 'resolveRecentOrder';
  ok: boolean;
  orderGid?: string;
  orderName?: string;
  error?: string;
  respondedAt: string;
}

export type BridgeResponse = ObservedOrderBridgeResponse | ShopifyOrderBridgeResponse | RecentOrderBridgeResponse;

export type BridgeResponseData =
  | { ok: true; orderGid: string; orderName: string }
  | { ok: true; order: OmsShopifyOrderDetail }
  | { ok: false; error: string };

function validRunId(runId: string): void {
  if (!/^[a-zA-Z0-9_-]{1,120}$/.test(runId)) throw new Error('Invalid bridge request identity.');
}

function validRequestId(id: string): void {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid bridge request identity.');
}

function exactOrderGid(value: unknown): value is string {
  return typeof value === 'string' && /^gid:\/\/shopify\/Order\/[A-Za-z0-9_-]+$/.test(value);
}

function runDirectory(root: string, runId: string): string {
  validRunId(runId);
  return join(resolve(root), '.runtime', 'runs', runId, 'bridge');
}

function requestFile(root: string, request: BridgeRequest): string {
  return join(runDirectory(root, request.runId), `${request.id}.request.json`);
}

function responseFile(root: string, request: BridgeRequest): string {
  return join(runDirectory(root, request.runId), `${request.id}.response.json`);
}

function validateObservedInput(input: ObservedOrderBridgeInput): void {
  const observedName = input.observedName.trim();
  if (!observedName || observedName.length > 120) throw new Error('The observed POS order reference is empty or too long.');
  if (input.runMarker !== undefined && (input.runMarker.length > 200 || /[\0\r\n]/.test(input.runMarker))) throw new Error('The observed POS run marker is invalid.');
}

function validateShopifyOrderInput(input: ShopifyOrderBridgeInput): void {
  if (!exactOrderGid(input.orderGid)) throw new Error('The Shopify order identity is invalid.');
}

function validateRecentInput(input: RecentOrderBridgeInput): void {
  if (typeof input.notBefore !== 'string' || input.notBefore.length > 40 || !Number.isFinite(Date.parse(input.notBefore))) throw new Error('The recent-order commit time is invalid.');
  if (typeof input.totalAmount !== 'string' || !/^\d+(?:\.\d{1,4})?$/.test(input.totalAmount)) throw new Error('The recent-order total amount is invalid.');
  if (typeof input.totalCurrency !== 'string' || !/^[A-Z]{3}$/.test(input.totalCurrency)) throw new Error('The recent-order total currency is invalid.');
  if (!Number.isSafeInteger(input.lineCount) || input.lineCount < 1 || input.lineCount > 1000) throw new Error('The recent-order line count is invalid.');
}

async function writeAtomic(file: string, value: unknown): Promise<void> {
  await mkdir(resolve(file, '..'), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporary, JSON.stringify(value), { flag: 'wx' });
  await rename(temporary, file);
}

function boundedText(value: unknown, maximum: number): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || /[\0\r\n]/.test(value)) return null;
  return value.trim();
}

function boundedMoney(value: unknown): { amount: string; currency: string } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const amount = boundedText(item.amount, 40);
  const currency = boundedText(item.currency, 3);
  if (!amount || !currency || !/^-?(?:0|[1-9]\d*)(?:\.\d{1,4})?$/.test(amount) || !/^[A-Z]{3}$/.test(currency)) return null;
  return { amount, currency };
}

function boundedGid(value: unknown, pattern: RegExp): string | null {
  return typeof value === 'string' && pattern.test(value) ? value : null;
}

function boundedOrder(value: unknown): OmsShopifyOrderDetail | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Record<string, any>;
  const gid = boundedGid(item.gid, /^gid:\/\/shopify\/Order\/[A-Za-z0-9_-]+$/);
  const name = boundedText(item.name, 120);
  if (!gid || !name || item.nextCursor !== null) return null;
  const paymentGatewayNames = Array.isArray(item.paymentGatewayNames) && item.paymentGatewayNames.length <= 20
    ? item.paymentGatewayNames.map((value: unknown) => boundedText(value, 80)).filter((value: string | null): value is string => Boolean(value))
    : [];
  if (!Array.isArray(item.paymentGatewayNames) || paymentGatewayNames.length !== item.paymentGatewayNames.length) return null;
  if (!Array.isArray(item.lines) || item.lines.length > 500) return null;
  const lines = item.lines.map((raw: unknown) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const line = raw as Record<string, any>;
    const lineGid = boundedGid(line.gid, /^gid:\/\/shopify\/LineItem\/[A-Za-z0-9_-]+$/);
    const quantity = line.quantity;
    const refundableQuantity = line.refundableQuantity;
    if (!lineGid || !Number.isSafeInteger(quantity) || quantity < 0 ||
        (refundableQuantity !== null && (!Number.isSafeInteger(refundableQuantity) || refundableQuantity < 0 || refundableQuantity > quantity))) return null;
    const variantGid = line.variantGid === null ? null : boundedGid(line.variantGid, /^gid:\/\/shopify\/ProductVariant\/[A-Za-z0-9_-]+$/);
    const productGid = line.productGid === null ? null : boundedGid(line.productGid, /^gid:\/\/shopify\/Product\/[A-Za-z0-9_-]+$/);
    if (line.variantGid !== null && !variantGid || line.productGid !== null && !productGid) return null;
    return {
      gid: lineGid,
      quantity,
      refundableQuantity,
      unitPrice: line.unitPrice === null ? null : boundedMoney(line.unitPrice),
      variantGid,
      variantTitle: line.variantTitle === null ? null : boundedText(line.variantTitle, 200),
      sku: line.sku === null ? null : boundedText(line.sku, 120),
      productGid,
      productTitle: line.productTitle === null ? null : boundedText(line.productTitle, 200),
      // Variant facts only ever narrow to a boolean or a small non-negative
      // integer; anything else crosses as "not read".
      hasOnlyDefaultVariant: typeof line.hasOnlyDefaultVariant === 'boolean' ? line.hasOnlyDefaultVariant : null,
      productVariantCount: Number.isSafeInteger(line.productVariantCount) && line.productVariantCount >= 0 && line.productVariantCount <= 100_000 ? line.productVariantCount : null,
    };
  });
  if (lines.some(line => line === null)) return null;
  const validLines = lines.filter((line): line is NonNullable<typeof line> => line !== null);
  const transactions = Array.isArray(item.transactions) && item.transactions.length <= 100
    ? item.transactions.map((raw: unknown) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
      const transaction = raw as Record<string, any>;
      const id = boundedGid(transaction.id, /^gid:\/\/shopify\/OrderTransaction\/[A-Za-z0-9_-]+$/);
      const kind = boundedText(transaction.kind, 80);
      const status = boundedText(transaction.status, 80);
      const gateway = transaction.gateway === null ? null : boundedText(transaction.gateway, 120);
      if (!id || !kind || !status || transaction.gateway !== null && !gateway) return null;
      return { id, kind, status, gateway, amount: transaction.amount === null ? null : boundedMoney(transaction.amount) };
    }).filter((transaction): transaction is NonNullable<typeof transaction> => transaction !== null) : [];
  if (!Array.isArray(item.transactions) || transactions.length !== item.transactions.length) return null;
  const agreements = Array.isArray(item.agreements) && item.agreements.length <= 25
    ? item.agreements.map((raw: unknown) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
      const agreement = raw as Record<string, any>;
      const id = boundedGid(agreement.id, /^gid:\/\/shopify\/SalesAgreement\/[A-Za-z0-9_-]+$/);
      const happenedAt = boundedText(agreement.happenedAt, 40);
      const returnGid = agreement.returnGid === null ? null : boundedGid(agreement.returnGid, /^gid:\/\/shopify\/Return\/[A-Za-z0-9_-]+$/);
      const returnName = agreement.returnName === null ? null : boundedText(agreement.returnName, 120);
      const sales = Array.isArray(agreement.sales) && agreement.sales.length <= 100
        ? agreement.sales.map((sale: unknown) => {
          if (!sale || typeof sale !== 'object' || Array.isArray(sale)) return null;
          const itemSale = sale as Record<string, any>;
          const actionType = boundedText(itemSale.actionType, 80);
          const lineType = boundedText(itemSale.lineType, 80);
          const lineGid = itemSale.lineGid === null ? null : boundedGid(itemSale.lineGid, /^gid:\/\/shopify\/LineItem\/[A-Za-z0-9_-]+$/);
          const variantGid = itemSale.variantGid === null ? null : boundedGid(itemSale.variantGid, /^gid:\/\/shopify\/ProductVariant\/[A-Za-z0-9_-]+$/);
          if (!actionType || !lineType || !Number.isSafeInteger(itemSale.quantity) || itemSale.quantity < -100_000 || itemSale.quantity > 100_000 || itemSale.lineGid !== null && !lineGid || itemSale.variantGid !== null && !variantGid) return null;
          return { actionType, lineType, quantity: itemSale.quantity, amount: itemSale.amount === null ? null : boundedMoney(itemSale.amount), lineGid, variantGid };
        }).filter((sale): sale is NonNullable<typeof sale> => sale !== null) : [];
      if (!id || !happenedAt || !Number.isFinite(Date.parse(happenedAt)) || agreement.returnGid !== null && !returnGid || agreement.returnName !== null && !returnName || !Array.isArray(agreement.sales) || sales.length !== agreement.sales.length) return null;
      return { id, happenedAt, returnGid, returnName, sales };
    }).filter((agreement): agreement is NonNullable<typeof agreement> => agreement !== null) : [];
  if (!Array.isArray(item.agreements) || agreements.length !== item.agreements.length) return null;

  // Return, refund and fulfillment evidence crosses to the worker so the
  // native spec can prove restock type, return reason and refund tender
  // without its own Shopify credentials. Each collection is rebuilt field by
  // field and the whole order is rejected if any member fails to validate,
  // rather than silently arriving short.
  const lineGidOrNull = (value: unknown) => value === null || value === undefined ? null : boundedGid(value, /^gid:\/\/shopify\/LineItem\/[A-Za-z0-9_-]+$/);
  const boundedCollection = <T>(source: unknown, cap: number, map: (raw: Record<string, any>) => T | null): T[] | null => {
    if (source === undefined) return [];
    if (!Array.isArray(source) || source.length > cap) return null;
    const mapped = source.map(raw => (!raw || typeof raw !== 'object' || Array.isArray(raw)) ? null : map(raw as Record<string, any>));
    return mapped.some(entry => entry === null) ? null : mapped as T[];
  };

  const returns = boundedCollection(item.returns, 20, raw => {
    const id = boundedGid(raw.gid, /^gid:\/\/shopify\/Return\/[A-Za-z0-9_-]+$/);
    if (!id) return null;
    const lines = boundedCollection(raw.lines, 100, line => {
      const lineId = boundedText(line.gid, 120);
      if (!lineId || !Number.isSafeInteger(line.quantity) || line.quantity < 0 || line.quantity > 100_000) return null;
      if (line.lineGid !== null && line.lineGid !== undefined && !lineGidOrNull(line.lineGid)) return null;
      return {
        gid: lineId,
        quantity: line.quantity as number,
        reason: line.reason === null || line.reason === undefined ? null : boundedText(line.reason, 80),
        reasonNote: line.reasonNote === null || line.reasonNote === undefined ? null : boundedText(line.reasonNote, 500),
        customerNote: line.customerNote === null || line.customerNote === undefined ? null : boundedText(line.customerNote, 500),
        lineGid: lineGidOrNull(line.lineGid),
      };
    });
    if (!lines) return null;
    return { gid: id, name: raw.name === null || raw.name === undefined ? null : boundedText(raw.name, 120), status: raw.status === null || raw.status === undefined ? null : boundedText(raw.status, 80), totalQuantity: Number.isSafeInteger(raw.totalQuantity) ? raw.totalQuantity as number : null, lines };
  });

  const refunds = boundedCollection(item.refunds, 20, raw => {
    const id = boundedGid(raw.gid, /^gid:\/\/shopify\/Refund\/[A-Za-z0-9_-]+$/);
    if (!id) return null;
    const lines = boundedCollection(raw.lines, 100, line => {
      if (!Number.isSafeInteger(line.quantity) || line.quantity < 0 || line.quantity > 100_000) return null;
      if (line.lineGid !== null && line.lineGid !== undefined && !lineGidOrNull(line.lineGid)) return null;
      return { quantity: line.quantity as number, restockType: line.restockType === null || line.restockType === undefined ? null : boundedText(line.restockType, 40), lineGid: lineGidOrNull(line.lineGid) };
    });
    const refundTransactions = boundedCollection(raw.transactions, 50, transaction => {
      const transactionId = boundedGid(transaction.id, /^gid:\/\/shopify\/OrderTransaction\/[A-Za-z0-9_-]+$/);
      const kind = boundedText(transaction.kind, 80);
      const status = boundedText(transaction.status, 80);
      const gateway = transaction.gateway === null || transaction.gateway === undefined ? null : boundedText(transaction.gateway, 120);
      if (!transactionId || !kind || !status) return null;
      return { id: transactionId, kind, status, gateway, amount: transaction.amount === null || transaction.amount === undefined ? null : boundedMoney(transaction.amount) };
    });
    if (!lines || !refundTransactions) return null;
    return { gid: id, createdAt: raw.createdAt === null || raw.createdAt === undefined ? null : boundedText(raw.createdAt, 40), total: raw.total === null || raw.total === undefined ? null : boundedMoney(raw.total), lines, transactions: refundTransactions };
  });

  const fulfillments = boundedCollection(item.fulfillments, 25, raw => {
    const id = boundedGid(raw.gid, /^gid:\/\/shopify\/Fulfillment\/[A-Za-z0-9_-]+$/);
    if (!id) return null;
    const lines = boundedCollection(raw.lines, 100, line => {
      const lineGid = lineGidOrNull(line.lineGid);
      if (!lineGid || !Number.isSafeInteger(line.quantity) || line.quantity < 0 || line.quantity > 100_000) return null;
      return { lineGid, quantity: line.quantity as number };
    });
    if (!lines) return null;
    return { gid: id, status: raw.status === null || raw.status === undefined ? null : boundedText(raw.status, 80), lines };
  });

  if (!returns || !refunds || !fulfillments) return null;
  return {
    gid,
    legacyResourceId: boundedText(item.legacyResourceId, 120),
    name,
    financialStatus: boundedText(item.financialStatus, 80),
    fulfillmentStatus: boundedText(item.fulfillmentStatus, 80),
    // The customer is planning metadata for the browser only. The native worker
    // has no use for it, so no customer PII crosses this boundary.
    customer: null,
    total: item.total === null ? null : boundedMoney(item.total),
    paymentGatewayNames,
    transactions,
    agreements,
    returnStatus: item.returnStatus === null || item.returnStatus === undefined ? null : boundedText(item.returnStatus, 80),
    returns,
    refunds,
    fulfillments,
    lines: validLines,
    nextCursor: null,
  };
}

function parseRequest(value: unknown): BridgeRequest | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const item = value as Record<string, unknown>;
  if (typeof item.id !== 'string' || typeof item.runId !== 'string' || typeof item.operation !== 'string' || typeof item.requestedAt !== 'string') return undefined;
  try { validRequestId(item.id); validRunId(item.runId); }
  catch { return undefined; }
  if (!Number.isFinite(Date.parse(item.requestedAt))) return undefined;
  if (item.operation === 'resolveObservedOrder' && typeof item.observedName === 'string') {
    try { validateObservedInput({ observedName: item.observedName, ...(item.runMarker === undefined ? {} : { runMarker: String(item.runMarker) }) }); }
    catch { return undefined; }
    return { id: item.id, runId: item.runId, operation: 'resolveObservedOrder', observedName: item.observedName.trim(), ...(item.runMarker === undefined ? {} : { runMarker: String(item.runMarker) }), requestedAt: item.requestedAt };
  }
  if (item.operation === 'readShopifyOrder' && typeof item.orderGid === 'string') {
    try { validateShopifyOrderInput({ orderGid: item.orderGid }); }
    catch { return undefined; }
    return { id: item.id, runId: item.runId, operation: 'readShopifyOrder', orderGid: item.orderGid, requestedAt: item.requestedAt };
  }
  if (item.operation === 'resolveRecentOrder') {
    const input = { notBefore: item.notBefore, totalAmount: item.totalAmount, totalCurrency: item.totalCurrency, lineCount: item.lineCount } as RecentOrderBridgeInput;
    try { validateRecentInput(input); }
    catch { return undefined; }
    return { id: item.id, runId: item.runId, operation: 'resolveRecentOrder', ...input, requestedAt: item.requestedAt };
  }
  return undefined;
}

function safeError(error: string): string {
  return error.replace(/password|token|secret|authorization/gi, '[redacted]').slice(0, 500);
}

function parseResponse(value: unknown, request: BridgeRequest): BridgeResponse | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const item = value as Record<string, unknown>;
  if (item.id !== request.id || item.runId !== request.runId || item.operation !== request.operation || typeof item.ok !== 'boolean' || typeof item.respondedAt !== 'string' || !Number.isFinite(Date.parse(item.respondedAt))) return undefined;
  if (item.ok) {
    if (request.operation === 'resolveObservedOrder' || request.operation === 'resolveRecentOrder') {
      if (!exactOrderGid(item.orderGid) || typeof item.orderName !== 'string' || !item.orderName.trim() || item.orderName.length > 120) return undefined;
      const located = { id: request.id, runId: request.runId, ok: true as const, orderGid: item.orderGid, orderName: item.orderName.trim(), respondedAt: item.respondedAt };
      return request.operation === 'resolveObservedOrder' ? { ...located, operation: 'resolveObservedOrder' } : { ...located, operation: 'resolveRecentOrder' };
    }
    const order = boundedOrder(item.order);
    if (!order || order.gid !== request.orderGid) return undefined;
    return { id: request.id, runId: request.runId, operation: request.operation, ok: true, order, respondedAt: item.respondedAt };
  }
  if (typeof item.error !== 'string' || !item.error.trim() || item.error.length > 500) return undefined;
  return { id: request.id, runId: request.runId, operation: request.operation, ok: false, error: safeError(item.error), respondedAt: item.respondedAt };
}

export async function createObservedOrderRequest(root: string, runId: string, input: ObservedOrderBridgeInput): Promise<ObservedOrderBridgeRequest> {
  validRunId(runId);
  validateObservedInput(input);
  const request: ObservedOrderBridgeRequest = { id: randomUUID(), runId, operation: 'resolveObservedOrder', observedName: input.observedName.trim(), ...(input.runMarker === undefined ? {} : { runMarker: input.runMarker }), requestedAt: new Date().toISOString() };
  const file = requestFile(root, request);
  await mkdir(resolve(file, '..'), { recursive: true });
  await writeFile(file, JSON.stringify(request), { flag: 'wx' });
  return request;
}

export async function createShopifyOrderRequest(root: string, runId: string, input: ShopifyOrderBridgeInput): Promise<ShopifyOrderBridgeRequest> {
  validRunId(runId);
  validateShopifyOrderInput(input);
  const request: ShopifyOrderBridgeRequest = { id: randomUUID(), runId, operation: 'readShopifyOrder', orderGid: input.orderGid, requestedAt: new Date().toISOString() };
  const file = requestFile(root, request);
  await mkdir(resolve(file, '..'), { recursive: true });
  await writeFile(file, JSON.stringify(request), { flag: 'wx' });
  return request;
}

export async function createRecentOrderRequest(root: string, runId: string, input: RecentOrderBridgeInput): Promise<RecentOrderBridgeRequest> {
  validRunId(runId);
  validateRecentInput(input);
  const request: RecentOrderBridgeRequest = { id: randomUUID(), runId, operation: 'resolveRecentOrder', notBefore: input.notBefore, totalAmount: input.totalAmount, totalCurrency: input.totalCurrency, lineCount: input.lineCount, requestedAt: new Date().toISOString() };
  const file = requestFile(root, request);
  await mkdir(resolve(file, '..'), { recursive: true });
  await writeFile(file, JSON.stringify(request), { flag: 'wx' });
  return request;
}

export async function readBridgeRequests(root: string, runId: string): Promise<BridgeRequest[]> {
  const directory = runDirectory(root, runId);
  let entries: string[];
  try { entries = await readdir(directory); } catch { return []; }
  const requests: BridgeRequest[] = [];
  for (const entry of entries.filter(name => name.endsWith('.request.json')).sort()) {
    try {
      const parsed = parseRequest(JSON.parse(await readFile(join(directory, entry), 'utf8')));
      if (parsed) requests.push(parsed);
    } catch { /* malformed worker data remains unavailable and cannot authorize a read */ }
  }
  return requests;
}

export async function clearBridgeRequest(root: string, request: BridgeRequest): Promise<void> {
  await unlink(requestFile(root, request)).catch(() => undefined);
}

export async function writeBridgeResponse(root: string, request: BridgeRequest, result: BridgeResponseData): Promise<void> {
  const response = { ...result, id: request.id, runId: request.runId, operation: request.operation, respondedAt: new Date().toISOString() } as BridgeResponse;
  if (!parseResponse(response, request)) throw new Error('Invalid bridge response.');
  await writeAtomic(responseFile(root, request), response);
}

export async function consumeBridgeResponse(root: string, request: BridgeRequest): Promise<BridgeResponse | undefined> {
  try {
    const parsed = parseResponse(JSON.parse(await readFile(responseFile(root, request), 'utf8')), request);
    if (!parsed) return undefined;
    await unlink(responseFile(root, request));
    return parsed;
  } catch { return undefined; }
}
