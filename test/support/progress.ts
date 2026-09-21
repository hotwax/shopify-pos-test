import { appendFile, mkdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

/**
 * Live progress channel for a running scenario. The worker only reports a
 * structured result when it exits, so without this a long native run looks
 * frozen to the operator. Lines are appended to the run's artifact directory
 * and served read-only to the run detail view.
 *
 * Each entry also records how far the Appium log had been written when the step
 * started. Consecutive offsets bracket exactly the driver output that step
 * produced, which is more reliable than matching timestamps: many Appium lines
 * carry no wall clock at all.
 *
 * It is observational only: nothing here decides whether a run passes, and a
 * write failure must never take down the scenario that is reporting.
 */
async function appiumLogSize(directory: string): Promise<number> {
  // With the host's shared Appium server the log is one file for the host's
  // lifetime; offsets are taken relative to where this run's slice begins so
  // they still index the run's own artifact log once the slice is copied.
  const shared = process.env.APPIUM_LOG_FILE?.trim();
  if (shared) {
    const base = Number(process.env.APPIUM_LOG_BASE_OFFSET ?? '0');
    try { return Math.max(0, (await stat(shared)).size - (Number.isSafeInteger(base) ? base : 0)); }
    catch { return 0; }
  }
  try { return (await stat(join(resolve(directory), 'wdio-appium.log'))).size; }
  catch { return 0; }
}

export async function reportProgress(message: string, detail?: Record<string, unknown>): Promise<void> {
  const directory = process.env.RUN_ARTIFACT_DIR;
  if (!directory || !message.trim()) return;
  try {
    const line = JSON.stringify({
      at: new Date().toISOString(),
      message: message.slice(0, 300),
      logOffset: await appiumLogSize(directory),
      ...(detail ? { detail } : {}),
    });
    if (Buffer.byteLength(line) > 4_000) return;
    await mkdir(resolve(directory), { recursive: true });
    await appendFile(join(resolve(directory), 'progress.ndjson'), `${line}\n`);
  } catch { /* progress reporting must never fail a run */ }
}
