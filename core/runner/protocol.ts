import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js';
import * as formatsModule from 'ajv-formats';
import schema from '../../shared/run-event.schema.json' with { type: 'json' };
import type { RunEvent, RunRecord, RunRequest } from '../../shared/contracts.ts';

const addFormats = (formatsModule as unknown as { default: (instance: object) => object }).default;
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validateSchema = ajv.compile(schema);
const validStates = new Set<RunRecord['state']>([
  'validating', 'preparing', 'running', 'verifying',
  'passed', 'failed', 'blocked', 'cancelled', 'interrupted', 'needs-reconciliation',
]);
const validEffects = new Set<RunRecord['effect']>(['not-started', 'attempted', 'confirmed', 'unknown']);

function errors(validate: ValidateFunction): string {
  return (validate.errors ?? []).map(error => `${error.instancePath || '/'} ${error.message ?? 'invalid'}`).join('; ');
}

function payloadIsBounded(value: unknown): boolean {
  try {
    return JSON.stringify(value).length <= 16_384;
  } catch {
    return false;
  }
}

export function validateRunEvent(input: unknown): RunEvent {
  if (!validateSchema(input) || !payloadIsBounded(input)) {
    throw new Error(`Invalid run event: ${errors(validateSchema) || 'payload is too large or not serializable'}`);
  }
  return structuredClone(input as unknown as RunEvent);
}

export function createInitialRunRecord(id: string, request: RunRequest, sourceHash: string, createdAt = new Date().toISOString()): RunRecord {
  return {
    id,
    state: 'validating',
    effect: 'not-started',
    request: structuredClone(request),
    lastSequence: 0,
    sourceHash,
    createdAt,
    resourceIds: {},
    assertions: [],
  };
}

function transitionEffect(current: RunRecord['effect'], requested: unknown): RunRecord['effect'] {
  if (typeof requested !== 'string' || !validEffects.has(requested as RunRecord['effect'])) {
    throw new Error('Invalid business effect.');
  }
  const next = requested as RunRecord['effect'];
  if (current === 'confirmed' && next !== 'confirmed') throw new Error('A confirmed business effect cannot be changed.');
  if (current === 'unknown' && next !== 'unknown') throw new Error('An unknown business effect cannot be replayed or confirmed.');
  if (next === 'confirmed' && current !== 'attempted') throw new Error('A business effect must be attempted before it can be confirmed.');
  if (next === 'attempted' && current !== 'not-started') throw new Error('A business effect can be attempted only once.');
  return next;
}

export function applyRunEvent(record: RunRecord, input: RunEvent): RunRecord {
  const event = validateRunEvent(input);
  if (event.runId !== record.id) throw new Error('Event run ID does not match the record.');
  if (event.sequence !== record.lastSequence + 1) throw new Error('Event sequence must be the next sequence number.');
  const next = structuredClone(record);
  next.lastSequence = event.sequence;

  if (event.type === 'run-state') {
    const state = event.data.state;
    if (typeof state !== 'string' || !validStates.has(state as RunRecord['state'])) throw new Error('Invalid run state.');
    if (event.data.message !== undefined && (typeof event.data.message !== 'string' || event.data.message.length > 500)) {
      throw new Error('Invalid run status message.');
    }
    if (typeof event.data.message === 'string') next.statusMessage = event.data.message;
    if (state === 'interrupted' || state === 'cancelled') {
      if (next.effect === 'attempted' || next.effect === 'unknown') {
        next.state = 'needs-reconciliation';
        next.effect = 'unknown';
      } else {
        next.state = state as RunRecord['state'];
      }
    } else {
      next.state = state as RunRecord['state'];
    }
  } else if (event.type === 'business-effect') {
    if (!/^[a-f0-9]{64}$/.test(String(event.data.intentHash))) throw new Error('Invalid business effect intent hash.');
    next.effect = transitionEffect(next.effect, event.data.effect);
    if (next.businessEffectIntentHash && next.businessEffectIntentHash !== event.data.intentHash) throw new Error('Business-effect intent hash cannot change.');
    next.businessEffectIntentHash = String(event.data.intentHash);
    if (next.effect === 'unknown') next.state = 'needs-reconciliation';
  } else if (event.type === 'assertion') {
    const lane = event.data.lane;
    const status = event.data.status;
    const message = event.data.message;
    if (!['pos', 'shopify', 'oms'].includes(String(lane)) || typeof status !== 'string' || typeof message !== 'string' || message.length > 2_000) {
      throw new Error('Invalid assertion event.');
    }
    next.assertions.push({ lane: lane as 'pos' | 'shopify' | 'oms', status, message });
  } else if (event.type === 'artifact') {
    const kind = event.data.kind;
    const path = event.data.path;
    if (typeof kind !== 'string' || typeof path !== 'string' || kind.length > 100 || path.length > 500 || path.includes('..')) {
      throw new Error('Invalid artifact event.');
    }
    next.resourceIds[kind] ??= [];
    next.resourceIds[kind].push(path);
  }
  return next;
}

export function isTerminalState(state: RunRecord['state']): boolean {
  return ['passed', 'failed', 'blocked', 'cancelled', 'needs-reconciliation'].includes(state);
}
