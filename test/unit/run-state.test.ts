import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyRunEvent, createInitialRunRecord, validateRunEvent } from '../../core/runner/protocol.ts';
import type { RunEvent, RunRequest } from '../../shared/contracts.ts';

const request: RunRequest = {
  scriptId: 'pos.open-first-order',
  deviceProfileId: 'test-ipad',
  parameters: {},
  assertionMode: 'pos',
  expectedRevision: 'revision-a',
};

function event(sequence: number, type: RunEvent['type'], data: Record<string, unknown>, stepId?: string): RunEvent {
  return { protocolVersion: 1, runId: 'run-test', sequence, at: '2026-09-20T00:00:00.000Z', type, data, ...(stepId ? { stepId } : {}) };
}

test('reduces a normal run-state event with strict sequence numbers', () => {
  const initial = createInitialRunRecord('run-test', request, 'revision-a', '2026-09-20T00:00:00.000Z');
  const running = applyRunEvent(initial, event(1, 'run-state', { state: 'running' }));
  assert.equal(running.state, 'running');
  assert.equal(running.lastSequence, 1);
  assert.throws(() => applyRunEvent(running, event(1, 'step-started', {}, 'home')), /sequence/);
});

test('an interrupted attempted action becomes needs-reconciliation and unknown', () => {
  const record = {
    ...createInitialRunRecord('run-test', request, 'revision-a', '2026-09-20T00:00:00.000Z'),
    state: 'running' as const,
    effect: 'attempted' as const,
    lastSequence: 3,
  };
  const next = applyRunEvent(record, event(4, 'run-state', { state: 'interrupted' }));
  assert.equal(next.state, 'needs-reconciliation');
  assert.equal(next.effect, 'unknown');
});

test('does not allow a malformed or oversized event into the reducer', () => {
  assert.throws(() => validateRunEvent({ protocolVersion: 1, runId: 'x', sequence: 1, at: 'not-a-date', type: 'run-state', data: {} }), /event/);
  assert.throws(() => validateRunEvent({ protocolVersion: 1, runId: 'x', sequence: 1, at: '2026-09-20T00:00:00.000Z', type: 'run-state', data: { text: 'x'.repeat(20_000) } }), /event/);
});

test('rejects events for another run and invalid business effects', () => {
  const record = createInitialRunRecord('run-test', request, 'revision-a', '2026-09-20T00:00:00.000Z');
  assert.throws(() => applyRunEvent(record, { ...event(1, 'run-state', { state: 'running' }), runId: 'other' }), /run ID/);
  assert.throws(() => applyRunEvent(record, event(1, 'business-effect', { effect: 'confirmed' })), /business effect/);
});

test('binds business-effect transitions to the approved intent hash', () => {
  const initial = createInitialRunRecord('run-test', request, 'revision-a', '2026-09-20T00:00:00.000Z');
  const hash = 'c'.repeat(64);
  const attempted = applyRunEvent(initial, event(1, 'business-effect', { effect: 'attempted', intentHash: hash }));
  assert.equal(attempted.effect, 'attempted');
  assert.equal(attempted.businessEffectIntentHash, hash);
  assert.throws(() => applyRunEvent(attempted, event(2, 'business-effect', { effect: 'confirmed', intentHash: 'd'.repeat(64) })), /intent hash/);
  const confirmed = applyRunEvent(attempted, event(2, 'business-effect', { effect: 'confirmed', intentHash: hash }));
  assert.equal(confirmed.effect, 'confirmed');
});
