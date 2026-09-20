import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { OmsShopifyOrderDetail, RunEvent, RunRecord, RunRequest } from '../../shared/contracts.ts';
import { createArtifactDirectory } from '../storage/artifacts.ts';
import { createRunStorage, type RunStorage } from '../storage/runs.ts';
import { acquireDeviceRunLock, type DeviceRunLock } from './lock.ts';
import { isTerminalState, applyRunEvent, createInitialRunRecord } from './protocol.ts';
import type { OwnedProcess } from './process.ts';
import { approveCheckpoint as writeApproval, clearApprovalRequest, readApprovalRequest, type ApprovalRequest } from './approval.ts';
import { acknowledgeCommitAttempt, acknowledgeCommitOutcome, clearCommitAttempt, clearCommitOutcome, readCommitAttempt, readCommitOutcome, type CommitAttemptRequest, type CommitOutcomeRequest } from './effects.ts';
import { clearBridgeRequest, readBridgeRequests, writeBridgeResponse } from './bridge.ts';
import { writeWorkerInput } from './input.ts';
import { RunBlockedError } from './guards.ts';
import { remoteXpcTunnelBlockedMessage } from '../setup/checks.ts';

export interface WorkerInput {
  runId: string;
  request: RunRequest;
  artifactDir: string;
  inputFile: string;
}

export type WorkerFactory = (input: WorkerInput, emit: (event: RunEvent) => Promise<void>) => Promise<OwnedProcess>;

interface ActiveRun {
  process?: OwnedProcess;
  lock: DeviceRunLock;
  artifactDir: string;
  stopping: boolean;
}

export interface WorkerFailureClassification {
  state: 'blocked' | 'failed';
  reason: string;
  message: string;
}

/**
 * Converts known Apple/WDA precondition failures into an actionable blocked
 * run. The log is inspected locally only; no raw Appium/Xcode output is
 * returned to the browser because it can contain device or customer data.
 */
export async function classifyWorkerFailure(artifactDir: string): Promise<WorkerFailureClassification> {
  let log = '';
  try { log = (await readFile(join(artifactDir, 'wdio-appium.log'), 'utf8')).slice(-200_000); }
  catch { /* a missing log remains a generic worker failure */ }

  if (/Unlock .* to Continue|device is locked|device.*locked/i.test(log)) {
    return {
      state: 'blocked',
      reason: 'device-locked',
      message: 'The iPad is locked. Unlock it yourself, leave Shopify POS on Home, and start a fresh run. The toolkit did not change iPad access settings.',
    };
  }
  if (/Not authorized for performing UI testing actions|UI testing actions/i.test(log)) {
    return {
      state: 'blocked',
      reason: 'ui-automation-authorization',
      message: 'Apple UI automation authorization is unavailable. Complete the Apple-owned authorization yourself, then start a fresh run. The toolkit did not change that setting.',
    };
  }
  if (/Developer App Certificate is not trusted|certificate.*not trusted/i.test(log)) {
    return {
      state: 'blocked',
      reason: 'developer-certificate-not-trusted',
      message: 'The WDA developer certificate is not trusted on the iPad. Complete Apple’s trust step yourself, then start a fresh run. The toolkit did not change trust settings.',
    };
  }
  if (/Tunnel registry port not found|RemoteXPC.*(?:not available|unavailable)|RemoteXPC upstream connect error/i.test(log)) {
    return {
      state: 'blocked',
      reason: 'remote-xpc-tunnel-unavailable',
      message: remoteXpcTunnelBlockedMessage,
    };
  }
  return {
    state: 'failed',
    reason: 'worker-exited-without-structured-result',
    message: 'The worker exited without a structured result. Review the local run artifact log before retrying.',
  };
}

function stateEvent(record: RunRecord, state: RunRecord['state'], data: Record<string, unknown> = {}): RunEvent {
  return {
    protocolVersion: 1,
    runId: record.id,
    sequence: record.lastSequence + 1,
    at: new Date().toISOString(),
    type: 'run-state',
    data: { ...data, state },
  };
}

function approvalEvent(record: RunRecord, request: ApprovalRequest): RunEvent {
  return {
    protocolVersion: 1,
    runId: record.id,
    sequence: record.lastSequence + 1,
    at: new Date().toISOString(),
    type: 'approval-required',
    data: { intentHash: request.intentHash, requestedAt: request.requestedAt, summary: request.summary },
  };
}

function businessEffectEvent(record: RunRecord, request: CommitAttemptRequest): RunEvent {
  return {
    protocolVersion: 1,
    runId: record.id,
    sequence: record.lastSequence + 1,
    at: new Date().toISOString(),
    type: 'business-effect',
    data: { effect: 'attempted', intentHash: request.intentHash },
  };
}

