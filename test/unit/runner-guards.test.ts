import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { MutationReadiness, RunRequest, TargetContext } from '../../shared/contracts.ts';
import { assertScenarioCanRun } from '../../core/runner/guards.ts';

const context: TargetContext = {
  connectionId: 'local', omsOrigin: 'https://oms.example', userId: 'user-1', connectorShopId: 'shop-1',
  shopGid: 'gid://shopify/Shop/1', shopDomain: 'test.myshopify.com', locationGid: 'gid://shopify/Location/1', apiVersion: '2026-01',
};
const request: RunRequest = { scriptId: 'pos.create-cash-order', deviceProfileId: 'test-ipad', parameters: {}, assertionMode: 'pos-shopify', expectedRevision: 'revision-1', context };
const blocked: MutationReadiness = { enabled: false, policyTargetCount: 1, reasons: ['native POS context is unverified'] };

test('allows a read-only scenario without mutation readiness', () => {
  assert.doesNotThrow(() => assertScenarioCanRun('read-only', { ...request, context: undefined }, blocked));
});

test('blocks a mutating scenario without an exact frozen target context', () => {
  assert.throws(() => assertScenarioCanRun('create-order', { ...request, context: undefined }, blocked), /frozen target context/i);
});

test('blocks a mutating scenario until every readiness gate is enabled', () => {
  assert.throws(() => assertScenarioCanRun('return', request, blocked), /native POS context is unverified/i);
});
