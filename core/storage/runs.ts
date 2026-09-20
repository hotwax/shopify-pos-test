import { appendFile, mkdir, readFile, readdir, rename, rm, writeFile, open } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { RunEvent, RunRecord } from '../../shared/contracts.ts';
import { applyRunEvent, createInitialRunRecord } from '../runner/protocol.ts';

function runDirectory(root: string, runId: string): string {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(runId)) throw new Error('Invalid run ID.');
  return join(resolve(root), '.runtime', 'runs', runId);
}

async function atomicJson(path: string, value: unknown): Promise<void> {
  await mkdir(resolve(path, '..'), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  const handle = await open(temporary, 'wx');
  try {
    await handle.writeFile(JSON.stringify(value));
    await handle.sync();
  } finally { await handle.close(); }
  await rename(temporary, path);
}

function parseJournal(text: string): { events: RunEvent[]; corrupt: boolean } {
  const lines = text.split('\n');
  const events: RunEvent[] = [];
  let corrupt = false;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line) as RunEvent);
    } catch {
      if (index === lines.length - 1) break;
      corrupt = true;
    }
  }
  return { events, corrupt };
}

function needsReconciliation(record: RunRecord): RunRecord {
  return { ...record, state: 'needs-reconciliation', effect: 'unknown' };
}

export interface RunStorage {
  create(record: RunRecord): Promise<void>;
  append(record: RunRecord, event: RunEvent): Promise<RunRecord>;
  get(runId: string): Promise<RunRecord>;
  list(): Promise<RunRecord[]>;
  events(runId: string, afterSequence?: number): Promise<RunEvent[]>;
}

export function createRunStorage(root: string): RunStorage {
  return {
    async create(record) {
      const directory = runDirectory(root, record.id);
      await mkdir(join(resolve(root), '.runtime', 'runs'), { recursive: true });
      await mkdir(directory, { recursive: false });
      await atomicJson(join(directory, 'request.json'), { id: record.id, request: record.request, sourceHash: record.sourceHash, createdAt: record.createdAt });
      await atomicJson(join(directory, 'summary.json'), record);
      await writeFile(join(directory, 'journal.ndjson'), '', { flag: 'wx' });
    },
    async append(record, event) {
      const next = applyRunEvent(record, event);
      const directory = runDirectory(root, record.id);
      const line = `${JSON.stringify(event)}\n`;
      if (Buffer.byteLength(line) > 20_000) throw new Error('Run event exceeds the size limit.');
      const handle = await open(join(directory, 'journal.ndjson'), 'a');
      try { await handle.write(line); await handle.sync(); }
      finally { await handle.close(); }
      await atomicJson(join(directory, 'summary.json'), next);
      return next;
    },
    async get(runId) {
      const directory = runDirectory(root, runId);
      const base = JSON.parse(await readFile(join(directory, 'request.json'), 'utf8')) as { id: string; request: RunRecord['request']; sourceHash: string; createdAt: string };
      const initial = createInitialRunRecord(base.id, base.request, base.sourceHash, base.createdAt);
      const journal = parseJournal(await readFile(join(directory, 'journal.ndjson'), 'utf8'));
      let replay = initial;
      let invalid = journal.corrupt;
      try {
        for (const event of journal.events) replay = applyRunEvent(replay, event);
      } catch { invalid = true; }
      let summary: RunRecord | undefined;
      try { summary = JSON.parse(await readFile(join(directory, 'summary.json'), 'utf8')) as RunRecord; }
      catch { /* reconstruct from request and journal */ }
      if (invalid) return needsReconciliation(summary ?? replay);
      if (summary && summary.lastSequence > replay.lastSequence) return needsReconciliation(summary);
      return replay;
    },
    async list() {
      const directory = join(resolve(root), '.runtime', 'runs');
      let entries;
      try { entries = await readdir(directory, { withFileTypes: true }); }
      catch { return []; }
      const records: RunRecord[] = [];
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        try { records.push(await this.get(entry.name)); } catch { /* retain only readable run records */ }
      }
      return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    async events(runId, afterSequence = 0) {
      const text = await readFile(join(runDirectory(root, runId), 'journal.ndjson'), 'utf8');
      return parseJournal(text).events.filter(event => event.sequence > afterSequence);
    },
  };
}