function businessOutcomeEvent(record: RunRecord, request: CommitOutcomeRequest): RunEvent {
  return {
    protocolVersion: 1,
    runId: record.id,
    sequence: record.lastSequence + 1,
    at: new Date().toISOString(),
    type: 'business-effect',
    data: { effect: request.effect, intentHash: request.intentHash },
  };
}

function unknownEffectEvent(record: RunRecord, intentHash: string): RunEvent {
  return {
    protocolVersion: 1,
    runId: record.id,
    sequence: record.lastSequence + 1,
    at: new Date().toISOString(),
    type: 'business-effect',
    data: { effect: 'unknown', intentHash },
  };
}

export interface CoordinatorOptions {
  root: string;
  storage?: RunStorage;
  workerFactory?: WorkerFactory;
  currentRevision?: () => string | undefined;
  resolveObservedOrder?: (input: { request: RunRequest; observedName: string; runMarker?: string }) => Promise<{ orderGid: string; orderName: string }>;
  readShopifyOrder?: (input: { request: RunRequest; orderGid: string }) => Promise<OmsShopifyOrderDetail>;
}

export class RunCoordinator {
  private readonly root: string;
  private readonly storage: RunStorage;
  private readonly workerFactory?: WorkerFactory;
  private readonly currentRevision: () => string | undefined;
  private readonly resolveObservedOrder?: CoordinatorOptions['resolveObservedOrder'];
  private readonly readShopifyOrder?: CoordinatorOptions['readShopifyOrder'];
  private readonly active = new Map<string, ActiveRun>();
  private readonly listeners = new Map<string, Set<(event: RunEvent) => void>>();
  private readonly appendTails = new Map<string, Promise<RunRecord>>();

