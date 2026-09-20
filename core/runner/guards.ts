import type { Effect, MutationReadiness, RunRequest } from '../../shared/contracts.ts';
import { isValidTargetContext } from '../safety/environment.ts';

export class RunBlockedError extends Error {
  readonly reason: string;

  constructor(reason: string, message: string) {
    super(message);
    this.name = 'RunBlockedError';
    this.reason = reason;
  }
}

export function assertScenarioCanRun(effect: Effect, request: RunRequest, readiness: MutationReadiness): void {
  if (effect === 'read-only') return;
  if (!isValidTargetContext(request.context)) throw new RunBlockedError('missing-target-context', 'A mutating scenario requires an exact frozen target context.');
  if (request.assertionMode === 'pos') throw new RunBlockedError('mutation-assertion-mode', 'A mutating scenario cannot use POS-only assertion mode.');
  if (!readiness.enabled) {
    const detail = readiness.reasons.filter(Boolean).join(' ');
    throw new RunBlockedError('mutation-readiness', detail || 'The native mutation readiness gates are not enabled.');
  }
}
