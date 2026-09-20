import { randomUUID } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { RunEvent, RunRecord, RunRequest } from '../../shared/contracts.ts';
import { createArtifactDirectory } from '../storage/artifacts.ts';
import { createRunStorage, type RunStorage } from '../storage/runs.ts';
import { acquireDeviceRunLock, type DeviceRunLock } from './lock.ts';
import { isTerminalState, applyRunEvent, createInitialRunRecord } from './protocol.ts';
import type { OwnedProcess } from './process.ts';

export interface WorkerInput {
  runId: string;
  request: RunRequest;
  artifactDir: string;
}

export type WorkerFactory = (input: WorkerInput, emit: (event: RunEvent) => Promise<void>) => Promise<OwnedProcess>;

interface ActiveRun {
  process?: OwnedProcess;
  lock: DeviceRunLock;
  artifactDir: string;
  stopping: boolean;
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

export interface CoordinatorOptions {
  root: string;
  storage?: RunStorage;
  workerFactory?: WorkerFactory;
}

export class RunCoordinator {
  private readonly root: string;
  private readonly storage: RunStorage;
  private readonly workerFactory?: WorkerFactory;
  private readonly active = new Map<string, ActiveRun>();
  private readonly listeners = new Map<string, Set<(event: RunEvent) => void>>();
  private readonly appendTails = new Map<string, Promise<RunRecord>>();

  constructor(options: CoordinatorOptions) {
    this.root = resolve(options.root);
    this.storage = options.storage ?? createRunStorage(this.root);
    this.workerFactory = options.workerFactory;
  }

  async startRun(request: RunRequest): Promise<RunRecord> {
    const id = `run-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const initial = createInitialRunRecord(id, request, request.expectedRevision);
    await this.storage.create(initial);
    const lock = await acquireDeviceRunLock(this.root, request.deviceProfileId, id);
    if (!lock.acquired) {
      const blocked = await this.append(initial, stateEvent(initial, 'blocked', { reason: 'device-is-already-running', owner: lock.owner }));
      return blocked;
    }
    const artifactDir = await createArtifactDirectory(this.root, id);
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
    void this.launch(accepted, active).catch(async error => {
      const current = await this.storage.get(id).catch(() => accepted);
      if (!isTerminalState(current.state)) await this.append(current, stateEvent(current, 'failed', { reason: 'worker-start-failed', message: this.safeError(error) }));
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

  private async launch(record: RunRecord, active: ActiveRun): Promise<void> {
    const running = await this.append(record, stateEvent(record, 'running'));
    active.process = await this.workerFactory!(
      { runId: running.id, request: running.request, artifactDir: active.artifactDir },
      event => this.appendAndNotify(event),
    );
    if (active.stopping) await active.process.terminate();
    await new Promise<void>(resolve => active.process!.child.once('close', () => resolve()));
    const current = await this.read(running.id);
    if (isTerminalState(current.state)) { await this.finish(running.id); return; }
    let result: { passed: boolean; message?: string } | undefined;
    try { result = JSON.parse(await readFile(join(active.artifactDir, 'result.json'), 'utf8')) as { passed: boolean; message?: string }; }
    catch { /* no structured result is a failure, regardless of process exit */ }
    if (!result || typeof result.passed !== 'boolean') {
      await this.append(current, stateEvent(current, 'failed', { reason: 'worker-exited-without-structured-result' }));
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