  constructor(options: CoordinatorOptions) {
    this.root = resolve(options.root);
    this.storage = options.storage ?? createRunStorage(this.root);
    this.workerFactory = options.workerFactory;
    this.resolveObservedOrder = options.resolveObservedOrder;
    this.readShopifyOrder = options.readShopifyOrder;
    this.currentRevision = options.currentRevision ?? (() => {
      try { return execFileSync('git', ['-C', this.root, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || undefined; }
      catch { return undefined; }
    });
  }

  async startRun(request: RunRequest): Promise<RunRecord> {
    const id = `run-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const initial = createInitialRunRecord(id, request, request.expectedRevision);
    await this.storage.create(initial);
    const currentRevision = this.currentRevision();
    if (currentRevision && currentRevision !== request.expectedRevision) {
      return this.append(initial, stateEvent(initial, 'blocked', {
        reason: 'source-revision-changed',
        message: 'The workspace changed after this run was reviewed. Refresh the script and approve the current revision before running.',
      }));
    }
    const lock = await acquireDeviceRunLock(this.root, request.deviceProfileId, id);
    if (!lock.acquired) {
      const blocked = await this.append(initial, stateEvent(initial, 'blocked', { reason: 'device-is-already-running', owner: lock.owner }));
      return blocked;
    }
    const artifactDir = await createArtifactDirectory(this.root, id);
    let inputFile: string;
    try {
      inputFile = await writeWorkerInput(this.root, id, request);
    } catch (error) {
      const blocked = await this.append(initial, stateEvent(initial, 'blocked', { reason: 'unsafe-worker-input', message: this.safeError(error) }));
      await lock.release();
      return blocked;
    }
    const active: ActiveRun = { lock, artifactDir, stopping: false };
    this.active.set(id, active);
    let accepted = await this.append(initial, stateEvent(initial, 'preparing'));
    if (!this.workerFactory) {
      accepted = await this.append(accepted, stateEvent(accepted, 'blocked', { reason: 'no-worker-configured' }));
      await this.finish(id);
      return accepted;
    }
    // Persist acceptance before the worker is created. A caller can safely
    // reload and observe `preparing`; no test action is inferred from a PID.
    void this.launch(accepted, active, inputFile).catch(async error => {
      const current = await this.storage.get(id).catch(() => accepted);
      if (!isTerminalState(current.state)) {
        const blocked = error instanceof RunBlockedError;
        await this.append(current, stateEvent(current, blocked ? 'blocked' : 'failed', { reason: blocked ? error.reason : 'worker-start-failed', message: this.safeError(error) }));
      }
      await this.finish(id);
    });
    return accepted;
  }

  async requestStop(runId: string): Promise<void> {
    const active = this.active.get(runId);
    const record = await this.read(runId);
    if (isTerminalState(record.state)) return;
    if (active) {
      active.stopping = true;
      await active.process?.terminate();
    }
    const current = await this.read(runId);
    if (!isTerminalState(current.state)) await this.append(current, stateEvent(current, 'cancelled', { reason: 'stop-requested' }));
    await this.finish(runId);
  }

  async approveCheckpoint(runId: string): Promise<RunRecord> {
    let current: RunRecord;
    try { current = await this.read(runId); }
    catch { throw new Error('Run was not found.'); }
    if (isTerminalState(current.state)) throw new Error('A terminal run cannot be approved.');
    if (current.state !== 'awaiting-approval' || !current.pendingApproval) throw new Error('This run has no pending approval checkpoint.');
    await writeApproval(this.root, runId, current.pendingApproval.intentHash);
    return this.append(current, stateEvent(current, 'running', {
      clearApproval: true,
      message: 'Approval granted. The worker may continue to the reviewed transaction checkpoint.',
    }));
  }

  async getRun(runId: string): Promise<RunRecord> { return this.read(runId); }
  async listRuns(): Promise<RunRecord[]> { return this.storage.list(); }

  subscribeRun(runId: string, afterSequence: number, callback: (event: RunEvent) => void): () => void {
    const listeners = this.listeners.get(runId) ?? new Set<(event: RunEvent) => void>();
    listeners.add(callback);
    this.listeners.set(runId, listeners);
    void this.storage.events(runId, afterSequence).then(events => {
      for (const event of events) if (this.listeners.get(runId)?.has(callback)) callback(event);
    }).catch(() => undefined);
    return () => {
      listeners.delete(callback);
      if (!listeners.size) this.listeners.delete(runId);
    };
  }

  private async launch(record: RunRecord, active: ActiveRun, inputFile: string): Promise<void> {
    const running = await this.append(record, stateEvent(record, 'running'));
    let polling = false;
    let bridgePolling = false;
    const pollRequests = async () => {
      if (polling) return;
      polling = true;
      try {
        const requested = await readApprovalRequest(this.root, running.id);
        if (requested) {
          const current = await this.read(running.id);
          if (!isTerminalState(current.state) && current.pendingApproval?.intentHash !== requested.intentHash) {
            await this.append(current, approvalEvent(current, requested));
            await clearApprovalRequest(this.root, running.id);
          }
        }
        const commit = await readCommitAttempt(this.root, running.id);
        if (commit) {
          const current = await this.read(running.id);
          if (!isTerminalState(current.state) && current.effect === 'not-started') {
            await this.append(current, businessEffectEvent(current, commit));
          }
          const after = await this.read(running.id);
          if (after.businessEffectIntentHash === commit.intentHash) {
            await acknowledgeCommitAttempt(this.root, running.id, commit.intentHash);
            await clearCommitAttempt(this.root, running.id);
          }
        }
        const outcome = await readCommitOutcome(this.root, running.id);
        if (outcome) {
          const current = await this.read(running.id);
          if (current.businessEffectIntentHash === outcome.intentHash && (current.effect === 'attempted' || current.effect === outcome.effect)) {
            if (current.effect === 'attempted') await this.append(current, businessOutcomeEvent(current, outcome));
            await acknowledgeCommitOutcome(this.root, running.id, outcome.intentHash, outcome.effect);
            await clearCommitOutcome(this.root, running.id);
          }
        }
      } finally { polling = false; }
    };
    const pollBridge = async () => {
      if (bridgePolling) return;
      bridgePolling = true;
      try {
        const request = (await readBridgeRequests(this.root, running.id))[0];
        if (!request) return;
        const current = await this.read(running.id);
        if (isTerminalState(current.state)) {
          await clearBridgeRequest(this.root, request);
          return;
        }
        if (request.operation === 'resolveObservedOrder') {
          let result: { orderGid: string; orderName: string } | undefined;
          let error: string | undefined;
          if (!this.resolveObservedOrder) error = 'Observed-order correlation is not configured for this local host.';
          else {
            try { result = await this.resolveObservedOrder({ request: running.request, observedName: request.observedName, runMarker: request.runMarker }); }
            catch (cause) { error = this.safeError(cause); }
          }
          await writeBridgeResponse(this.root, request, result ? { ok: true, orderGid: result.orderGid, orderName: result.orderName } : { ok: false, error: error ?? 'The observed POS order could not be resolved.' });
        } else {
          let result: OmsShopifyOrderDetail | undefined;
          let error: string | undefined;
          if (!this.readShopifyOrder) error = 'Shopify order readback is not configured for this local host.';
          else {
            try { result = await this.readShopifyOrder({ request: running.request, orderGid: request.orderGid }); }
            catch (cause) { error = this.safeError(cause); }
          }
          await writeBridgeResponse(this.root, request, result ? { ok: true, order: result } : { ok: false, error: error ?? 'The Shopify order could not be read back.' });
        }
        await clearBridgeRequest(this.root, request);
      } finally { bridgePolling = false; }
    };
    const approvalTimer = setInterval(() => {
      void pollRequests().catch(() => undefined);
      void pollBridge().catch(() => undefined);
    }, 100);
    try {
      active.process = await this.workerFactory!(
        { runId: running.id, request: running.request, artifactDir: active.artifactDir, inputFile },
        event => this.appendAndNotify(event),
      );
      if (active.stopping) await active.process.terminate();
      await this.waitForWorker(active);
    } finally {
      clearInterval(approvalTimer);
    }
    const current = await this.read(running.id);
    if (isTerminalState(current.state)) { await this.finish(running.id); return; }
    let result: { passed: boolean; message?: string } | undefined;
    try { result = JSON.parse(await readFile(join(active.artifactDir, 'result.json'), 'utf8')) as { passed: boolean; message?: string }; }
    catch { /* no structured result is a failure, regardless of process exit */ }
    if (!result || typeof result.passed !== 'boolean') {
      if (current.effect === 'attempted' && current.businessEffectIntentHash) {
        await this.append(await this.append(current, unknownEffectEvent(current, current.businessEffectIntentHash)), stateEvent(current, 'needs-reconciliation', {
          reason: 'business-effect-result-missing',
          message: 'The worker stopped after a commit boundary without a structured result. Reconcile the test-store result before retrying.',
        }));
      } else {
        const classification = await classifyWorkerFailure(active.artifactDir);
        await this.append(current, stateEvent(current, classification.state, { reason: classification.reason, message: classification.message }));
      }
    } else if (current.effect === 'attempted') {
      const intentHash = current.businessEffectIntentHash;
      if (intentHash) await this.append(await this.append(current, unknownEffectEvent(current, intentHash)), stateEvent(current, 'needs-reconciliation', {
        reason: 'business-effect-not-confirmed',
        message: 'The worker reached a commit boundary but did not provide confirmed read-back. Reconcile the test-store result before retrying.',
      }));
      else await this.append(current, stateEvent(current, 'needs-reconciliation', {
        reason: 'business-effect-intent-missing',
        message: 'The worker reached a commit boundary without an intent identity. Reconcile the test-store result before retrying.',
      }));
    } else {
      await this.append(current, stateEvent(current, result.passed ? 'passed' : 'failed', { message: result.message ?? 'Structured worker result received.' }));
    }
    await this.finish(running.id);
  }

  private async appendAndNotify(event: RunEvent): Promise<void> {
    const current = await this.read(event.runId);
    if (isTerminalState(current.state)) return;
    await this.append(current, event);
  }

  private async waitForWorker(active: ActiveRun): Promise<void> {
    const child = active.process?.child;
    if (!child) return;
    await new Promise<void>(resolve => {
      let finished = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = () => {
        if (finished) return;
        finished = true;
        if (timer) clearTimeout(timer);
        resolve();
      };
      child.once('close', finish);
      const inspect = async () => {
        if (finished) return;
        const classification = await classifyWorkerFailure(active.artifactDir);
        if (classification.state === 'blocked') {
          await active.process?.terminate().catch(() => undefined);
          finish();
          return;
        }
        timer = setTimeout(() => { void inspect(); }, 250);
      };
      void inspect();
    });
  }

  private async append(record: RunRecord, event: RunEvent): Promise<RunRecord> {
    const previous = this.appendTails.get(record.id) ?? Promise.resolve(record);
    const operation = previous.catch(() => record).then(async base => {
      const normalized = base.lastSequence + 1 === event.sequence
        ? event
        : { ...event, sequence: base.lastSequence + 1 };
      const next = await this.storage.append(base, normalized);
      for (const listener of this.listeners.get(record.id) ?? []) listener(normalized);
      return next;
    });
    this.appendTails.set(record.id, operation);
    try { return await operation; }
    finally {
      if (this.appendTails.get(record.id) === operation) this.appendTails.delete(record.id);
    }
  }

  private async read(runId: string): Promise<RunRecord> {
    await this.appendTails.get(runId)?.catch(() => undefined);
    return this.storage.get(runId);
  }

  private async finish(runId: string): Promise<void> {
    const active = this.active.get(runId);
    if (!active) return;
    this.active.delete(runId);
    await active.lock.release();
  }

  private safeError(error: unknown): string {
    return (error instanceof Error ? error.message : String(error)).slice(0, 500).replace(/password|token|secret/gi, '[redacted]');
  }
}

export function createCoordinator(options: CoordinatorOptions): RunCoordinator { return new RunCoordinator(options); }
