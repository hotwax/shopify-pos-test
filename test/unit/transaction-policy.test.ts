import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TargetContext } from '../../shared/contracts.ts';
import type { TransactionIntent } from '../../shared/transaction.ts';
import { assertAllowedTarget, type PosContextEvidence } from '../../core/safety/environment.ts';
import { assertAllowedIntent, hashIntent } from '../../core/safety/intent.ts';

const context: TargetContext = {
  connectionId: 'local', omsOrigin: 'https://oms.example', userId: 'user-1', connectorShopId: 'shop-1', shopGid: 'gid://shopify/Shop/1', shopDomain: 'test.myshopify.com', locationGid: 'gid://shopify/Location/1', apiVersion: '2026-01',
};
const evidence: PosContextEvidence = { udid: 'device-1', shopGid: context.shopGid, locationGid: context.locationGid, observedAt: new Date('2026-09-20T12:00:00Z').toISOString(), method: 'verified-native-context', evidenceHash: 'evidence-1', online: true };
const intent: TransactionIntent = { scenario: 'create-cash-order', sourceHash: 'source-1', udid: 'device-1', context, purchaseLines: [{ variantGid: 'gid://shopify/ProductVariant/1', quantity: 1 }], returnLines: [], tender: 'cash', expectedDirection: 'collect', maximumAbsoluteAmount: { amount: '20.00', currency: 'USD' } };

test('accepts only a fresh, exact approved POS context', () => {
  assert.doesNotThrow(() => assertAllowedTarget(context, evidence, [context], Date.parse('2026-09-20T12:01:00Z')));
  assert.throws(() => assertAllowedTarget(context, { ...evidence, shopGid: 'gid://shopify/Shop/other' }, [context], Date.parse('2026-09-20T12:01:00Z')));
  assert.throws(() => assertAllowedTarget(context, { ...evidence, online: false }, [context], Date.parse('2026-09-20T12:01:00Z')));
  assert.throws(() => assertAllowedTarget(context, evidence, [], Date.parse('2026-09-20T12:01:00Z')));
  assert.throws(() => assertAllowedTarget(context, evidence, [context], Date.parse('2026-09-20T12:06:00Z')));
});

test('freezes an exact cash intent and rejects wrong device, tender or empty lines', () => {
  assert.doesNotThrow(() => assertAllowedIntent(intent, evidence, [context], Date.parse('2026-09-20T12:01:00Z')));
  assert.match(hashIntent(intent), /^[a-f0-9]{64}$/);
  assert.notEqual(hashIntent(intent), hashIntent({ ...intent, maximumAbsoluteAmount: { amount: '21.00', currency: 'USD' } }));
  assert.throws(() => assertAllowedIntent({ ...intent, udid: 'other-device' }, evidence, [context], Date.parse('2026-09-20T12:01:00Z')));
  assert.throws(() => assertAllowedIntent({ ...intent, tender: 'cash' as 'cash', purchaseLines: [], returnLines: [] }, evidence, [context], Date.parse('2026-09-20T12:01:00Z')));
});
